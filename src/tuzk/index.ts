import { Delegate, type DelegateListener } from '@leawind/delegate';

import {
	TuzkCanceledError,
	TuzkDependencyFailedError,
	TuzkError,
	TuzkInvalidActionError,
	TuzkNeverError,
} from '@/tuzk/error.ts';

/**
 * The state of a Tuzk task.
 */
export enum TuzkState {
	/**
	 * Not started yet
	 */
	Pending,

	/**
	 * Waiting for dependencies
	 */
	Waiting,

	/**
	 * Already started, not finished yet
	 */
	Running,

	/**
	 * Paused by {@link Tuzk.pause}.
	 * Use {@link Tuzk.resume} to resume.
	 */
	Paused,

	// Finished
	Success,
	Failed,
	Canceled,
}

type TuzkPicked<T> = Pick<
	Tuzk<T>,
	| 'setProgress'
	| 'checkpoint'
	| 'pause'
	| 'resume'
	| 'cancel'
>;

/**
 * A function to run the task.
 *
 * If you never invoke it, the task can not be paused or canceled during running
 */
export type TuzkRunner<T> = (tuzk: TuzkPicked<T>) => PromiseLike<T>;

/**
 * Can be converted to a Tuzk using {@link Tuzk.from}
 */
export type TuzkLike<T> = Tuzk<T> | TuzkRunner<T>;

type PromiseAction = {
	resolve: (value: void | PromiseLike<void>) => void;
	reject: (reason?: unknown) => void;
};

/**
 * Tuzk is task that can be started, paused, resumed, canceled.
 *
 * ## Dependencies
 *
 * You can also add dependencies to it, and it will only start when all of its dependencies succeed.
 *
 * If any dependency is failed or canceled, this task won't start.
 *
 * ## progress
 *
 * In the runner, you can use {@link Tuzk.checkpoint} or {@link Tuzk.setProgress} to update the progress.
 *
 * You can use {@link Tuzk.onProgressUpdated} to listen to the progress change.
 */
export class Tuzk<T> {
	private readonly runner: TuzkRunner<T>;

	/**
	 * Progress of the task. Range: [0.0, 1.0]
	 */
	private progress: number = 0;

	/**
	 * Whether this task should be paused.
	 */
	private shouldPause: boolean = false;

	/**
	 * Whether this task should be canceled.
	 */
	private shouldCancel: boolean = false;

	private checkpointPromiseAction: PromiseAction | null = null;
	private waitForDependenciesPromiseAction: PromiseAction | null = null;

	/**
	 * If this task was failed, this will be set.
	 */
	public error?: unknown;

	private state: TuzkState = TuzkState.Pending;

	private result?: T;

	/**
	 * Dependencies of this task.
	 *
	 * Only if all of its dependencies are finished, this task can be started.
	 *
	 * If any dependency is failed or canceled, this task will be failed.
	 */
	private readonly dependenciesMap: Map<Tuzk<unknown>, DelegateListener<TuzkState>> = new Map();

	// Delegates
	public readonly onProgressUpdated: Delegate<number> = new Delegate<number>();
	public readonly onStateUpdated: Delegate<TuzkState> = new Delegate<TuzkState>();

	public constructor(runner: TuzkRunner<T>) {
		this.runner = runner;
	}

	/**
	 * Get progress of the task.
	 */
	public getProgress(): number {
		return this.progress;
	}

	/**
	 * Set progress of the task.
	 *
	 * @param progress Progress to set.
	 * @throws {TuzkError} If progress is not in range [0.0, 1.0].
	 */
	public setProgress(progress: number): void {
		Tuzk.validateProgress(progress);
		if (this.progress !== progress) {
			this.progress = progress;
			this.onProgressUpdated.broadcast(this.progress);
		}
	}

	/**
	 * Get the current state of the task.
	 *
	 * @returns The current state of the task.
	 */
	public getState(): TuzkState {
		return this.state;
	}

	protected setState(state: TuzkState): void {
		if (this.state !== state) {
			this.state = state;
			this.onStateUpdated.broadcast(this.state);
		}
	}

	/**
	 * Get the result of the task.
	 *
	 * @returns The result of the task, or `undefined` if the task has not finished yet.
	 */
	getResult(): T | undefined {
		return this.result;
	}

	/////////////////////////////////////////////////////////////////
	// Dependencies
	/////////////////////////////////////////////////////////////////

	/**
	 * Get the dependencies of this task.
	 *
	 * @returns An iterator of the dependencies.
	 */
	public getDependencies(): MapIterator<Tuzk<unknown>> {
		return this.dependenciesMap.keys();
	}

	/**
	 * Check if the task has a specific dependency.
	 *
	 * @param tuzk The task to check.
	 * @returns `true` if the task is a dependency, `false` otherwise.
	 */
	public hasDependency<U>(tuzk: Tuzk<U>): boolean {
		return this.dependenciesMap.has(tuzk);
	}

	/**
	 * Add a dependency to this task.
	 *
	 * @param tuzk The task to add as a dependency.
	 * @returns The current instance of `Tuzk`.
	 */
	public addDependency<U>(tuzk: Tuzk<U>): this {
		if (!this.dependenciesMap.has(tuzk)) {
			const listener: DelegateListener<TuzkState> = () => {
				if (this.waitForDependenciesPromiseAction) {
					return { removeSelf: this.checkDependencies(this.waitForDependenciesPromiseAction) };
				}
			};
			tuzk.onStateUpdated.addListener(listener);
			this.dependenciesMap.set(tuzk, listener);
		}
		return this;
	}

	/**
	 * Remove a dependency from this task.
	 *
	 * @param task The task to remove from dependencies.
	 * @returns The current instance of `Tuzk`.
	 */
	public removeDependency(task: Tuzk<unknown>): this {
		const listener = this.dependenciesMap.get(task);
		if (listener) {
			this.dependenciesMap.delete(task);
			task.onStateUpdated.removeListener(listener);
		}
		return this;
	}

	/**
	 * Add multiple dependencies to this task.
	 *
	 * @param tasks The tasks to add as dependencies.
	 * @returns The current instance of `Tuzk`.
	 */
	public addDependencies(tasks: Tuzk<unknown>[]): this {
		for (const task of tasks) {
			this.addDependency(task);
		}
		return this;
	}

	/**
	 * Clear all dependencies of this task.
	 *
	 * @returns The current instance of `Tuzk`.
	 */
	public clearDependencies(): this {
		for (const [task, listener] of [...this.dependenciesMap.entries()]) {
			this.dependenciesMap.delete(task);
			task.onStateUpdated.removeListener(listener);
		}
		return this;
	}

	/////////////////////////////////////////////////////////////////
	// Running
	/////////////////////////////////////////////////////////////////

	/**
	 * This method can:
	 *
	 * - Update the progress
	 * - Check if the task should be paused or canceled
	 *     - If the task is marked as canceled by {@link Tuzk.cancel}, it throws a {@link TuzkCanceledError}.
	 *     - If the task is marked as paused by {@link Tuzk.pause}, it won't resolve until {@link Tuzk.resume} is called.
	 *
	 * Always invoke and await this method in a task runner.
	 *
	 * @param progress Progress to set.
	 *
	 * @throws {TuzkInvalidActionError} If the task is not running.
	 * @throws {TuzkError} If progress is not in range [0.0, 1.0].
	 * @throws {TuzkCanceledError} If this task is marked as canceled.
	 */
	public checkpoint(progress?: number): Promise<void> {
		if (!this.stateIs(TuzkState.Running)) {
			throw new TuzkInvalidActionError(`Tuzk can invoke checkpoint only during running`);
		}

		return new Promise((resolve, reject) => {
			// Update progress
			if (progress !== undefined) {
				this.setProgress(progress);
			}

			this.checkpointPromiseAction = null;

			// Check cancel
			if (this.shouldCancel) {
				this.setState(TuzkState.Canceled);
				// If do not reject or resolve, the Promise will stay in memory forever.
				reject(new TuzkCanceledError());
			} else {
				// Check pause
				if (this.shouldPause) {
					this.setState(TuzkState.Paused);
					this.checkpointPromiseAction = { resolve, reject };
				} else {
					this.setState(TuzkState.Running);
					resolve();
				}
			}
		});
	}

	/**
	 * Check all dependencies and resolve the promise if all dependencies succeed.
	 *
	 * @returns Whether all dependencies are finished.
	 */
	private checkDependencies(promiseAction: PromiseAction): boolean {
		let isAllSucceed = true;
		for (const task of this.dependenciesMap.keys()) {
			if (task.isFinished()) {
				if (task.stateIs(TuzkState.Failed)) {
					promiseAction.reject(new TuzkDependencyFailedError(task));
				} else if (task.stateIs(TuzkState.Canceled)) {
					promiseAction.reject(new TuzkCanceledError());
				}
			} else {
				isAllSucceed = false;
			}
		}
		if (isAllSucceed) {
			this.waitForDependenciesPromiseAction = null;
			promiseAction.resolve();
		}
		return isAllSucceed;
	}

	/**
	 * Start this task.
	 *
	 * @throws {TuzkError} If the task is already started.
	 * @throws {TuzkCanceledError} If the task is canceled.
	 * @throws {unknown} If the given {@link Tuzk.runner} throws any error.
	 *
	 * @returns A promise that resolves when the task is finished.
	 */
	public async start(): Promise<T> {
		switch (this.state) {
			case TuzkState.Waiting:
			case TuzkState.Running:
			case TuzkState.Paused:
				throw new TuzkInvalidActionError(`Tuzk can not started again during running`);
		}

		try {
			// Wait for dependencies to finish
			await new Promise((resolve, reject) => {
				this.waitForDependenciesPromiseAction = { resolve, reject };
				this.checkDependencies(this.waitForDependenciesPromiseAction);
			});

			this.setState(TuzkState.Running);

			// Wait for runner to finish
			await this.checkpoint(0);
			this.result = await this.runner(this);
			this.setProgress(1);

			this.setState(TuzkState.Success);

			return this.result;
		} catch (error: unknown) {
			this.error = error;
			this.setState(error instanceof TuzkCanceledError ? TuzkState.Canceled : TuzkState.Failed);
			throw error;
		} finally {
			this.shouldCancel = false;
			this.shouldPause = false;
		}
	}

	/**
	 * Mark this task as paused.
	 *
	 * Next time the runner calls {@link Tuzk.checkpoint}, the task will be really paused.
	 *
	 * @throws {TuzkInvalidActionError} If the task is not running.
	 */
	public pause(): void {
		switch (this.state) {
			case TuzkState.Running:
			case TuzkState.Paused:
				this.shouldPause = true;
				break;
			default:
				throw new TuzkInvalidActionError(`Cannot pause a tuzk when it's not running or paused`);
		}
	}

	/**
	 * Resume this task.
	 *
	 * If the task is marked as paused, it will be marked as not paused.
	 *
	 * If the task is really paused, it will be resumed.
	 *
	 * @throws {TuzkInvalidActionError} If the task is not running.
	 */
	public resume(): void {
		switch (this.state) {
			case TuzkState.Running:
			case TuzkState.Paused:
				this.shouldPause = false;

				if (this.state === TuzkState.Paused) {
					if (this.checkpointPromiseAction === null) {
						throw new TuzkNeverError(`checkpointPromiseAction should not be null when paused`);
					}
					this.checkpointPromiseAction.resolve();
					this.checkpointPromiseAction = null;
					this.setState(TuzkState.Running);
				}

				break;
			default:
				throw new TuzkInvalidActionError(`Cannot resume a tuzk when it's not paused or running`);
		}
	}

	/**
	 * Check if this task is marked as paused.
	 *
	 * @returns `true` if the task is marked as paused, `false` otherwise.
	 */
	public isMarkedAsPaused(): boolean {
		return this.shouldPause;
	}

	/**
	 * Mark this task as canceled.
	 *
	 * Next time the runner calls {@link Tuzk.checkpoint}, the task will no longer run.
	 *
	 * @throws {TuzkInvalidActionError} If the task is not running.
	 */
	public cancel(): void {
		switch (this.state) {
			case TuzkState.Running:
			case TuzkState.Paused:
			case TuzkState.Canceled:
				this.shouldCancel = true;
				if (this.checkpointPromiseAction !== null) {
					this.checkpointPromiseAction.reject(new TuzkCanceledError());
				}
				break;
			default:
				throw new TuzkInvalidActionError(`Cannot cancel a tuzk when it's not running, paused or canceled`);
		}
	}

	/**
	 * Check if this task is marked as canceled.
	 *
	 * @returns `true` if the task is marked as canceled, `false` otherwise.
	 */
	public isMarkedAsCanceled(): boolean {
		return this.shouldCancel;
	}

	/////////////////////////////////////////////////////////////////
	// State check
	/////////////////////////////////////////////////////////////////

	public stateIs(state: TuzkState): boolean {
		return this.state === state;
	}

	public isFinished(): boolean {
		switch (this.state) {
			case TuzkState.Success:
			case TuzkState.Failed:
			case TuzkState.Canceled:
				return true;
			default:
				return false;
		}
	}

	/////////////////////////////////////////////////////////////////
	// Static methods
	/////////////////////////////////////////////////////////////////

	/**
	 * Validate progress.
	 *
	 * @throws {TuzkError} If progress is not in range [0.0, 1.0].
	 */
	protected static validateProgress(progress: number): void {
		if (progress < 0 || progress > 1) {
			throw new TuzkError('Progress must be in range [0.0, 1.0]');
		}
	}

	/**
	 * Create a Tuzk instance from a TuzkRunner function.
	 *
	 * If the given value is a TuzkRunner function, a new Tuzk instance will be created and returned.
	 * If the given value is a Tuzk instance, it will be returned as is.
	 */
	public static from<T>(value: TuzkLike<T>): Tuzk<T> {
		if (value instanceof Tuzk) {
			return value;
		} else {
			return new Tuzk(value);
		}
	}

	/**
	 * Create a Tuzk task that runs multiple tasks in parallel and resolves when all tasks are finished.
	 *
	 * @param tasks An array of Tuzk instances or TuzkRunner functions.
	 * @returns A Tuzk instance that resolves with an array of results from all tasks.
	 */
	public static all<T>(tasks: TuzkLike<T>[]): Tuzk<T[]> {
		const tuzks: Tuzk<T>[] = tasks.map((runner) => Tuzk.from(runner));
		const promises: Promise<T>[] = tuzks.map((task) => task.start());

		return new NestedTuzk<T[]>(tuzks, async () => {
			await Promise.all(promises);
			return tuzks.map((task) => task.getResult()!);
		});
	}

	/**
	 * Create a Tuzk task that runs multiple tasks in parallel and resolves when the first task is finished.
	 *
	 * @param tasks An array of Tuzk instances or TuzkRunner functions.
	 * @returns A Tuzk instance that resolves with the result of the first finished task.
	 */
	public static race<T>(tasks: TuzkLike<T>[]): Tuzk<T> {
		const tuzks: Tuzk<T>[] = tasks.map((runner) => Tuzk.from(runner));
		const promises: Promise<T>[] = tuzks.map((task) => task.start());
		return new NestedTuzk<T>(
			tuzks,
			() => Promise.race(promises),
		);
	}
}

/**
 * A nested Tuzk task that contains multiple subtasks.
 */
export class NestedTuzk<T, SubT = unknown> extends Tuzk<T> {
	private subtasks: Tuzk<SubT>[];

	constructor(tasks: Tuzk<SubT>[], runner: TuzkRunner<T>) {
		super(runner);
		this.subtasks = [...tasks];
	}

	/**
	 * Pause the nested task and all its subtasks.
	 */
	public override pause(): void {
		super.pause();
		for (const task of this.subtasks) {
			task.pause();
		}
	}

	/**
	 * Resume the nested task and all its subtasks.
	 */
	public override resume(): void {
		super.resume();
		for (const task of this.subtasks) {
			task.resume();
		}
	}

	/**
	 * Cancel the nested task and all its subtasks.
	 */
	public override cancel(): void {
		super.cancel();
		for (const task of this.subtasks) {
			task.cancel();
		}
	}
}

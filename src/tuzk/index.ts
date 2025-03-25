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

/**
 * A function to run the task.
 *
 * The argument `checkPoint` is a function, you can invoke and await it whenever you want to:
 *
 * - update the progress
 * - check if the task should be paused or canceled
 *
 * If you never invoke it, the task can not be paused or canceled during running
 */
export type TuzkRunner<T> = (checkPoint: TuzkCheckPoint, tuzk: Tuzk<T>) => PromiseLike<T>;

/**
 * Invoke and await this in a task.
 *
 * If the task is marked as canceled by {@link Tuzk.cancel}, it throws a {@link TuzkCanceledError}.
 *
 * If the task is marked as paused by {@link Tuzk.pause}, it does not `resolve` until {@link Tuzk.resume} is called.
 *
 * @param progress Progress to set.
 * @throws {TuzkError} If progress is not in range [0.0, 1.0].
 * @throws {TuzkCanceledError} If this task is marked as canceled.
 *
 * @see Tuzk.checkPoint
 */
export type TuzkCheckPoint = (progress?: number) => Promise<void>;

/**
 * Can be converted to a Tuzk using {@link Tuzk.from}
 */
export type TuzkLike<T> = Tuzk<T> | TuzkRunner<T>;

export type PromiseAction = {
	resolve: (value: void | PromiseLike<void>) => void;
	reject: (reason?: unknown) => void;
};

/**
 * Tuzk is task that can be started, paused, resumed, canceled.
 *
 * ## Dependencies
 *
 * You can also add dependencies to it, and it will only start when all of its dependencies are finished.
 *
 * If any dependency is failed or canceled, this task will be failed.
 *
 * ## progress
 *
 * In the runner, you can use {@link checkPoint} or {@link setProgress} to update the progress.
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

	private checkPointPromiseAction: PromiseAction | null = null;
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
		return this.dependenciesMap.has(tuzk as Tuzk<unknown>);
	}

	/**
	 * Add a dependency to this task.
	 *
	 * @param tuzk The task to add as a dependency.
	 * @returns The current instance of `Tuzk`.
	 */
	public addDependency<U>(tuzk: Tuzk<U>): this {
		if (!this.dependenciesMap.has(tuzk as Tuzk<unknown>)) {
			const listener: DelegateListener<TuzkState> = () => {
				if (this.waitForDependenciesPromiseAction) {
					return { removeSelf: this.checkDependencies(this.waitForDependenciesPromiseAction) };
				}
			};
			tuzk.onStateUpdated.addListener(listener);
			this.dependenciesMap.set(tuzk as Tuzk<unknown>, listener);
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
	 * @see TuzkCheckPoint
	 */
	protected checkPoint(progress?: number): Promise<void> {
		return new Promise((resolve, reject) => {
			// Update progress
			if (progress !== undefined) {
				this.setProgress(progress);
			}

			this.checkPointPromiseAction = null;

			// Check cancel
			if (this.shouldCancel) {
				// If do not reject or resolve, the Promise will stay in memory forever.
				this.setState(TuzkState.Canceled);
				reject(new TuzkCanceledError());
			} else {
				// Check pause
				if (this.shouldPause) {
					this.setState(TuzkState.Paused);
					this.checkPointPromiseAction = { resolve, reject };
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
				if (task.isFailed()) {
					promiseAction.reject(new TuzkDependencyFailedError(task));
				} else if (task.isCanceled()) {
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
		if (
			this.state === TuzkState.Waiting ||
			this.state === TuzkState.Running ||
			this.state === TuzkState.Paused
		) {
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
			await this.checkPoint(0);
			this.result = await this.runner(this.checkPoint.bind(this), this);
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
	 * Next time the runner calls `checkPoint`, the task will be really paused.
	 *
	 * If the task is not running, it does nothing
	 */
	public pause(): void {
		if (this.state === TuzkState.Running) {
			this.shouldPause = true;
		}
	}

	/**
	 * Resume this task.
	 *
	 * If the task is marked as paused, it will be marked as not paused.
	 *
	 * If the task is really paused, it will be resumed.
	 */
	public resume(): void {
		this.shouldPause = false;
		if (this.state === TuzkState.Paused) {
			if (this.checkPointPromiseAction === null) {
				throw new TuzkNeverError(`checkPointPromiseAction should not be null when paused`);
			}
			this.checkPointPromiseAction.resolve();
			this.checkPointPromiseAction = null;
			this.setState(TuzkState.Running);
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
	 * Next time the runner calls `checkPoint`, the task will no longer run.
	 */
	public cancel(): void {
		this.shouldCancel = true;
		if (this.checkPointPromiseAction !== null) {
			this.checkPointPromiseAction.reject(new TuzkCanceledError());
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

	public isRunning(): boolean {
		return this.state === TuzkState.Running;
	}

	public isPaused(): boolean {
		return this.state === TuzkState.Paused;
	}

	public isFinished(): boolean {
		return this.state === TuzkState.Success ||
			this.state === TuzkState.Failed ||
			this.state === TuzkState.Canceled;
	}

	public isSuccess(): boolean {
		return this.state === TuzkState.Success;
	}

	public isFailed(): boolean {
		return this.state === TuzkState.Failed;
	}

	public isCanceled(): boolean {
		return this.state === TuzkState.Canceled;
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

		return new NestedTuzk<T[]>(tuzks as Tuzk<unknown>[], async () => {
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
			tuzks as Tuzk<unknown>[],
			() => Promise.race(promises) as PromiseLike<T>,
		);
	}
}

/**
 * A nested Tuzk task that contains multiple subtasks.
 */
export class NestedTuzk<T> extends Tuzk<T> {
	private subtasks: Tuzk<unknown>[];

	constructor(tasks: Tuzk<unknown>[], runner: TuzkRunner<T>) {
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

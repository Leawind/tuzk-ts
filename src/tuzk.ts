import { Delegate } from '@leawind/delegate';

import { CancelledError, InvalidActionError, NeverError, TuzkError } from '@/errors.ts';
import { type PromiseControl, type TuzkLike, type TuzkRunner, TuzkState } from '@/types.ts';

/**
 * Tuzk is task that can be started, paused, resumed, canceled.
 *
 * ## progress
 *
 * In the runner, you can use {@link Tuzk.checkpoint} or {@link Tuzk.setProgress} to update the progress.
 *
 * You can use {@link Tuzk.onProgressUpdated} to listen to the progress change.
 *
 * @template R Result type
 * @template AllowedFields Fields that can be accessed in runner
 */
export class Tuzk<R, AllowedFields extends string = never> {
	#_allowedFieldsTypeHolder!: AllowedFields;

	private readonly runner: TuzkRunner<Tuzk<R>>;

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

	private checkpointPromiseAction: PromiseControl | null = null;

	/**
	 * If this task was failed, this will be set.
	 */
	public error?: unknown;

	private state: TuzkState = TuzkState.Pending;

	private result?: R;

	// Delegates
	public readonly onProgressUpdated: Delegate<number> = new Delegate<number>();
	public readonly onStateUpdated: Delegate<TuzkState> = new Delegate<TuzkState>();

	public constructor(runner: TuzkRunner<Tuzk<R>>) {
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
	public getResult(): R | undefined {
		return this.result;
	}

	/////////////////////////////////////////////////////////////////
	// Running
	/////////////////////////////////////////////////////////////////

	/**
	 * This method can:
	 *
	 * - Update the progress
	 * - Check if the task should be paused or canceled
	 *     - If the task is marked as canceled by {@link Tuzk.cancel}, it throws a {@link CancelledError}.
	 *     - If the task is marked as paused by {@link Tuzk.pause}, it won't resolve until {@link Tuzk.resume} is called.
	 *
	 * Always invoke and await this method in a task runner.
	 *
	 * @param progress Progress to set.
	 *
	 * @throws {InvalidActionError} If the task is not running.
	 * @throws {TuzkError} If progress is not in range [0.0, 1.0].
	 * @throws {CancelledError} If this task is marked as canceled.
	 */
	public checkpoint(progress?: number): Promise<void> {
		if (!this.stateIs(TuzkState.Running)) {
			throw new InvalidActionError(`Tuzk can invoke checkpoint only during running`);
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
				reject(new CancelledError());
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
	 * Start this task.
	 *
	 * @throws {TuzkError} If the task is already started.
	 * @throws {CancelledError} If the task is canceled.
	 * @throws {unknown} If the given {@link Tuzk.runner} throws any error.
	 *
	 * @returns A promise that resolves when the task is finished.
	 */
	public async start(): Promise<R> {
		if (this.isActive()) {
			throw new InvalidActionError(`Tuzk can not started again when active`);
		}

		try {
			this.setState(TuzkState.Running);

			// Wait for runner to finish
			await this.checkpoint(0);
			this.result = await this.runner(this);
			this.setProgress(1);

			this.setState(TuzkState.Success);

			return this.result;
		} catch (error: unknown) {
			this.error = error;
			this.setState(error instanceof CancelledError ? TuzkState.Canceled : TuzkState.Failed);
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
	 * @throws {InvalidActionError} If the task is not running.
	 */
	public pause(): void {
		if (this.isActive()) {
			this.shouldPause = true;
		} else {
			throw new InvalidActionError(`Cannot pause a tuzk when it's not running or paused`);
		}
	}

	/**
	 * Resume this task.
	 *
	 * If the task is marked as paused, it will be marked as not paused.
	 *
	 * If the task is really paused, it will be resumed.
	 *
	 * @throws {InvalidActionError} If the task is not running.
	 */
	public resume(): void {
		if (this.isActive()) {
			this.shouldPause = false;

			if (this.state === TuzkState.Paused) {
				if (this.checkpointPromiseAction === null) {
					throw new NeverError(`checkpointPromiseAction should not be null when paused`);
				}
				this.checkpointPromiseAction.resolve();
				this.checkpointPromiseAction = null;
				this.setState(TuzkState.Running);
			}
		} else {
			throw new InvalidActionError(`Cannot resume a tuzk when it's not paused or running`);
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
	 * @throws {InvalidActionError} If the task is not running.
	 */
	public cancel(): void {
		switch (this.state) {
			case TuzkState.Running:
			case TuzkState.Paused:
			case TuzkState.Canceled:
				this.shouldCancel = true;
				if (this.checkpointPromiseAction !== null) {
					this.checkpointPromiseAction.reject(new CancelledError());
				}
				break;
			default:
				throw new InvalidActionError(`Cannot cancel a tuzk when it's not running, paused or canceled`);
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

	public stateIs(state: TuzkState): boolean;
	public stateIs(state: `${TuzkState}`): boolean;
	public stateIs(state: TuzkState | `${TuzkState}`): boolean {
		return this.state === state;
	}

	public isActive(): boolean {
		switch (this.state) {
			case TuzkState.Running:
			case TuzkState.Paused:
				return true;
			default:
				return false;
		}
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
	 * If the given value is a TuzkRunner, a new Tuzk instance will be created and returned.
	 * If the given value is a Tuzk instance, it will be returned as is.
	 *
	 * @see TuzkLike
	 * @see TuzkRunner
	 */
	public static from<R, F extends string = never>(value: TuzkLike<R, F>): Tuzk<R, F> {
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
	public static all<R>(tasks: TuzkLike<R>[]): Tuzk<R[]> {
		const tuzks: Tuzk<R>[] = tasks.map((runner) => Tuzk.from(runner));
		const promises: Promise<R>[] = tuzks.map((task) => task.start());

		return new CompositeTuzk<R[], R>(tuzks, async () => {
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
	public static race<R>(tasks: TuzkLike<R>[]): Tuzk<R> {
		const tuzks: Tuzk<R>[] = tasks.map((runner) => Tuzk.from(runner));
		const promises: Promise<R>[] = tuzks.map((task) => task.start());
		return new CompositeTuzk<R, R>(
			tuzks,
			() => Promise.race(promises),
		);
	}
}

/**
 * Composite task that manages multiple child tasks
 * @template R - Result type of the composite task
 * @template SubR - Result type of child tasks
 */
export class CompositeTuzk<R, SubR> extends Tuzk<R> {
	/** Child tasks managed by this composite task */
	private subtasks: Tuzk<SubR>[];

	/**
	 * Creates a nested task container
	 * @param tasks - Array of child tasks to manage
	 * @param runner - Execution logic for the composite task
	 */
	public constructor(tasks: Tuzk<SubR>[], runner: TuzkRunner<Tuzk<R>>) {
		super(runner);
		this.subtasks = [...tasks];
	}

	/**
	 * Suspends execution of this task and all child tasks
	 * @throws {InvalidActionError} If task isn't in runnable state
	 */
	public override pause(): void {
		super.pause();
		for (const task of this.subtasks) {
			task.pause();
		}
	}

	/**
	 * Resumes execution of this task and all child tasks
	 * @throws {InvalidActionError} If task isn't in pausable state
	 */
	public override resume(): void {
		super.resume();
		for (const task of this.subtasks) {
			task.resume();
		}
	}

	/**
	 * Cancels execution of this task and all child tasks
	 * @throws {InvalidActionError} If task isn't in cancelable state
	 */
	public override cancel(): void {
		super.cancel();
		for (const task of this.subtasks) {
			task.cancel();
		}
	}
}

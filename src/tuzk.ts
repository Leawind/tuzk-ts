import { Delegate } from '@leawind/delegate';

import { CancelledError, InvalidStateError, NeverError, TuzkError } from '@/errors.ts';
import { type BaseActiveTuzk, type PromiseControl, type TuzkLike, type TuzkRunner, TuzkState } from '@/types.ts';

/**
 * Tuzk is task that can be runed, paused, resumed, cancelled.
 *
 * ## Progress
 *
 * In the runner, you can use {@link Tuzk.checkpoint} or {@link Tuzk.setProgress} to update the progress.
 *
 * You can use {@link Tuzk.onProgressUpdated} to listen to the progress change.
 *
 * ## Extend
 *
 * You can extend Tuzk to add your own methods.
 *
 * ```ts
 * interface ExtendedTask {
 *   wait(ms: number): Promise<void>;
 * }
 *
 * class MyTask extends Tuzk<void, keyof ExtendedTask> implements ExtendedTask {
 *   constructor(runner: TuzkRunner<MyTask>) {
 *     super(runner as TuzkRunner<Tuzk<void>>);
 *   }
 *   wait(ms: number) {
 *     return new Promise<void>((r) => setTimeout(r, ms));
 *   }
 * }
 *
 * const task = new MyTask(async (t) => {
 *   await t.wait(100);
 *   await t.checkpoint(0.5)
 *   await t.wait(100);
 * });
 * ```
 *
 * @template R Result type
 * @template ActiveKeys Fields and methods that can be accessed in runner while it's active
 */
export class Tuzk<R, ActiveKeys extends string = never> implements BaseActiveTuzk {
	#_ActiveKeysTypeHolder!: ActiveKeys;

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
	 * Whether this task should be cancelled.
	 */
	private shouldCancel: boolean = false;

	private checkpointPromiseControl: PromiseControl | null = null;

	/**
	 * If this task was failed, this will be set.
	 */
	public error?: unknown;

	private state: TuzkState = TuzkState.Pending;

	private result?: R;

	// Delegates
	public readonly onProgressUpdated = new Delegate<number>();
	public readonly onStateUpdated = new Delegate<[oldState: TuzkState, newState: TuzkState]>();

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
	 * Get the current state of the task.
	 *
	 * @returns The current state of the task.
	 */
	public getState(): TuzkState {
		return this.state;
	}

	protected setState(state: TuzkState): void {
		if (this.state !== state) {
			const oldState = this.state;
			this.state = state;
			this.onStateUpdated.broadcast([oldState, this.state]);
		}
	}

	/**
	 * Start to run this task.
	 *
	 * @throws {InvalidStateError} If the task is active
	 * @throws {CancelledError} If the task is cancelled.
	 * @throws {unknown} If the given {@link Tuzk.runner} throws any error.
	 *
	 * @returns A promise that resolves when the task is finished.
	 */
	public run(): Promise<R> {
		const promise = (async () => {
			if (this.isActive()) {
				throw new InvalidStateError(this.state, 'pending or finished', 'run');
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
				this.setState(error instanceof CancelledError ? TuzkState.Cancelled : TuzkState.Failed);
				throw error;
			} finally {
				this.shouldCancel = false;
				this.shouldPause = false;
			}
		})();
		return promise;
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
	// interface ActiveTuzk
	/////////////////////////////////////////////////////////////////

	public setProgress(progress: number): void {
		Tuzk.validateProgress(progress);
		if (this.progress !== progress) {
			this.progress = progress;
			this.onProgressUpdated.broadcast(this.progress);
		}
	}

	public checkpoint(progress?: number): Promise<void> {
		if (!this.stateIs(TuzkState.Running)) {
			throw new InvalidStateError(this.state, 'active', 'invoke checkpoint()');
		}

		return new Promise((resolve, reject) => {
			// Update progress
			if (progress !== undefined) {
				this.setProgress(progress);
			}

			this.checkpointPromiseControl = null;

			// Check cancel
			if (this.shouldCancel) {
				this.setState(TuzkState.Cancelled);
				// If do not reject or resolve, the Promise will stay in memory forever.
				reject(new CancelledError());
			} else {
				// Check pause
				if (this.shouldPause) {
					this.setState(TuzkState.Paused);
					this.checkpointPromiseControl = { resolve, reject };
				} else {
					this.setState(TuzkState.Running);
					resolve();
				}
			}
		});
	}

	public pause(): void {
		if (this.isActive()) {
			this.shouldPause = true;
		} else {
			throw new InvalidStateError(this.state, 'active', 'pause');
		}
	}

	public resume(): void {
		if (this.isActive()) {
			this.shouldPause = false;

			if (this.state === TuzkState.Paused) {
				if (this.checkpointPromiseControl === null) {
					throw new NeverError(`checkpointPromiseAction should not be null when paused`);
				}
				this.checkpointPromiseControl.resolve();
				this.checkpointPromiseControl = null;
				this.setState(TuzkState.Running);
			}
		} else {
			throw new InvalidStateError(this.state, 'active', 'resume');
		}
	}

	public cancel(): void {
		switch (this.state) {
			case TuzkState.Running:
			case TuzkState.Paused:
			case TuzkState.Cancelled:
				this.shouldCancel = true;
				if (this.checkpointPromiseControl !== null) {
					this.checkpointPromiseControl.reject(new CancelledError());
				}
				break;
			default:
				throw new InvalidStateError(this.state, 'active or cancelled', 'cancel');
		}
	}

	public isMarkedAsPaused(): boolean {
		return this.shouldPause;
	}

	public isMarkedAsCancelled(): boolean {
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
			case TuzkState.Cancelled:
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

	public static from<R, F extends string>(runner: TuzkRunner<Tuzk<R, F>>): Tuzk<R, F>;
	public static from<R, F extends string>(value: TuzkLike<R, F>): Tuzk<R, F>;
	public static from<R, F extends string>(value: TuzkLike<R, F>): Tuzk<R, F> {
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
		const promises: Promise<R>[] = tuzks.map((task) => task.run());

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
		const promises: Promise<R>[] = tuzks.map((task) => task.run());
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

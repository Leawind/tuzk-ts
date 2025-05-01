import type { Tuzk } from '@/tuzk.ts';

/**
 * Represents the possible states of a Tuzk task
 */
export enum TuzkState {
	/** Task has been created but not started yet */
	Pending = 'pending',

	// Active

	/** Task is currently executing */
	Running = 'running',

	/** Task execution has been temporarily suspended */
	Paused = 'paused',

	// Finished

	/** Task completed successfully */
	Success = 'success',
	/**
	 * Task failed due to an error
	 * @see Tuzk#error
	 */
	Failed = 'failed',
	/** Task was cancelled before completion */
	Cancelled = 'cancelled',
}

export interface BaseActiveTuzk {
	/**
	 * Set progress of the task.
	 *
	 * @param progress Progress to set.
	 * @throws {TuzkError} If progress is not in range [0.0, 1.0].
	 */
	setProgress(progress: number): void;

	/**
	 * This method should only be invoked and awaited in a {@link TuzkRunner}.
	 *
	 * It does:
	 *
	 * - Update the progress if specified
	 * - Check if the task should be paused or cancelled
	 *     - If the task is marked as cancelled by {@link cancel}, it throws a `CancelledError`.
	 *     - If the task is marked as paused by {@link pause}, it won't resolve until {@link resume} is called.
	 *
	 * Example:
	 *
	 * ```ts
	 * const task = new Tuzk<void>(async (tuzk)=>{
	 *     for (let i = 1; i <= 64; i++) {
	 *         await tuzk.checkpoint(i / 64);
	 *     }
	 * })
	 * ```
	 *
	 * @param progress Progress to set.
	 *
	 * @throws {InvalidStateError} If the task is not active.
	 * @throws {TuzkError} If progress is not in range [0.0, 1.0].
	 * @throws {CancelledError} If this task is marked as cancelled.
	 */
	checkpoint(progress?: number): Promise<void>;
	/**
	 * Mark this task as paused.
	 *
	 * Next time the runner calls {@link checkpoint}, the task will be really paused.
	 *
	 * @throws {InvalidStateError} If the task is not active.
	 */
	pause(): void;

	/**
	 * Resume this task.
	 *
	 * If the task is marked as paused, it will be marked as not paused.
	 *
	 * If the task is really paused, it will be resumed.
	 *
	 * @throws {InvalidStateError} If the task is not running.
	 */
	resume(): void;

	/**
	 * Mark this task as cancelled.
	 *
	 * Next time the runner calls {@link checkpoint}, the task will no longer run.
	 *
	 * @throws {InvalidStateError} If the task is not running.
	 */
	cancel(): void;

	/**
	 * Check if this task is marked as paused.
	 */
	isMarkedAsPaused(): boolean;

	/**
	 * Check if this task is marked as cancelled.
	 */
	isMarkedAsCancelled(): boolean;
}

type BaseTuzk = Tuzk<unknown, string>;

/**
 * Extracts the return type from a Tuzk type
 * @template T - The Tuzk instance type to inspect
 */
type TuzkReturnType<T extends BaseTuzk> = T extends Tuzk<infer R, string> ? R : never;
/**
 * Extracts the active keys from a Tuzk type
 * @template T - The Tuzk instance type to inspect
 */
type TuzkActiveKeys<T extends BaseTuzk> = T extends Tuzk<unknown, infer F> ? F : never;

/**
 * Extracts the active Tuzk type from a given Tuzk type
 * @template T - The Tuzk type to inspect
 */
export type ActiveTuzk<T extends BaseTuzk> = Pick<T, Extract<keyof T, keyof BaseActiveTuzk | TuzkActiveKeys<T>>>;

/**
 * Function signature for task execution logic
 * @template T - The Tuzk instance type this runner works with
 */
export type TuzkRunner<T extends BaseTuzk> = (task: ActiveTuzk<T>) =>
	| PromiseLike<TuzkReturnType<T>>
	| TuzkReturnType<T>;

/**
 * Type representing objects that can be converted to a Tuzk instance
 * @template R - Type of the task result
 * @see Tuzk.from Conversion method
 */
export type TuzkLike<R, F extends string = never> = TuzkRunner<Tuzk<R, F>> | Tuzk<R, F>;

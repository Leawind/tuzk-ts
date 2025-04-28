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
	/** Task failed due to an error */
	Failed = 'failed',
	/** Task was canceled before completion */
	Canceled = 'canceled',
}

/**
 * Core methods that are always available on any Tuzk instance
 */
export type TuzkCoreMethods =
	| 'setProgress'
	| 'checkpoint'
	| 'pause'
	| 'resume'
	| 'cancel';

type BaseTuzk = Tuzk<unknown, string>;

/**
 * Extracts allowed method names from a specific Tuzk type
 * @template T - The Tuzk instance type to inspect
 */
type TuzkAllowedFields<T extends BaseTuzk> = T extends Tuzk<unknown, infer F> ? F : never;
/**
 * Extracts the return type from a Tuzk instance
 * @template T - The Tuzk instance type to inspect
 */
type TuzkReturnType<T extends BaseTuzk> = T extends Tuzk<infer R, string> ? R : never;

/**
 * Provides a restricted interface containing only allowed methods of a Tuzk instance
 * @template T - The Tuzk type to create an interface for
 */
export type TuzkAllowedInterface<T extends BaseTuzk> = Pick<
	T,
	Extract<keyof T, TuzkAllowedFields<T> | TuzkCoreMethods>
>;

/**
 * Function signature for task execution logic
 * @template T - The Tuzk instance type this runner works with
 */
export type TuzkRunner<T extends BaseTuzk> = (task: TuzkAllowedInterface<T>) =>
	| PromiseLike<TuzkReturnType<T>>
	| TuzkReturnType<T>;

/**
 * Type representing objects that can be converted to a Tuzk instance
 * @template R - Type of the task result
 * @see Tuzk.from Conversion method
 */
export type TuzkLike<R> = Tuzk<R> | TuzkRunner<Tuzk<R>>;

/**
 * Control interface for managing Promise resolution
 */
export type PromiseControl = {
	resolve: (value: void | PromiseLike<void>) => void;
	reject: (reason?: unknown) => void;
};

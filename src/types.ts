import type { Tuzk } from '@/tuzk.ts';

/**
 * The state of a Tuzk task.
 */
export enum TuzkState {
	/**
	 * Not started yet
	 */
	Pending = 'pending',

	// Active

	/**
	 * Already started, not finished yet
	 */
	Running = 'running',

	/**
	 * Paused by {@link Tuzk.pause}.
	 * Use {@link Tuzk.resume} to resume.
	 */
	Paused = 'paused',

	// Finished
	Success = 'success',
	Failed = 'failed',
	Canceled = 'canceled',
}

export type TuzkCoreMethods =
	| 'setProgress'
	| 'checkpoint'
	| 'pause'
	| 'resume'
	| 'cancel';

type BaseTuzk = Tuzk<unknown, string>;
type TuzkAllowedFields<T extends BaseTuzk> = T extends Tuzk<unknown, infer F> ? F : never;
type TuzkReturnType<T extends BaseTuzk> = T extends Tuzk<infer R, string> ? R : never;

export type TuzkAllowedInterface<T extends BaseTuzk> = Pick<
	T,
	Extract<keyof T, TuzkAllowedFields<T> | TuzkCoreMethods>
>;

export type TuzkRunner<T extends BaseTuzk> = (task: TuzkAllowedInterface<T>) =>
	| PromiseLike<TuzkReturnType<T>>
	| TuzkReturnType<T>;

/**
 * Can be converted to a Tuzk using {@link Tuzk.from}
 */
export type TuzkLike<R> = Tuzk<R> | TuzkRunner<Tuzk<R>>;

export type PromiseControl = {
	resolve: (value: void | PromiseLike<void>) => void;
	reject: (reason?: unknown) => void;
};

import type { Tuzk } from '@/tuzk.ts';

/**
 * The state of a Tuzk task.
 */
export enum TuzkState {
	/**
	 * Not started yet
	 */
	Pending = 'pending',

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

export type RunnerKeys =
	| 'setProgress'
	| 'checkpoint'
	| 'pause'
	| 'resume'
	| 'cancel';

export type TuzkPicked<T> = T extends Tuzk<unknown, infer F> ? Pick<T, Extract<keyof T, F | RunnerKeys>>
	: never;

/**
 * A function to run the task.
 *
 * If you never invoke it, the task can not be paused or canceled during running
 */
export type TuzkRunner<T> = T extends Tuzk<infer R, string> ? (task: TuzkPicked<T>) => PromiseLike<R> | R
	: never;

/**
 * Can be converted to a Tuzk using {@link Tuzk.from}
 */
export type TuzkLike<R> = Tuzk<R> | TuzkRunner<Tuzk<R>>;

export type PromiseAction = {
	resolve: (value: void | PromiseLike<void>) => void;
	reject: (reason?: unknown) => void;
};

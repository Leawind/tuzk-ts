import type { Tuzk } from '@/index.ts';

/**
 * Base class for all tuzk errors
 */
export class TuzkError extends Error {}

/**
 * Thrown when an invalid action is performed on a tuzk
 */
export class InvalidActionError extends TuzkError {}

/**
 * Thrown when:
 * - The tuzk is canceled
 * - Any dependency is canceled
 */
export class CanceledError extends TuzkError {}

/**
 * Thrown when a dependency fails
 *
 * @param dependency The dependency that failed
 */
export class DependencyFailedError extends TuzkError {
	constructor(public readonly dependency: Tuzk<unknown>) {
		super();
	}
}

/**
 * If this error is thrown, it means there's probably a bug in tuzk
 */
export class NeverError extends TuzkError {}

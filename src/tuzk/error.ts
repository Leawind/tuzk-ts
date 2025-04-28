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
 */
export class CanceledError extends TuzkError {}

/**
 * If this error is thrown, it means there's probably a bug in tuzk
 */
export class NeverError extends TuzkError {}

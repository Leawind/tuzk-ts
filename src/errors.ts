import type { TuzkState } from '@/types.ts';

/**
 * Base class for all tuzk errors
 */
export class TuzkError extends Error {}

export class InvalidStateError extends TuzkError {
	constructor(
		public currentState: TuzkState,
		public allowedStates: string,
		public action: string,
	) {
		super(`Cannot ${action} when in ${currentState} state. Allowed states: [${allowedStates}]`);
		this.name = 'InvalidStateError';
	}
}

/**
 * Thrown when:
 * - The tuzk is cancelled
 */
export class CancelledError extends TuzkError {}

/**
 * If this error is thrown, it means there's probably a bug in tuzk
 */
export class NeverError extends TuzkError {}

import type { Tuzk } from '@/index.ts';

export class TuzkError extends Error {}

export class TuzkInvalidActionError extends Error {}

export class TuzkCanceledError extends TuzkError {}

export class TuzkDependencyFailedError extends TuzkError {
	constructor(public readonly dependency: Tuzk<unknown>) {
		super();
	}
}

export class TuzkNeverError extends TuzkError {}

import { Delegate } from '@leawind/delegate';
import { Tuzk } from '@/tuzk.ts';
import { type TuzkLike, TuzkState } from '@/types.ts';

const $manager = Symbol('manager');
const $dependencies = Symbol('dependencies');
const $areDependenciesMet = Symbol('areDependenciesMet');

type TuzkWrapper = {
	[$manager]?: TuzkManager;
	[$dependencies]: Set<Tuzk<unknown, string>>;
	[$areDependenciesMet](): boolean;
};
type WrappedTuzk<R = unknown> = Tuzk<R, string> & TuzkWrapper;

/**
 * Manages a collection of Tuzk tasks, handling task submission, execution, and dependencies
 */
export class TuzkManager {
	/**
	 * Event triggered when a task is activated
	 */
	public readonly onTaskActivated: Delegate<Tuzk<unknown, string>> = new Delegate<Tuzk<unknown, string>>(
		'onTaskActivated',
	);
	/**
	 * Event triggered when a task is finished
	 */
	public readonly onTaskFinished: Delegate<Tuzk<unknown, string>> = new Delegate<Tuzk<unknown, string>>(
		'onTaskFinished',
	);
	/**
	 * Event triggered when all tasks are finished
	 */
	public readonly onAllTasksFinished: Delegate<void> = new Delegate<void>('onAllTasksFinished');

	// Task Queues
	// push / shift
	/**
	 * Queue for tasks waiting to be activated
	 */
	protected readonly pendingQueue: WrappedTuzk[] = [];
	/**
	 * Set of currently active tasks
	 */
	protected readonly activated: Set<WrappedTuzk> = new Set();
	/**
	 * Set of completed tasks
	 */
	protected readonly finished: Set<WrappedTuzk> = new Set();

	public constructor(
		/**
		 * Maximum number of concurrent tasks allowed
		 * @default 8
		 */
		public concurrency = 8,
	) {}

	/**
	 * Checks if all tasks are finished
	 * @returns true if no pending or active tasks remain
	 */
	public isAllFinished(): boolean {
		return this.pendingQueue.length === 0 && this.activated.size === 0;
	}

	/**
	 * Adds a dependency between two tasks
	 * @param tuzk - The task that depends on another
	 * @param dependency - The task that must complete first
	 */
	public addDependency<R>(tuzk: Tuzk<R, string>, dependency: Tuzk<unknown, string>) {
		const task = this.wrapTuzk(tuzk);
		if (!canDependOn(task, dependency)) {
			throw new Error('Circular dependency detected');
		}

		task[$dependencies].add(dependency);

		function canDependOn(task: Tuzk<unknown, string>, dep: Tuzk<unknown, string>) {
			if (dep === task) {
				return false;
			}
			if (!isWrappedTuzk(dep)) {
				return false;
			}
			if (dep[$dependencies].has(dep)) {
				return false;
			}
			for (const d of dep[$dependencies]) {
				if (!canDependOn(task, d)) {
					return false;
				}
			}
			return true;
		}
		function isWrappedTuzk(tuzk: Tuzk<unknown, string>): tuzk is WrappedTuzk {
			return (tuzk as WrappedTuzk)[$manager] !== undefined;
		}
	}

	/**
	 * Attempts to activate pending tasks if concurrency limit allows
	 */
	protected tryActivatePendingTasks(): void {
		let i = 0;
		while (i < this.pendingQueue.length && this.activated.size < this.concurrency) {
			const task = this.pendingQueue[i];
			if (task[$areDependenciesMet]()) {
				this.pendingQueue.splice(i, 1);
				this.activated.add(task);
				task.run();
				this.onTaskActivated.broadcast(task);
				continue;
			}
			i++;
		}
	}

	/**
	 * Wraps a Tuzk instance with additional manager-specific functionality
	 * @param tuzk - The Tuzk instance to wrap
	 * @returns The wrapped Tuzk instance
	 */
	protected wrapTuzk<R>(tuzk: Tuzk<R, string>): WrappedTuzk<R> {
		const task = Object.assign(tuzk, {
			[$dependencies]: new Set(),
			[$areDependenciesMet]() {
				for (const dependency of this[$dependencies]) {
					if (!dependency.stateIs('success')) {
						return false;
					}
				}
				return true;
			},
		} as TuzkWrapper);

		if (task[$manager] === this) {
			return task;
		}
		if (task[$manager] !== undefined) {
			throw new Error(`Task belongs to another manager: ${task[$manager]}`);
		}

		task[$manager] = this;

		task.onStateUpdated.setListener(TuzkManager, (event) => {
			if (task[$manager] !== this) {
				event.removeSelf();
				return;
			}

			const [oldState] = event.data;

			switch (tuzk.getState()) {
				case TuzkState.Running:
				case TuzkState.Paused: {
					if (oldState !== TuzkState.Running && oldState !== TuzkState.Paused) {
						// Activated
						this.onTaskActivated.broadcast(task);
					}
					break;
				}
				case TuzkState.Success:
				case TuzkState.Failed:
				case TuzkState.Cancelled: {
					// Finished

					// move self to finished set
					this.activated.delete(task);
					this.finished.add(task);

					// find pending task to start
					this.tryActivatePendingTasks();

					// broadcast
					this.onTaskFinished.broadcast(tuzk);
					if (this.isAllFinished()) {
						this.onAllTasksFinished.broadcast();
					}

					event.removeSelf();
					break;
				}
			}
		});

		return task;
	}

	/**
	 * Submits a new task to be managed
	 * @param tuzkLike - The task or task-like object to submit
	 * @param dependencies - Optional set of tasks this task depends on
	 * @returns The wrapped task instance
	 */
	public submit<R>(tuzkLike: TuzkLike<R>, dependencies?: Iterable<Tuzk<unknown, string>>): WrappedTuzk<R> {
		const tuzk = Tuzk.from(tuzkLike);
		const task = this.wrapTuzk(tuzk);
		this.finished.delete(task);

		if (dependencies) {
			for (const dependency of dependencies) {
				this.addDependency(task, dependency);
			}
		}

		if (task.isActive()) {
			this.activated.add(task);
			return task;
		}

		// Task is not active

		if (this.activated.size < this.concurrency) {
			// activated set is not full, can start immediately
			this.activated.add(task);
			task.run();
			this.onTaskActivated.broadcast(task);
		} else {
			// activated set is full, add to pending queue
			this.pendingQueue.push(task);
		}

		return task;
	}

	/**
	 * Waits for all tasks to complete
	 * @returns A promise that resolves when all tasks are finished
	 */
	public waitForAll(): Promise<void> {
		if (this.isAllFinished()) {
			return Promise.resolve();
		}

		return new Promise<void>((resolve) => {
			this.onAllTasksFinished.addListener((e) => {
				resolve();
				e.removeSelf();
			});
		});
	}
}

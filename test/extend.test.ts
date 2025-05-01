import { assert } from '@std/assert';
import { type ActiveTuzk, Tuzk, type TuzkRunner } from '@/index.ts';

Deno.test('extends Tuzk', async () => {
	interface ExtendedTask {
		wait(ms: number): Promise<void>;
	}

	class MyTask extends Tuzk<void, keyof ExtendedTask> implements ExtendedTask {
		public constructor(runner: TuzkRunner<MyTask>) {
			super(runner as TuzkRunner<Tuzk<void>>);
		}

		public wait(ms: number) {
			return new Promise<void>((r) => setTimeout(r, ms));
		}
	}

	const task = new MyTask(async (task: ActiveTuzk<MyTask>) => {
		await task.wait(50);
		await task.checkpoint(0.5);
		await task.wait(50);
	});

	assert(task.stateIs('pending'));
	await task.run();
	assert(task.stateIs('success'));
});

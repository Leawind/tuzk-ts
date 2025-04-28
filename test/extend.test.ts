import { assert } from '@std/assert';
import { Tuzk, type TuzkAllowedInterface, type TuzkRunner } from '@/index.ts';

Deno.test('extends Tuzk', async () => {
	class MyTask extends Tuzk<void, 'wait'> {
		public constructor(runner: TuzkRunner<MyTask>) {
			super(runner as TuzkRunner<Tuzk<void>>);
		}

		/**
		 * my method!
		 */
		public wait(ms: number) {
			return new Promise<void>((r) => setTimeout(r, ms));
		}
	}

	const task = new MyTask(async (task: TuzkAllowedInterface<MyTask>) => {
		console.log(`wait begin`);
		await task.wait(50);
		await task.checkpoint(0.5);
		await task.wait(50);
		console.log(`wait end`);
	});

	assert(task.stateIs('pending'));
	await task.start();
	assert(task.stateIs('success'));
});

import { assert } from '@std/assert';
import { Tuzk } from '@/index.ts';

Deno.test('Example: basic', async () => {
	const task: Tuzk<number> = new Tuzk<number>(async (tuzk) => {
		let sum = 0;
		for (let i = 1; i <= 100; i++) {
			sum += i;
			// Update progress and check if this task is marked as paused or canceled
			await tuzk.checkpoint(i / 100);
		}
		return sum;
	});

	assert(task.stateIs('pending'));
	const result = await task.start();
	assert(task.stateIs('success'));

	assert(result === 5050);
});

Deno.test('Example: all', async () => {
	const tuzks: Tuzk<void>[] = [
		new Tuzk(async (tuzk) => await tuzk.checkpoint(0.5)),
		new Tuzk(async (tuzk) => await tuzk.checkpoint(0.5)),
	];

	const tuzkAll = Tuzk.all(tuzks);

	// It auto starts all subtasks
	await tuzkAll.start();

	assert(tuzks[0].stateIs('success'));
	assert(tuzks[1].stateIs('success'));

	assert(tuzkAll.stateIs('success'));
});

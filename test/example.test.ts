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

Deno.test('Example: dependency', async () => {
	const tuzk1: Tuzk<void> = new Tuzk(async (tuzk) => await tuzk.checkpoint(0.5));
	const tuzk2: Tuzk<void> = new Tuzk(async (tuzk) => await tuzk.checkpoint(0.5));

	tuzk2.addDependency(tuzk1);

	// You need to manually start the dependency
	tuzk1.start();
	await tuzk2.start();

	assert(tuzk1.stateIs('success'));
	assert(tuzk2.stateIs('success'));
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

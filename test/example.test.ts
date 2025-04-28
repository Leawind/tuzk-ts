import { assert } from '@std/assert';
import { TimeRuler } from '@leawind/inventory/test_utils';
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

Deno.test('Task state changing', async () => {
	const t = new TimeRuler(0);

	//             0       100       200       300       400
	// Time        |----|----|----|----|----|----|----|----|
	// Progress    0         0.33      0.66      1.0
	// Action      S    P         R
	// Running     >>>>>>>>>>>....>>>>>>>>>>>>>>>>
	const task = new Tuzk<number>(async (tuzk) => {
		await t.til(100);
		await tuzk.checkpoint(0.4);

		await t.til(200);
		await tuzk.checkpoint(0.6);

		await t.til(300);
		return 12138;
	});

	assert(task.stateIs('pending'));
	task.start();
	assert(task.stateIs('running'));

	await t.til(50);
	task.pause();
	assert(task.stateIs('running'));

	await t.til(150);
	assert(task.stateIs('paused'));
	task.resume();
	assert(task.stateIs('running'));

	await t.til(350);
	assert(task.stateIs('success'));

	const result = task.getResult();
	assert(result === 12138);
});

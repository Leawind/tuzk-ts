import { assert, assertRejects, assertStrictEquals, assertThrows } from '@std/assert';
import { errors, Tuzk } from '@/index.ts';

const testWaitTimeoutIds: number[] = [];
function testWait(ms: number): Promise<void> {
	return new Promise((resolve) => testWaitTimeoutIds.push(setTimeout(resolve, ms)));
}
function clearTestTimeouts() {
	while (testWaitTimeoutIds.length > 0) {
		clearTimeout(testWaitTimeoutIds[0]);
		testWaitTimeoutIds.shift();
	}
}

Deno.test('task should run successfully', async () => {
	const tuzk = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.5);
	});
	await tuzk.run();

	assertStrictEquals(tuzk.getProgress(), 1.0);

	assert(tuzk.isFinished());
	assert(tuzk.stateIs('success'));

	assert(!tuzk.isMarkedAsCancelled());
	assert(!tuzk.isMarkedAsPaused());
});

Deno.test('task should be paused and resumed', async () => {
	const tuzk = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.5);
		tuzk.pause();
		await tuzk.checkpoint(0.8);
	});
	const runPromise = tuzk.run();

	// Wait for the task to pause
	await new Promise((resolve) => setTimeout(resolve, 100));

	assertStrictEquals(tuzk.stateIs('paused'), true);
	tuzk.resume();
	await runPromise;
	assertStrictEquals(tuzk.getProgress(), 1.0);
	assert(tuzk.isFinished());
	assert(tuzk.stateIs('success'));
});

Deno.test('task resume when not paused', async () => {
	const tuzk = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.3);
		tuzk.resume();
		await tuzk.checkpoint(0.6);
	});
	await tuzk.run();

	assert(tuzk.stateIs('success'));
});

Deno.test('task should be cancelled', async () => {
	const tuzk = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.5);
		tuzk.cancel();
		await tuzk.checkpoint(0.8);
	});

	await assertRejects(async () => await tuzk.run(), errors.CancelledError);

	assert(tuzk.stateIs('cancelled'));
});

Deno.test('task should be cancelled when paused', async () => {
	const tuzk = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.3);
		tuzk.pause();
		tuzk.cancel();
		await tuzk.checkpoint(0.6);
		assert(false);
	});

	await assertRejects(async () => await tuzk.run(), errors.CancelledError);

	assert(tuzk.stateIs('cancelled'));
});

Deno.test('task should throw error on invalid progress', () => {
	const tuzk = new Tuzk(async () => {});
	assertThrows(() => tuzk.setProgress(1.5), errors.TuzkError);
});

Deno.test('all tasks should run successfully', async () => {
	const tuzk1 = new Tuzk(async (tuzk) => {
		await testWait(10);
		await tuzk.checkpoint(0.5);
		await testWait(10);
	});
	const tuzk2 = new Tuzk(async (tuzk) => {
		await testWait(50);
		await tuzk.checkpoint(0.5);
		await testWait(50);
	});
	const tuzkAll = Tuzk.all([tuzk1, tuzk2]);

	performance.mark('start');
	await tuzkAll.run();
	performance.mark('end');
	assert(performance.measure('', 'start', 'end').duration > 60);

	assertStrictEquals(tuzk1.getProgress(), 1.0);
	assertStrictEquals(tuzk2.getProgress(), 1.0);
	assertStrictEquals(tuzkAll.isFinished(), true);
	assertStrictEquals(tuzkAll.getState(), 'success');
});

Deno.test('all tasks should handle cancellation', async () => {
	const tuzk1 = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.5);
	});
	const tuzk2 = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.5);
		tuzk2.cancel();
		await tuzk.checkpoint(0.8);
	});
	const tuzkAll = Tuzk.all([tuzk1, tuzk2]);
	await assertRejects(async () => await tuzkAll.run(), errors.CancelledError);
	assert(!tuzk1.stateIs('cancelled'));
	assert(tuzk2.stateIs('cancelled'));
	assert(tuzkAll.stateIs('cancelled'));
});

Deno.test('all tasks should handle failure', async () => {
	const tuzk1 = new Tuzk<void>(async (tuzk) => {
		await tuzk.checkpoint(0.5);
	});
	const tuzk2 = new Tuzk<void>(async (tuzk) => {
		await tuzk.checkpoint(0.5);
		throw new Error('Task failed');
	});
	const tuzkAll = Tuzk.all([tuzk1, tuzk2]);
	await assertRejects(
		async () => await tuzkAll.run(),
		Error,
		'Task failed',
	);
	assert(tuzk1.stateIs('success'));
	assert(tuzk2.stateIs('failed'));
	assert(tuzkAll.stateIs('failed'));
});

// Race

Deno.test('race should run the first task that completes successfully', async () => {
	const tuzk1 = new Tuzk<void>(async () => await testWait(100));
	const tuzk2 = new Tuzk<void>(async () => await testWait(20));
	const tuzkRace = Tuzk.race([tuzk1, tuzk2]);

	performance.mark('start');
	await tuzkRace.run();
	performance.mark('end');
	assert(performance.measure('race', 'start', 'end').duration < 60);

	assert(!tuzk1.isFinished());
	assert(tuzk2.isFinished());

	assert(tuzkRace.stateIs('success'));

	clearTestTimeouts();
});

Deno.test('race should handle cancellation', async () => {
	const tuzk1 = new Tuzk<void>(async () => {
		await testWait(100);
	});
	const tuzk2 = new Tuzk<void>(async (tuzk) => {
		await testWait(50);
		tuzk2.cancel();
		await tuzk.checkpoint(0.8);
	});
	const tuzkRace = Tuzk.race([tuzk1, tuzk2]);
	await assertRejects(async () => await tuzkRace.run(), errors.CancelledError);
	clearTestTimeouts();

	assert(!tuzk1.stateIs('cancelled'));
	assert(tuzk2.stateIs('cancelled'));
	assert(tuzkRace.stateIs('cancelled'));
});

Deno.test('race should handle failure', async () => {
	const tuzk1 = new Tuzk<void>(async () => await testWait(100));

	const tuzk2 = new Tuzk<void>(async () => {
		await testWait(50);
		throw new Error('Task failed');
	});

	const tuzkRace = Tuzk.race([tuzk1, tuzk2]);
	await assertRejects(
		async () => await tuzkRace.run(),
		Error,
		'Task failed',
	);
	assert(!tuzk1.isFinished());
	assert(tuzk2.stateIs('failed'));
	assert(tuzkRace.stateIs('failed'));

	clearTestTimeouts();
});

Deno.test('return value', async () => {
	const tuzk = new Tuzk(async (tuzk) => {
		await tuzk.checkpoint(0.2);
		return 12138;
	});
	const result = await tuzk.run();
	assert(result === 12138);
	assert(tuzk.getResult() === 12138);
});

Deno.test('sum', async () => {
	const COUNT = 500000;
	const BATCH_SIZE = 1000;
	const CHECK_POINT_INTERVAL = 10;

	const tuzks: Tuzk<number>[] = [];

	for (let i = 0; i < COUNT; i += BATCH_SIZE) {
		const tuzk = new Tuzk<number>(async (tuzk) => {
			let sum = 0;
			const high = Math.min(i + BATCH_SIZE, COUNT);
			for (let j = i; j < high; j++) {
				sum += j;
				if (j % CHECK_POINT_INTERVAL === 0) {
					await tuzk.checkpoint((j - i) / BATCH_SIZE);
				}
			}
			return sum;
		});
		tuzks.push(tuzk);
	}

	const results = await Tuzk.all(tuzks).run();

	assert(results.length === tuzks.length);
	const sum = results.reduce((a, b) => a + b, 0);
	assert(sum === COUNT * (COUNT - 1) / 2);
});

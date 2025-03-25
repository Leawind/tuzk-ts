import { assert, assertRejects, assertStrictEquals, assertThrows } from '@std/assert';
import { Tuzk, TuzkState } from '@/index.ts';
import { TuzkCanceledError, TuzkDependencyFailedError, TuzkError } from '@/index.ts';

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
	const tuzk = new Tuzk(async (checkPoint) => {
		await checkPoint(0.5);
	});
	await tuzk.start();

	assertStrictEquals(tuzk.getProgress(), 1.0);

	assert(tuzk.isFinished());

	assert(!tuzk.isCanceled());
	assert(!tuzk.isPaused());
	assert(!tuzk.isMarkedAsCanceled());
	assert(!tuzk.isMarkedAsPaused());
	assert(!tuzk.isFailed());

	assert(tuzk.getState() === TuzkState.Success);
});

Deno.test('task should be paused and resumed', async () => {
	const tuzk = new Tuzk(async (checkPoint) => {
		await checkPoint(0.5);
		tuzk.pause();
		await checkPoint(0.8);
	});
	const runPromise = tuzk.start();

	// Wait for the task to pause
	await new Promise((resolve) => setTimeout(resolve, 100));

	assertStrictEquals(tuzk.isPaused(), true);
	tuzk.resume();
	await runPromise;
	assertStrictEquals(tuzk.getProgress(), 1.0);
	assert(tuzk.isFinished());
	assert(tuzk.isSuccess());
});

Deno.test('task resume when not paused', async () => {
	const tuzk = new Tuzk(async (checkPoint) => {
		await checkPoint(0.3);
		tuzk.resume();
		await checkPoint(0.6);
	});
	await tuzk.start();

	assert(tuzk.isSuccess());
});

Deno.test('task should be canceled', async () => {
	const tuzk = new Tuzk(async (checkPoint) => {
		await checkPoint(0.5);
		console.log('Hello');
		tuzk.cancel();
		console.log('World!');
		await checkPoint(0.8);

		console.log(`This should not be printed.`);
	});

	await assertRejects(async () => await tuzk.start(), TuzkCanceledError);

	assert(tuzk.isCanceled());
});

Deno.test('task should be canceled when paused', async () => {
	const tuzk = new Tuzk(async (checkPoint) => {
		await checkPoint(0.3);
		tuzk.pause();
		tuzk.cancel();
		await checkPoint(0.6);
		console.log(`This should not be printed.`);
	});

	await assertRejects(async () => await tuzk.start(), TuzkCanceledError);

	assert(tuzk.isCanceled());
});

Deno.test('task should throw error on invalid progress', () => {
	const tuzk = new Tuzk(async () => {});
	assertThrows(() => tuzk.setProgress(1.5), TuzkError);
});

Deno.test('all tasks should run successfully', async () => {
	const tuzk1 = new Tuzk(async (checkPoint) => {
		await testWait(10);
		await checkPoint(0.5);
		await testWait(10);
	});
	const tuzk2 = new Tuzk(async (checkPoint) => {
		await testWait(50);
		await checkPoint(0.5);
		await testWait(50);
	});
	const tuzkAll = Tuzk.all([tuzk1, tuzk2]);

	performance.mark('start');
	await tuzkAll.start();
	performance.mark('end');
	assert(performance.measure('', 'start', 'end').duration > 60);

	assertStrictEquals(tuzk1.getProgress(), 1.0);
	assertStrictEquals(tuzk2.getProgress(), 1.0);
	assertStrictEquals(tuzkAll.isFinished(), true);
	assertStrictEquals(tuzkAll.getState(), TuzkState.Success);
});

Deno.test('all tasks should handle cancellation', async () => {
	const tuzk1 = new Tuzk(async (checkPoint) => {
		await checkPoint(0.5);
	});
	const tuzk2 = new Tuzk(async (checkPoint) => {
		await checkPoint(0.5);
		tuzk2.cancel();
		await checkPoint(0.8);
	});
	const tuzkAll = Tuzk.all([tuzk1, tuzk2]);
	await assertRejects(async () => await tuzkAll.start(), TuzkCanceledError);
	assert(!tuzk1.isCanceled());
	assert(tuzk2.isCanceled());
	assert(tuzkAll.isCanceled());
});

Deno.test('all tasks should handle failure', async () => {
	const tuzk1 = new Tuzk<void>(async (checkPoint) => {
		await checkPoint(0.5);
	});
	const tuzk2 = new Tuzk<void>(async (checkPoint) => {
		await checkPoint(0.5);
		throw new Error('Task failed');
	});
	const tuzkAll = Tuzk.all([tuzk1, tuzk2]);
	await assertRejects(
		async () => await tuzkAll.start(),
		Error,
		'Task failed',
	);
	assert(tuzk1.isSuccess());
	assert(tuzk2.isFailed());
	assert(tuzkAll.isFailed());
});

// Race

Deno.test('race should run the first task that completes successfully', async () => {
	const tuzk1 = new Tuzk<void>(async () => await testWait(100));
	const tuzk2 = new Tuzk<void>(async () => await testWait(20));
	const tuzkRace = Tuzk.race([tuzk1, tuzk2]);

	performance.mark('start');
	await tuzkRace.start();
	performance.mark('end');
	assert(performance.measure('race', 'start', 'end').duration < 60);

	assert(!tuzk1.isFinished());
	assert(tuzk2.isFinished());

	assert(tuzkRace.isSuccess());

	clearTestTimeouts();
});

Deno.test('race should handle cancellation', async () => {
	const tuzk1 = new Tuzk(async () => {
		await testWait(100);
	});
	const tuzk2 = new Tuzk(async (checkPoint) => {
		await testWait(50);
		tuzk2.cancel();
		await checkPoint(0.8);
	});
	const tuzkRace = Tuzk.race([tuzk1, tuzk2]);
	await assertRejects(async () => await tuzkRace.start(), TuzkCanceledError);
	clearTestTimeouts();

	assert(!tuzk1.isCanceled());
	assert(tuzk2.isCanceled());
	assert(tuzkRace.isCanceled());
});

Deno.test('race should handle failure', async () => {
	const tuzk1 = new Tuzk<void>(async () => await testWait(100));

	const tuzk2 = new Tuzk<void>(async () => {
		await testWait(50);
		throw new Error('Task failed');
	});

	const tuzkRace = Tuzk.race([tuzk1, tuzk2]);
	await assertRejects(
		async () => await tuzkRace.start(),
		Error,
		'Task failed',
	);
	assert(!tuzk1.isFinished());
	assert(tuzk2.isFailed());
	assert(tuzkRace.isFailed());

	clearTestTimeouts();
});

Deno.test('Dependency success', async () => {
	const tuzk1 = new Tuzk(async (checkPoint) => await checkPoint(0.5));
	const tuzk2 = new Tuzk(async (checkPoint) => await checkPoint(0.5))
		.addDependency(tuzk1);
	const tuzk3 = new Tuzk(async (checkPoint) => await checkPoint(0.5))
		.addDependency(tuzk2);

	tuzk2.start();
	tuzk1.start();
	await tuzk3.start();

	assert(tuzk1.isSuccess());
	assert(tuzk2.isSuccess());
	assert(tuzk3.isSuccess());
});

Deno.test('Dependency failure', async () => {
	const tuzk1 = new Tuzk(async (checkPoint) => await checkPoint(0.5));

	const tuzk2 = new Tuzk(async (checkPoint) => {
		await checkPoint(0.5);
		throw new Error('Task2 failed');
	}).addDependency(tuzk1);

	const tuzk3 = new Tuzk(async (checkPoint) => await checkPoint(0.5))
		.addDependency(tuzk1)
		.addDependency(tuzk2);

	tuzk1.start();
	assertRejects(() => tuzk2.start(), Error);
	await assertRejects(async () => await tuzk3.start(), TuzkDependencyFailedError);

	assert(tuzk1.isSuccess());
	assert(tuzk2.isFailed());
	assert(tuzk3.isFailed());
});

Deno.test('Dependency cancel', async () => {
	const tuzk1 = new Tuzk<void>(async (checkPoint) => await checkPoint(0.5));

	const tuzk2 = new Tuzk<void>(async (checkPoint) => {
		await checkPoint(0.5);
		tuzk2.cancel();
		await checkPoint(0.8);
	}).addDependency(tuzk1);

	const tuzk3 = new Tuzk(async (checkPoint) => await checkPoint(0.5))
		.addDependency(tuzk1)
		.addDependency(tuzk2);

	tuzk1.start();
	assertRejects(() => tuzk2.start(), TuzkCanceledError);
	await assertRejects(async () => await tuzk3.start(), TuzkCanceledError);

	assert(tuzk1.isSuccess());
	assert(tuzk2.isCanceled());
	assert(tuzk3.isCanceled());
});

Deno.test('return value', async () => {
	const tuzk = new Tuzk(async (checkPoint) => {
		await checkPoint(0.2);
		return 12138;
	});
	const result = await tuzk.start();
	assert(result === 12138);
	assert(tuzk.getResult() === 12138);
});

Deno.test('sum', async () => {
	const COUNT = 500000;
	const BATCH_SIZE = 1000;
	const CHECK_POINT_INTERVAL = 10;

	const tuzks: Tuzk<number>[] = [];
	const encoder = new TextEncoder();

	for (let i = 0; i < COUNT; i += BATCH_SIZE) {
		const tuzk = new Tuzk(async (checkPoint) => {
			let sum = 0;
			const high = Math.min(i + BATCH_SIZE, COUNT);
			for (let j = i; j < high; j++) {
				sum += j;
				if (j % CHECK_POINT_INTERVAL === 0) {
					await checkPoint((j - i) / BATCH_SIZE);
				}
			}
			return sum;
		});
		tuzk.onProgressUpdated.addListener(() => {
			Deno.stdout.writeSync(encoder.encode(`\r${tuzk.getProgress()}    `));
		});
		tuzks.push(tuzk);
	}

	const results = await Tuzk.all(tuzks).start();
	console.log();

	assert(results.length === tuzks.length);
	const sum = results.reduce((a, b) => a + b, 0);
	assert(sum === COUNT * (COUNT - 1) / 2);
});

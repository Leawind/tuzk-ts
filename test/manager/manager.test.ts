import { wait } from '@leawind/inventory/test_utils';
import { TuzkManager } from '@/manager.ts';
import { assertGreater, assertThrows } from '@std/assert';

Deno.test('continue test', async () => {
	const mgr = new TuzkManager();
	mgr.concurrency = 8;

	for (let i = 0; i < 14; i++) {
		mgr.submit(async () => await wait(50));
	}

	performance.mark('first start');
	await mgr.waitForAll();
	performance.mark('first end');
	const firstDuration = performance.measure('first', 'first start', 'first end').duration;
	assertGreater(firstDuration, 100);

	for (let i = 0; i < 9; i++) {
		mgr.submit(async () => await wait(50));
	}

	performance.mark('second start');
	await mgr.waitForAll();
	performance.mark('second end');
	const secondDuration = performance.measure('second', 'second start', 'second end').duration;
	assertGreater(secondDuration, 100);
});

Deno.test('Detect dependency cycle', async () => {
	const mgr = new TuzkManager();
	const tuzkA = mgr.submit(async () => await wait(30));
	assertThrows(() => mgr.addDependency(tuzkA, tuzkA), Error);
	await mgr.waitForAll();
});

Deno.test('Detect dependency cycle 2', async () => {
	const mgr = new TuzkManager();
	const tuzkA = mgr.submit(async () => await wait(30));
	const tuzkB = mgr.submit(async () => await wait(30));

	mgr.addDependency(tuzkA, tuzkB);
	assertThrows(() => mgr.addDependency(tuzkB, tuzkA), Error);

	await mgr.waitForAll();
});

Deno.test('Detect dependency cycle 3', async () => {
	const mgr = new TuzkManager();
	const tuzkA = mgr.submit(async () => await wait(30));
	const tuzkB = mgr.submit(async () => await wait(30), [tuzkA]);
	const tuzkC = mgr.submit(async () => await wait(30), [tuzkB]);

	assertThrows(() => mgr.addDependency(tuzkA, tuzkC), Error);

	await mgr.waitForAll();
});

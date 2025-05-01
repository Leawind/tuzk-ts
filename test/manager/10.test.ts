import { TimeRuler, wait } from '@leawind/inventory/test_utils';
import { TuzkManager } from '@/manager.ts';
import { assertGreater } from '@std/assert';

Deno.test('parallel test', async () => {
	const DELAY = 100;
	const PARALLEL = 4;

	const promises: Promise<void>[] = [];
	for (let count = 0; count < 10; count++) {
		promises.push((async () => {
			const tr = new TimeRuler(0);

			const mgr = new TuzkManager();
			mgr.concurrency = PARALLEL;

			for (let i = 0; i < count; i++) {
				mgr.submit(async () => await wait(DELAY));
			}

			await mgr.waitForAll();

			const elapsed = tr.now();
			const predict = Math.ceil(count / PARALLEL) * DELAY;
			assertGreater(elapsed, predict, `Count: ${count}`);
		})());
	}

	await Promise.all(promises);
});

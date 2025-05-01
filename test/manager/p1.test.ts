import { TimeRuler, wait } from '@leawind/inventory/test_utils';
import { TuzkManager } from '@/manager.ts';
import { assertGreater } from '@std/assert/greater';

Deno.test(`parallel = 1`, async () => {
	const tr = new TimeRuler(0);
	const mgr = new TuzkManager();

	mgr.concurrency = 1;

	for (let i = 0; i < 3; i++) {
		mgr.submit(async () => {
			await wait(100);
			return i;
		});
	}
	await mgr.waitForAll();

	assertGreater(tr.now(), 300);
});

import { wait } from '@leawind/inventory/test_utils';
import { TuzkManager } from '@/manager.ts';

Deno.test('parallel = 16', async () => {
	const mgr = new TuzkManager();

	mgr.concurrency = 16;

	for (let i = 0; i < 64; i++) {
		mgr.submit(async () => {
			await wait(100);
			return i;
		});
	}

	await mgr.waitForAll();
});

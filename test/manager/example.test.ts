import { wait } from '@leawind/inventory/test_utils';
import { TuzkManager } from '@/manager.ts';

Deno.test('Manager example', async () => {
	const mgr = new TuzkManager();

	for (let i = 0; i < 50; i++) {
		mgr.submit(async () => {
			await wait(50);
			return i;
		});
	}

	await mgr.waitForAll();
});

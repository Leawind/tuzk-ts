import { TimeRuler, wait } from '@leawind/inventory/test_utils';
import { TuzkManager } from '@/manager.ts';

Deno.test('Random test', async () => {
	const tr = new TimeRuler(0);
	const mgr = new TuzkManager(32);

	const starts: number[] = [];
	for (let i = 0; i < 100; i++) {
		starts.push(Math.random() * 100);
	}
	starts.sort();

	for (const start of starts) {
		await tr.til(start);
		mgr.submit(async () => await wait(Math.random() * 100));
	}

	await mgr.waitForAll();
});

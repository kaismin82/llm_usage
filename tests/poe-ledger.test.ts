import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IdbPoeLedger, MemoryPoeLedger, type PoeLedger } from '../src/core/poe-ledger';

const entries = [
  { queryId: 'old', time: 100, points: 1, usageType: 'Chat', bot: 'a' },
  { queryId: 'inside', time: 200, points: 2, usageType: 'API', bot: 'b' },
  { queryId: 'late', time: 300, points: 3, usageType: 'Canvas App', bot: 'c' },
];

async function exerciseLedger(ledger: PoeLedger): Promise<void> {
  await ledger.putMany(entries);
  await ledger.putMany([{ ...entries[1], points: 5 }]);

  expect(await ledger.has('inside')).toBe(true);
  expect(await ledger.has('missing')).toBe(false);
  expect(await ledger.range(200, 300)).toEqual([{ ...entries[1], points: 5 }]);

  await ledger.setMeta({ coverageStart: 150 });
  expect(await ledger.getMeta()).toEqual({ coverageStart: 150 });

  await ledger.prune(200);
  expect(await ledger.has('old')).toBe(false);
  expect(await ledger.range(0, 1000)).toHaveLength(2);
}


describe('Poe ledgers', () => {
  it('stores and filters entries in memory', async () => {
    await exerciseLedger(new MemoryPoeLedger());
  });

  it('stores and filters entries in IndexedDB', async () => {
    await exerciseLedger(new IdbPoeLedger());
  });
});

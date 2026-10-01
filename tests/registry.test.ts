import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../src/core/registry';
import { PROVIDER_IDS } from '../src/providers/types';

describe('ADAPTERS', () => {
  it('registers exactly the six provider adapters', () => {
    expect(Object.keys(ADAPTERS).sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it.each(PROVIDER_IDS)('maps %s to an adapter whose id matches its key', (id) => {
    expect(ADAPTERS[id].id).toBe(id);
    expect(typeof ADAPTERS[id].fetchSnapshot).toBe('function');
  });
});

import { useEffect, useState } from 'preact/hooks';
import { onStoreChange } from '../core/store';
import { createCustomStore } from './store';
import { CustomConfigError } from './types';
import type { CustomProviderConfig, CustomSnapshot } from './types';

export function useCustomData() {
  const [providers, setProviders] = useState<CustomProviderConfig[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, CustomSnapshot>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    let version = 0;
    const store = createCustomStore();
    const load = async () => {
      const current = ++version;
      try {
        const configs = await store.getProviders();
        const results = await store.getSnapshots(configs);
        if (!mounted || current !== version) return;
        setProviders(configs);
        setSnapshots(results);
        setError('');
        setLoaded(true);
      } catch (cause) {
        if (!mounted || current !== version) return;
        setError(cause instanceof CustomConfigError ? cause.message : 'Custom provider 데이터를 읽지 못했습니다');
        setLoaded(true);
      }
    };
    const unsubscribe = onStoreChange(() => { void load(); });
    void load();
    return () => { mounted = false; unsubscribe(); };
  }, []);
  return { providers, snapshots, loaded, error };
}

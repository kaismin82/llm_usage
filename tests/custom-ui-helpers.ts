import { vi } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { isCustomMessage } from '../src/custom/config';
import { fetchCustomSnapshot } from '../src/custom/fetch';
import { createCustomRunner } from '../src/custom/runner';
import { createCustomStore, CUSTOM_PROVIDERS_KEY } from '../src/custom/store';
import type { CustomProviderConfig } from '../src/custom/types';

export const customConfig: CustomProviderConfig = {
  id: 'test-custom', name: 'Test Custom', enabled: true, intervalMin: 10,
  endpoint: 'https://usage.example.com/quota', authMode: 'none',
  apiKey: '', headerName: 'X-API-Key', headers: {}, balancePath: 'credits', balanceUnit: 'usd',
  windows: [{
    label: 'Quota', unit: 'tokens', usedPath: 'usage.used', limitPath: 'usage.limit',
    percentPath: '', resetPath: '', resetFormat: 'iso',
  }],
};

export function installCustomChrome(providers: CustomProviderConfig[] = [], granted = true) {
  const data: Record<string, unknown> = {
    settings: defaultSettings(), snapshots: { claude: { marker: 'keep-built-in' } },
    [CUSTOM_PROVIDERS_KEY]: structuredClone(providers),
  };
  const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
  const notify = () => listeners.forEach((listener) => listener({}, 'local'));
  const storage = {
    get: async (keys: string | string[]) => Object.fromEntries((typeof keys === 'string' ? [keys] : keys)
      .map((key) => [key, structuredClone(data[key])])),
    set: async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); notify(); },
    remove: async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key];
      notify();
    },
  };
  const request = vi.fn(async () => granted);
  const wire = vi.fn(async () => new Response(JSON.stringify({ usage: { used: 12, limit: 100 }, credits: 4 })));
  const runner = createCustomRunner({
    store: createCustomStore(storage), now: () => new Date('2026-10-01T12:00:00Z'),
    hasOrigin: async () => granted,
    fetchSnapshot: (config, options) => fetchCustomSnapshot(config, { ...options, fetchImpl: wire }),
  });
  const sendMessage = vi.fn(async (message: unknown) => {
    if (isCustomMessage(message)) await runner.run(message.id, true);
    return { ok: true };
  });
  vi.stubGlobal('chrome', {
    storage: { local: storage, onChanged: {
      addListener: (listener: (changes: Record<string, unknown>, area: string) => void) => listeners.add(listener),
      removeListener: (listener: (changes: Record<string, unknown>, area: string) => void) => listeners.delete(listener),
    } },
    runtime: { sendMessage, openOptionsPage: vi.fn() },
    permissions: { request, contains: async () => granted },
  });
  return { data, notify, request, wire, sendMessage, store: createCustomStore(storage) };
}

export function onDom(root: HTMLElement, predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (predicate()) finish();
    });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('DOM event timed out')); }, 3000);
    const finish = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
    observer.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
    if (predicate()) finish();
  });
}

export function input(root: HTMLElement, name: string, value: string): void {
  const field = root.querySelector(`[name="${name}"]`);
  if (!(field instanceof HTMLInputElement)) throw new Error(`Missing input ${name}`);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export function click(root: HTMLElement, action: string): void {
  const button = root.querySelector(`[data-action="${action}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing action ${action}`);
  button.click();
}

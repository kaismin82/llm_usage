// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomProviders } from '../src/options/CustomProviders';
import { App as Popup } from '../src/popup/App';
import { CUSTOM_PROVIDERS_KEY, customSnapshotKey } from '../src/custom/store';
import { click, customConfig, input, installCustomChrome, onDom } from './custom-ui-helpers';

describe('custom provider UI integration', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it('adds, saves and fetches a custom provider without changing built-in data', async () => {
    // Given
    const env = installCustomChrome();
    const original = structuredClone({ settings: env.data.settings, snapshots: env.data.snapshots });
    const loaded = onDom(root, () => root.querySelector('[data-action="add-custom"]:not(:disabled)') !== null);
    render(<CustomProviders />, root);
    await loaded;
    const editing = onDom(root, () => root.querySelector('[name="custom-name"]') !== null);
    click(root, 'add-custom');
    await editing;
    await act(() => {
      input(root, 'custom-name', 'New Provider');
      input(root, 'custom-endpoint', customConfig.endpoint);
      input(root, 'usedPath', 'usage.used');
      input(root, 'limitPath', 'usage.limit');
    });
    const ready = onDom(root, () => root.querySelector('[data-custom-status="ok"]') !== null);
    // When
    click(root, 'save-custom');
    await ready;
    // Then
    const providers = await env.store.getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe('New Provider');
    expect(env.request).toHaveBeenCalledWith({ origins: ['https://usage.example.com/*'] });
    expect(env.wire).toHaveBeenCalledTimes(1);
    expect(env.data.settings).toEqual(original.settings);
    expect(env.data.snapshots).toEqual(original.snapshots);
  });

  it('does not save or fetch when host permission is denied', async () => {
    // Given
    const env = installCustomChrome([], false);
    const loaded = onDom(root, () => root.querySelector('[data-action="add-custom"]:not(:disabled)') !== null);
    render(<CustomProviders />, root);
    await loaded;
    const editing = onDom(root, () => root.querySelector('[name="custom-name"]') !== null);
    click(root, 'add-custom');
    await editing;
    await act(() => {
      input(root, 'custom-name', 'Denied');
      input(root, 'custom-endpoint', customConfig.endpoint);
      input(root, 'usedPath', 'usage.used');
    });
    const failed = onDom(root, () => root.querySelector('[data-custom-error]') !== null);
    // When
    click(root, 'save-custom');
    await failed;
    // Then
    expect(await env.store.getProviders()).toEqual([]);
    expect(env.wire).not.toHaveBeenCalled();
  });

  it('keeps unsaved custom edits when unrelated storage changes', async () => {
    // Given
    const env = installCustomChrome([customConfig]);
    const loaded = onDom(root, () => root.querySelector('[data-action="edit-custom"]') !== null);
    render(<CustomProviders />, root);
    await loaded;
    const editing = onDom(root, () => root.querySelector('[name="custom-name"]') !== null);
    click(root, 'edit-custom');
    await editing;
    await act(() => { input(root, 'custom-name', 'Unsaved name'); });
    env.data[CUSTOM_PROVIDERS_KEY] = [{ ...customConfig, name: 'External name' }];
    const changed = onDom(root, () => root.querySelector('.custom-provider-name')?.textContent === 'External name');
    // When
    env.notify();
    await changed;
    // Then
    const field = root.querySelector('[name="custom-name"]');
    expect(field instanceof HTMLInputElement && field.value).toBe('Unsaved name');
    expect((await env.store.getProviders())[0].name).toBe('External name');
  });

  it('shows a custom-only popup with real mapped values instead of the empty state', async () => {
    // Given
    const env = installCustomChrome([customConfig]);
    env.data.snapshots = {};
    env.data[customSnapshotKey(customConfig.id)] = {
      provider: customConfig.id, status: 'ok',
      windows: [{ kind: 'budget', label: 'Quota', unit: 'tokens', usedAmount: 12, limitAmount: 100, usedPercent: 12 }],
      balance: { amount: 4, unit: 'usd' },
      fetchedAt: new Date().toISOString(), attemptedAt: new Date().toISOString(),
    };
    const displayed = onDom(root, () => root.querySelector('[data-custom-provider-id] [role="progressbar"]') !== null);
    // When
    render(<Popup />, root);
    await displayed;
    // Then
    expect(root.querySelector('[data-custom-provider-id] [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('12');
    expect(root.querySelector('[data-custom-provider-id]')?.textContent).toContain('12 / 100');
    expect(root.querySelector('.empty')).toBeNull();
    expect(env.data[CUSTOM_PROVIDERS_KEY]).toEqual([customConfig]);
  });
});

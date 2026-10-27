// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/options/App';
import { RELAY_CONFIG_KEY } from '../src/phone-relay/store';
import { click, input, installCustomChrome, onDom } from './custom-ui-helpers';

describe('separate phone relay options', () => {
  let root: HTMLElement;
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  it('keeps built-in drafts and saved settings intact while saving and manually sending relay configuration', async () => {
    const env = installCustomChrome();
    const original = structuredClone(env.data.settings);
    root = document.createElement('div');
    document.body.appendChild(root);
    const ready = onDom(root, () => root.querySelector<HTMLInputElement>('[name="phoneRelayWriteToken"]')?.disabled === false);
    render(<App />, root);
    await ready;
    const mainSave = () => [...root.querySelectorAll('button')].find((button) => button.textContent?.trim() === '저장')!;
    const timezone = root.querySelector<HTMLInputElement>('input[list="tz-list"]')!;
    const dirty = onDom(root, () => !mainSave().disabled);
    timezone.value = 'UTC';
    timezone.dispatchEvent(new Event('input', { bubbles: true }));
    await dirty;
    const token = root.querySelector<HTMLInputElement>('[name="phoneRelayWriteToken"]')!;
    expect(token.type).toBe('password');
    const canSave = onDom(root, () => root.querySelector<HTMLButtonElement>('[data-action="relay-save"]')?.disabled === false);
    input(root, 'phoneRelayWriteToken', 'relay-only-token');
    root.querySelector<HTMLInputElement>('[name="phoneRelayEnabled"]')!.click();
    await canSave;
    const saved = onDom(root, () => root.querySelector<HTMLButtonElement>('[data-action="relay-send"]')?.disabled === false);
    click(root, 'relay-save');
    await saved;
    expect(env.data[RELAY_CONFIG_KEY]).toEqual({ enabled: true, writeToken: 'relay-only-token' });
    expect(env.data.settings).toEqual(original);
    expect(timezone.value).toBe('UTC');
    expect(mainSave().disabled).toBe(false);
    expect(env.request).toHaveBeenCalledWith({ origins: ['http://127.0.0.1/*'] });
    expect(env.sendMessage).not.toHaveBeenCalled();

    const finished = onDom(root, () => env.sendMessage.mock.calls.length === 1
      && root.querySelector<HTMLButtonElement>('[data-action="relay-send"]')?.disabled === false);
    click(root, 'relay-send');
    await finished;
    expect(env.sendMessage).toHaveBeenCalledWith({ type: 'phone-relay-send' });
    expect(env.data.settings).toEqual(original);
  });

  it('does not enable or save the relay when local permission is denied', async () => {
    const env = installCustomChrome([], false);
    root = document.createElement('div');
    document.body.appendChild(root);
    const ready = onDom(root, () => root.querySelector<HTMLInputElement>('[name="phoneRelayWriteToken"]')?.disabled === false);
    render(<App />, root);
    await ready;
    const canSave = onDom(root, () => root.querySelector<HTMLButtonElement>('[data-action="relay-save"]')?.disabled === false);
    input(root, 'phoneRelayWriteToken', 'relay-only-token');
    root.querySelector<HTMLInputElement>('[name="phoneRelayEnabled"]')!.click();
    await canSave;
    const denied = onDom(root, () => root.querySelector<HTMLButtonElement>('[data-action="relay-save"]')?.disabled === false
      && env.request.mock.calls.length === 1);
    click(root, 'relay-save');
    await denied;
    expect(env.data[RELAY_CONFIG_KEY]).toBeUndefined();
    expect(env.sendMessage).not.toHaveBeenCalled();
  });
});

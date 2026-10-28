// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudePlatformDiagnostics } from '../src/options/ClaudePlatformDiagnostics';
import type { ProviderContext } from '../src/providers/types';
import { click, onDom } from './custom-ui-helpers';

const KEY = 'sk-ant-admin01-FAKE';
const item = (amount: string, extra: Record<string, unknown> = {}) => ({ amount, currency: 'USD', ...extra });
const ok = (json: unknown) => ({ status: 200, headers: {}, text: '', json, challenge: false });

function pagedGet(): ProviderContext['get'] {
  return vi.fn(async (url: string) => url.includes('page=pg2')
    ? ok({ data: [{ starting_at: '2026-10-03T00:00:00Z', ending_at: '2026-10-04T00:00:00Z', results: [item('235', { cost_type: 'web_search', workspace_id: 'wrkspc_a' })] }], has_more: false, next_page: null })
    : ok({ data: [{ starting_at: '2026-10-01T00:00:00Z', ending_at: '2026-10-02T00:00:00Z', results: [item('1000', { cost_type: 'tokens', model: 'claude-opus-5-5', workspace_id: 'wrkspc_a' })] }], has_more: true, next_page: 'pg2' })) as unknown as ProviderContext['get'];
}

describe('Claude Platform diagnostics panel', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  const run = async () => {
    const done = onDom(root, () => root.querySelector('[data-testid="diag-report"]') !== null || root.querySelector('.warning') !== null);
    click(root, 'claude-platform-diagnose');
    await done;
  };

  it('shows totals, match status, daily rows, groups and the comparison guide on one panel without the key', async () => {
    render(<ClaudePlatformDiagnostics apiKey={KEY} displayedUsd={12.35} get={pagedGet()} ensurePermission={async () => true} now={() => new Date('2026-10-15T08:00:00Z')} />, root);
    await run();

    expect(root.querySelector('[data-testid="diag-total"]')?.textContent).toBe('$12.35');
    expect(root.querySelector('[data-testid="diag-match"]')?.textContent).toBe('일치');
    const text = root.textContent ?? '';
    expect(text).toContain('2026-10-01');
    expect(text).toContain('2026-10-03');
    expect(text).toContain('비용 종류별');
    expect(text).toContain('web_search');
    expect(text).toContain('claude-opus-5-5');
    expect(text).toContain('has_more 아니오');
    expect(text).toContain('Priority Tier');
    expect(text).not.toContain(KEY);
  });

  it('flags a difference from the currently displayed value', async () => {
    render(<ClaudePlatformDiagnostics apiKey={KEY} displayedUsd={5} get={pagedGet()} ensurePermission={async () => true} now={() => new Date('2026-10-15T08:00:00Z')} />, root);
    await run();
    expect(root.querySelector('[data-testid="diag-match"]')?.textContent).toBe('다름 (차이 $7.35)');
  });

  it('does nothing without a key or without host permission', async () => {
    const get = pagedGet();
    render(<ClaudePlatformDiagnostics apiKey="  " get={get} ensurePermission={async () => true} />, root);
    await run();
    expect(root.textContent).toContain('먼저 Admin API 키를 입력하세요');
    expect(get).not.toHaveBeenCalled();

    render(<ClaudePlatformDiagnostics apiKey={KEY} get={get} ensurePermission={async () => false} />, root);
    await run();
    expect(root.textContent).toContain('접근 권한');
    expect(get).not.toHaveBeenCalled();
  });
});

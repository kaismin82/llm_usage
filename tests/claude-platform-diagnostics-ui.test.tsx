// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudePlatformDiagnostics } from '../src/options/ClaudePlatformDiagnostics';
import type { ProviderContext } from '../src/providers/types';
import { click, onDom } from './custom-ui-helpers';
import { DIAGNOSTICS_RUN_HASH, DIAGNOSTICS_SCROLL_HASH } from '../src/options/ClaudePlatformDiagnostics';

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

  it('shows the key facts, bucket count, page info and the today summary', async () => {
    render(<ClaudePlatformDiagnostics apiKey={KEY} displayedUsd={12.35} get={pagedGet()} ensurePermission={async () => true} now={() => new Date('2026-10-03T08:00:00Z')} />, root);
    await run();
    const text = (id: string) => root.querySelector('[data-testid="' + id + '"]')?.textContent;
    expect(text('diag-queried')).toBe('2026-10-03T08:00:00.000Z');
    expect(text('diag-last-ending')).toBe('2026-10-04T00:00:00Z');
    expect(text('diag-latest-day')).toBe('$2.35');
    expect(text('diag-bucket-count')).toBe('2개 (비용 있는 날 2개)');
    expect(text('diag-today')).toContain('2026-10-03');
    expect(text('diag-today')).toContain('$2.35 포함');
    expect(text('diag-page-info')).toContain('[1, 1]');
    expect(text('diag-page-info')).toContain('has_more');
  });

  it('runs once on load when autoRun is set and permission and key already exist, without a click or prompt', async () => {
    const get = pagedGet();
    const ensure = vi.fn(async () => true);
    const done = onDom(root, () => root.querySelector('[data-testid="diag-report"]') !== null);
    render(<ClaudePlatformDiagnostics apiKey={KEY} autoRun get={get} hasPermission={async () => true} ensurePermission={ensure} now={() => new Date('2026-10-15T08:00:00Z')} />, root);
    await done;
    expect(root.querySelector('[data-testid="diag-total"]')?.textContent).toBe('$12.35');
    expect(ensure).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalled();
    expect(root.textContent).not.toContain(KEY);
  });

  it('does not auto-run without the hash flag', async () => {
    const get = pagedGet();
    render(<ClaudePlatformDiagnostics apiKey={KEY} get={get} hasPermission={async () => true} ensurePermission={async () => true} />, root);
    await Promise.resolve();
    await Promise.resolve();
    expect(get).not.toHaveBeenCalled();
    expect(root.querySelector('[data-testid="diag-report"]')).toBeNull();
  });

  it('auto-run without a stored permission or key only says so and never requests or fetches', async () => {
    const get = pagedGet();
    const ensure = vi.fn(async () => true);
    const noPermission = onDom(root, () => root.querySelector('.warning') !== null);
    render(<ClaudePlatformDiagnostics apiKey={KEY} autoRun get={get} hasPermission={async () => false} ensurePermission={ensure} />, root);
    await noPermission;
    expect(root.textContent).toContain('권한/키가 없어 자동 실행하지 않음');
    render(null, root);

    const noKey = onDom(root, () => root.querySelector('.warning') !== null);
    render(<ClaudePlatformDiagnostics apiKey="" autoRun get={get} hasPermission={async () => true} ensurePermission={ensure} />, root);
    await noKey;
    expect(root.textContent).toContain('권한/키가 없어 자동 실행하지 않음');
    expect(get).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('keeps the plain diagnostics hash scroll-only and distinct from the run hash', () => {
    expect(DIAGNOSTICS_RUN_HASH).not.toBe(DIAGNOSTICS_SCROLL_HASH);
    expect(DIAGNOSTICS_RUN_HASH.startsWith(DIAGNOSTICS_SCROLL_HASH)).toBe(true);
  });

  it('adds the usage-report comparison, ending_at probes and a labelled estimate to the panel', async () => {
    const usageRow = { model: 'claude-sonnet-5-5', service_tier: 'standard', speed: 'standard', inference_geo: 'global', uncached_input_tokens: 1000000, cache_read_input_tokens: 0, output_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 0 } };
    const get = vi.fn(async (url: string) => url.includes('usage_report')
      ? ok({ data: url.includes('bucket_width=1h') ? [{ starting_at: '2026-10-15T01:00:00Z', ending_at: '2026-10-15T02:00:00Z', results: [usageRow] }] : [], has_more: false, next_page: null })
      : ok({ data: [{ starting_at: '2026-10-01T00:00:00Z', ending_at: '2026-10-02T00:00:00Z', results: [item('1000')] }], has_more: false, next_page: null })) as unknown as ProviderContext['get'];
    render(<ClaudePlatformDiagnostics apiKey={KEY} displayedUsd={10} get={get} ensurePermission={async () => true} now={() => new Date('2026-10-15T08:00:00Z')} />, root);
    const done = onDom(root, () => root.querySelector('[data-testid="diag-estimate"]') !== null);
    click(root, 'claude-platform-diagnose');
    await done;
    const text = (id: string) => root.querySelector('[data-testid="' + id + '"]')?.textContent ?? '';
    expect(text('diag-usage-verdict')).toContain('오늘 토큰 1,000,000개 있음 / 비용 버킷 없음');
    expect(text('diag-probes')).toContain('내일 00:00Z');
    expect(text('diag-usage-today')).toContain('claude-sonnet-5-5');
    expect(text('diag-estimate')).toContain('추정');
    expect(text('diag-estimate')).toContain('$2.00');
    expect(text('diag-estimate')).toContain('× $2/MTok');
    expect(root.textContent).not.toContain(KEY);
  });
});

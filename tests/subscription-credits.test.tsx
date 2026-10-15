// @vitest-environment jsdom
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SubscriptionCard } from '../src/popup/components/SubscriptionCard';
import { defaultSettings } from '../src/core/settings';
import { baseSnapshot, errorSnapshot } from '../src/providers/util';
import { claudeAdapter } from '../src/providers/claude';
import { chatgptAdapter } from '../src/providers/chatgpt';
import type { ProviderSnapshot } from '../src/providers/types';
import { makeCtx } from './helpers';

const NOW = new Date('2026-10-15T12:00:00Z');

describe('subscription extra credits', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(() => {
    render(null, root);
    root.remove();
  });

  function mount(snapshot: ProviderSnapshot) {
    render(<SubscriptionCard snapshot={snapshot} providerId={snapshot.provider} settings={defaultSettings()} now={NOW} />, root);
  }

  it('renders Claude monthly dollars and spending cap from the adapter response', async () => {
    // Given
    const snapshot = await claudeAdapter.fetchSnapshot(makeCtx({
      provider: 'claude', now: NOW,
      providerSettings: { orgId: '00000000-0000-0000-0000-000000000001' },
      routes: [{ match: '/usage', reply: { json: {
        five_hour: { utilization: 10, resets_at: null },
        extra_usage: { is_enabled: true, used_credits: 2294, monthly_limit: 11500, decimal_places: 2, currency: 'USD' },
      } } }],
    }));

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-used')?.textContent).toBe('$22.94');
    expect(root.querySelector('.extra-limit')?.textContent).toBe('$115.00');
    expect(root.querySelector('.extra-balance')).toBeNull();
  });

  it('renders ChatGPT reported monthly credits and current available credits independently', async () => {
    // Given
    const snapshot = await chatgptAdapter.fetchSnapshot(makeCtx({
      provider: 'chatgpt', now: NOW,
      routes: [
        { match: '/api/auth/session', reply: { json: { accessToken: 'test-session' } } },
        { match: '/usage/credit-usage-events', reply: { json: { data: [{ date: '2026-10-15', product_surface: 'cli', credit_amount: 240.5 }] } } },
        { match: /\/wham\/usage$/, reply: { json: { rate_limit: {}, credits: { has_credits: true, unlimited: false, balance: '1759.5' } } } },
      ],
    }));

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-used')?.textContent).toBe('240.5 cr');
    expect(root.querySelector('.extra-balance')?.textContent).toBe('1,759.5 cr');
    expect(root.querySelector('.extra-limit')).toBeNull();
    expect(root.querySelector('.extra-credit-row [role="progressbar"]')).toBeNull();
  });

  it('renders real zero amounts instead of hiding them', () => {
    // Given
    const snapshot = baseSnapshot('chatgpt', NOW);
    snapshot.extraCredits = { unit: 'credits', balanceAmount: 0 };
    snapshot.windows = [{ kind: 'month', label: 'Extra credits', unit: 'credits', usedAmount: 0, periodTz: 'UTC' }];

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-used')?.textContent).toBe('0 cr');
    expect(root.querySelector('.extra-balance')?.textContent).toBe('0 cr');
  });

  it('does not render fabricated numbers when extra usage is disabled', () => {
    // Given
    const snapshot = baseSnapshot('claude', NOW);
    snapshot.extraCredits = { unit: 'usd', isEnabled: false };

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-credit-row')).not.toBeNull();
    expect(root.querySelector('.extra-used, .extra-limit, .extra-balance')).toBeNull();
  });

  it('keeps an available balance visible when monthly history is missing', () => {
    // Given
    const snapshot = baseSnapshot('chatgpt', NOW);
    snapshot.extraCredits = { unit: 'credits', balanceAmount: -2.5 };

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-used')).toBeNull();
    expect(root.querySelector('.extra-balance')?.textContent).toBe('-2.5 cr');
  });

  it('does not fabricate a balance or a cap for unlimited credits', () => {
    // Given
    const snapshot = baseSnapshot('chatgpt', NOW);
    snapshot.extraCredits = { unit: 'credits', unlimited: true };

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-balance')).not.toBeNull();
    expect(root.querySelector('.extra-balance[title]')).toBeNull();
    expect(root.querySelector('.extra-limit')).toBeNull();
  });

  it('retains the observed month and amounts after a failed refresh across a month boundary', () => {
    // Given
    const previous = baseSnapshot('chatgpt', new Date('2026-09-30T23:30:00Z'));
    previous.extraCredits = { unit: 'credits', balanceAmount: 7 };
    previous.windows = [{ kind: 'month', label: 'Extra credits', unit: 'credits', usedAmount: 12, periodTz: 'UTC' }];
    const failed = errorSnapshot('chatgpt', NOW, 'auth_required', 'not signed in', previous);

    // When
    mount(failed);

    // Then
    expect(root.querySelector('.extra-credit-label')?.textContent).toBe(
      `${new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date('2026-09-30T23:30:00Z'))} Extra`,
    );
    expect(root.querySelector('.extra-used')?.textContent).toBe('12 cr');
    expect(root.querySelector('.extra-balance')?.textContent).toBe('7 cr');
    expect(root.querySelector('.card')?.classList.contains('is-dim')).toBe(true);
  });

  it('does not add an extra-credit section to other subscription providers', () => {
    // Given
    const snapshot = baseSnapshot('zai', NOW);

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-credit-row')).toBeNull();
  });

  it('keeps the UTC observation month when credit history is unavailable near a month boundary', () => {
    // Given
    const snapshot = baseSnapshot('chatgpt', new Date('2026-09-30T23:30:00Z'));
    snapshot.extraCredits = { unit: 'credits', balanceAmount: 7 };

    // When
    mount(snapshot);

    // Then
    expect(root.querySelector('.extra-credit-label')?.textContent).toBe(
      `${new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date('2026-09-30T23:30:00Z'))} Extra`,
    );
    expect(root.querySelector('.extra-used')).toBeNull();
  });
});

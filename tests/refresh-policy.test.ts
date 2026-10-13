import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUserIdle } from '../src/core/idle';
import { mergeSettings } from '../src/core/settings';
import { needsRefreshOnOpen, withinCooldown } from '../src/core/refresh-policy';
import { clampInterval } from '../src/options/logic';
import type { AppSettings } from '../src/providers/types';
import { baseSnapshot } from '../src/providers/util';

const NOW = new Date('2026-10-01T12:00:00Z');
const minutesAgo = (m: number) => baseSnapshot('litellm', new Date(NOW.getTime() - m * 60_000));

describe('needsRefreshOnOpen', () => {
  it('refreshes only when the last attempt is older than the interval', () => {
    expect(needsRefreshOnOpen(undefined, 10, NOW.getTime())).toBe(true);
    expect(needsRefreshOnOpen(minutesAgo(5), 10, NOW.getTime())).toBe(false);
    expect(needsRefreshOnOpen(minutesAgo(11), 10, NOW.getTime())).toBe(true);
  });
});

describe('withinCooldown', () => {
  it('blocks refreshes within 60 seconds of the last attempt', () => {
    expect(withinCooldown(undefined, NOW.getTime())).toBe(false);
    expect(withinCooldown(baseSnapshot('litellm', new Date(NOW.getTime() - 30_000)), NOW.getTime())).toBe(true);
    expect(withinCooldown(baseSnapshot('litellm', new Date(NOW.getTime() - 61_000)), NOW.getTime())).toBe(false);
  });
});

describe('litellm interval floor', () => {
  it('raises stored litellm intervals to the floor and leaves other providers alone', () => {
    const stored = { providers: { litellm: { enabled: true, intervalMin: 1 }, claude: { enabled: true, intervalMin: 1 } } } as unknown as Partial<AppSettings>;
    const merged = mergeSettings(stored);
    expect(merged.providers.litellm.intervalMin).toBe(10);
    expect(merged.providers.claude.intervalMin).toBe(1);
    expect(mergeSettings(undefined).providers.litellm.intervalMin).toBe(15);
  });

  it('clampInterval honors a provider minimum', () => {
    expect(clampInterval(3, 10)).toBe(10);
    expect(clampInterval(15, 10)).toBe(15);
  });
});

describe('isUserIdle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is true for idle and locked, false for active, and fails open on errors', async () => {
    const queryState = vi.fn();
    vi.stubGlobal('chrome', { idle: { queryState } });
    queryState.mockResolvedValueOnce('idle');
    expect(await isUserIdle()).toBe(true);
    queryState.mockResolvedValueOnce('locked');
    expect(await isUserIdle()).toBe(true);
    queryState.mockResolvedValueOnce('active');
    expect(await isUserIdle()).toBe(false);
    queryState.mockRejectedValueOnce(new Error('boom'));
    expect(await isUserIdle()).toBe(false);
  });
});

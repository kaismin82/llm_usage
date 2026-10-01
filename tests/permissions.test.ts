import { describe, expect, it } from 'vitest';
import { litellmOriginPattern, originsFor } from '../src/core/permissions';
import { defaultSettings } from '../src/core/settings';

describe('originsFor', () => {
  const s = defaultSettings();

  it('maps fixed providers to their origin', () => {
    expect(originsFor('claude', s.providers.claude)).toEqual(['https://claude.ai/*']);
    expect(originsFor('chatgpt', s.providers.chatgpt)).toEqual(['https://chatgpt.com/*']);
    expect(originsFor('poe', s.providers.poe)).toEqual(['https://api.poe.com/*']);
    expect(originsFor('openrouter', s.providers.openrouter)).toEqual(['https://openrouter.ai/*']);
  });

  it('switches z.ai host by region', () => {
    expect(originsFor('zai', { ...s.providers.zai, region: 'global' })).toEqual(['https://api.z.ai/*']);
    expect(originsFor('zai', { ...s.providers.zai, region: 'china' })).toEqual(['https://open.bigmodel.cn/*']);
  });

  it('derives the litellm origin from the base url and ignores invalid input', () => {
    expect(litellmOriginPattern('https://proxy.example.com:8443/litellm/')).toBe('https://proxy.example.com:8443/*');
    expect(litellmOriginPattern('http://localhost:4000')).toBe('http://localhost:4000/*');
    expect(litellmOriginPattern('javascript:alert(1)')).toBeNull();
    expect(litellmOriginPattern('')).toBeNull();
    expect(originsFor('litellm', { ...s.providers.litellm, baseUrl: 'nope' })).toEqual([]);
  });
});

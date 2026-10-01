import type { ProviderId, ProviderSettings } from '../providers/types';

export function litellmOriginPattern(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

export function originsFor(id: ProviderId, settings: ProviderSettings): string[] {
  switch (id) {
    case 'claude':
      return ['https://claude.ai/*'];
    case 'chatgpt':
      return ['https://chatgpt.com/*'];
    case 'zai':
      return [settings.region === 'china' ? 'https://open.bigmodel.cn/*' : 'https://api.z.ai/*'];
    case 'poe':
      return ['https://api.poe.com/*'];
    case 'openrouter':
      return ['https://openrouter.ai/*'];
    case 'litellm': {
      const pattern = litellmOriginPattern(settings.baseUrl);
      return pattern ? [pattern] : [];
    }
  }
}

import type { ProviderAdapter, ProviderId } from '../providers/types';
import { chatgptAdapter } from '../providers/chatgpt';
import { claudeAdapter } from '../providers/claude';
import { litellmAdapter } from '../providers/litellm';
import { openrouterAdapter } from '../providers/openrouter';
import { poeAdapter } from '../providers/poe';
import { zaiAdapter } from '../providers/zai';

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  claude: claudeAdapter,
  chatgpt: chatgptAdapter,
  zai: zaiAdapter,
  poe: poeAdapter,
  litellm: litellmAdapter,
  openrouter: openrouterAdapter,
};

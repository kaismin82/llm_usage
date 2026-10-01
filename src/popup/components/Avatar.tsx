import type { ProviderId } from '../../providers/types';

const LETTERS: Record<ProviderId, string> = {
  claude: 'C',
  chatgpt: 'G',
  zai: 'Z',
  poe: 'P',
  litellm: 'L',
  openrouter: 'O',
};

export function Avatar({ id }: { id: ProviderId }) {
  return (
    <span class={`avatar avatar-${id}`} aria-hidden="true">
      {LETTERS[id]}
    </span>
  );
}

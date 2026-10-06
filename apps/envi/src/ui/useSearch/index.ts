import { useState } from 'react';

import type { Hint } from '@/dev-tools/ui/components/HintBar';
import type { PromptApi } from '@/dev-tools/ui/hooks/usePrompt';

import type { Session } from '../types';

/**
 * One search box per tab, kept in the session so it survives a handoff and a tab switch.
 *
 * Narrows the list live as it is typed (Esc puts back what was there before), matching names and
 * values together — see `matchesSearch`.
 */
export const useSearch = (session: Session, tab: string, prompt: PromptApi) => {
  const [search, setSearchState] = useState(session.search[tab] ?? '');
  const set = (value: string) => {
    setSearchState(value);
    session.search[tab] = value;
  };
  const open = () => {
    const before = search;
    prompt.ask('Search names and values (k:/v: for one side):', (value) => set(value.trim()), {
      initial: search,
      onChange: set,
      onCancel: () => set(before),
    });
  };
  const clear = () => set('');
  const hints: Hint[] = [
    { key: '/', label: search ? `search: ${search}` : 'search', onPress: open },
    ...(search ? [{ key: 'Esc', label: 'clear', onPress: clear }] : []),
  ];
  return { search, open, clear, hints };
};

export default useSearch;

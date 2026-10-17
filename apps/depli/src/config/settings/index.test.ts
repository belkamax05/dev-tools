import { expect, spyOn, test } from 'bun:test';

import { resolveSelection } from '../../core/branch';
import { type DepliState, flushState, stateStore, updateState } from '.';

test('a branch pick survives the simultaneous tab change and reopening', async () => {
  let stored: DepliState = {
    tab: 'branches',
    projects: { project: { selected: 'release-sprint-26.14', pickedWhileOn: 'fix/current' } },
  };
  const load = spyOn(stateStore, 'load').mockImplementation(async () => structuredClone(stored));
  const save = spyOn(stateStore, 'save').mockImplementation(async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    stored = structuredClone(state);
  });
  try {
    await Promise.all([
      updateState((state) => ({
        ...state,
        projects: {
          ...state.projects,
          project: { selected: 'feature/chosen', pickedWhileOn: 'fix/current', env: 'ci3' },
        },
      })),
      updateState((state) => ({ ...state, tab: 'chain' })),
    ]);
    await flushState();
    expect(stored.tab).toBe('chain');
    expect(resolveSelection(stored.projects.project ?? {}, 'fix/current').branch).toBe(
      'feature/chosen',
    );
    expect(stored.projects.project?.env).toBe('ci3');
  } finally {
    load.mockRestore();
    save.mockRestore();
  }
});

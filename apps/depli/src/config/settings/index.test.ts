import { expect, spyOn, test } from 'bun:test';

import { resolveSelection } from '../../core/branch';
import { type DepliState, flushState, stateStore, updateState } from '.';

test('a branch pick survives the simultaneous tab change and reopening', async () => {
  let stored: DepliState = {
    tab: 'connections',
    flows: {},
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
    expect(resolveSelection(stored.projects.project ?? {}).branch).toBe('feature/chosen');
    expect(stored.projects.project?.env).toBe('ci3');
  } finally {
    load.mockRestore();
    save.mockRestore();
  }
});

test('the timings toggle is saved with project state and survives a tab update', async () => {
  const { saveSession } = await import('../../core/session');
  let stored: DepliState = { tab: 'chain', projects: {}, flows: {} };
  const load = spyOn(stateStore, 'load').mockImplementation(async () => structuredClone(stored));
  const save = spyOn(stateStore, 'save').mockImplementation(async (state) => {
    stored = structuredClone(state);
  });
  try {
    const project = { dir: 'project', config: {}, providers: [], problems: [] };
    await saveSession({
      project,
      state: {
        selected: 'feature/test',
        timingsExpanded: true,
        otherRunsExpanded: { 'build:ci:42': true },
      },
    });
    await updateState((state) => ({ ...state, tab: 'settings' }));
    expect((await stateStore.load()).projects.project?.timingsExpanded).toBe(true);
    expect((await stateStore.load()).projects.project?.otherRunsExpanded?.['build:ci:42']).toBe(
      true,
    );
    await saveSession({ project, state: { ...stored.projects.project, timingsExpanded: false } });
    expect((await stateStore.load()).projects.project?.timingsExpanded).toBe(false);
    expect((await stateStore.load()).projects.project?.selected).toBe('feature/test');
  } finally {
    load.mockRestore();
    save.mockRestore();
  }
});

test('each flow keeps its own pick, and the flow switched to is remembered per folder', async () => {
  const { saveFlow, saveSession } = await import('../../core/session');
  let stored: DepliState = { tab: 'chain', projects: {}, flows: {} };
  const load = spyOn(stateStore, 'load').mockImplementation(async () => structuredClone(stored));
  const save = spyOn(stateStore, 'save').mockImplementation(async (state) => {
    stored = structuredClone(state);
  });
  try {
    const project = (id: string) => ({
      dir: 'project',
      flow: { id, label: id, all: ['fe', 'be'] },
      config: {},
      providers: [],
      problems: [],
    });
    await saveSession({ project: project('fe'), state: { selected: 'develop', env: 'ci' } });
    await saveSession({ project: project('be'), state: { selected: 'master', env: 'uat3' } });
    await saveFlow(project('be'));
    await flushState();
    expect(stored.projects['project#fe']?.selected).toBe('develop');
    expect(stored.projects['project#be']?.env).toBe('uat3');
    expect(stored.projects.project).toBeUndefined();
    expect(stored.flows).toEqual({ project: 'be' });
  } finally {
    load.mockRestore();
    save.mockRestore();
  }
});

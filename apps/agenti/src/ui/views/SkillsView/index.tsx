import { relative } from 'node:path';
import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import type { Hint } from '@/dev-tools/ui/components/HintBar';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import {
  addSkill,
  type InstalledSkill,
  listSkills,
  missingFromLock,
  readSkillDoc,
  removeSkill,
  restoreSkills,
  type SkillActionResult,
  type SkillSearchResult,
  searchSkills,
  skillDescription,
  updateSkill,
} from '../../../core/skills';
import revealPath from '@/dev-tools/utils/system/revealPath';
import Toolbar, { type ToolbarAction } from '@/dev-tools/ui/components/Toolbar';
import type { ViewProps } from '../../types';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import usePrompt from '@/dev-tools/ui/hooks/usePrompt';

type Row =
  | { kind: 'installed'; skill: InstalledSkill }
  | { kind: 'result'; result: SkillSearchResult };

/** The last line of CLI output worth showing — usually its verdict. */
const lastLine = (output: string) =>
  output
    .split('\n')
    .map((line) => line.replace(/^[\s│├└◇◆●■▲]+/, '').trim())
    .filter(Boolean)
    .at(-1) ?? '';

const installedHint = (skill: InstalledSkill) =>
  skill.hasLocalChanges
    ? 'modified'
    : skill.isWorkspaceOrigin
      ? 'workspace'
      : skill.source
        ? skill.source
        : 'untracked';

/**
 * The repository's project skills, and the skills.sh registry — the web
 * version's Skills page, both tabs of it: Installed, and Search one keypress
 * away.
 *
 * Everything here runs the `skills` CLI through npx, which takes seconds, so
 * each action says it is running and the keys wait for it rather than queueing
 * a second install behind the first.
 */
export const SkillsView = ({
  scope,
  root,
  session,
  notify,
  onCaptureInput,
  handoff,
  refreshKey,
}: ViewProps) => {
  const colors = useColors();
  const viewport = useViewport();
  const prompt = usePrompt(onCaptureInput);
  const [currentId, setCurrentId] = useState<string | undefined>(session.selected.skills);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState<{ query: string; results: SkillSearchResult[] } | undefined>(
    undefined,
  );

  //? The user scope starts on the user's own skills; a repository on its own
  const [global, setGlobal] = useState(scope.kind === 'user');
  const installed = useLoader(() => listSkills(root, global), [root, global, refreshKey]);
  const missing = global ? [] : missingFromLock(root);
  const restore = () =>
    prompt.confirm(`Reinstall ${missing.length} skill(s) listed in skills-lock.json?`, () =>
      run('Restoring skills', () => restoreSkills(root)),
    );
  const toggleGlobal = () => {
    setGlobal((on) => !on);
    setSearch(undefined);
  };
  const skills = installed.data ?? [];
  const installedNames = new Set(skills.map((skill) => skill.name));

  const items: PickItem<Row>[] = search
    ? search.results.map((result) => ({
        id: `result:${result.id}`,
        label: `${result.skillName}  ${result.owner}/${result.repo}`,
        hint: installedNames.has(result.skillName)
          ? 'installed'
          : `${result.installs.toLocaleString()} installs`,
        value: { kind: 'result', result },
      }))
    : skills.map((skill) => ({
        id: `skill:${skill.name}`,
        label: skill.name,
        hint: installedHint(skill),
        value: { kind: 'installed', skill },
      }));
  const current = items.find((item) => item.id === currentId)?.value;

  const run = (label: string, action: () => Promise<SkillActionResult>, after?: () => void) => {
    setBusy(label);
    action()
      .then((result) => {
        notify(
          lastLine(result.output) || (result.ok ? `${label} — done` : `${label} — failed`),
          result.ok ? 'ok' : 'error',
        );
        if (result.ok) after?.();
        installed.reload();
      })
      .catch((cause: unknown) => notify(String(cause), 'error'))
      .finally(() => setBusy(undefined));
  };

  const startSearch = () =>
    prompt.ask('Search skills.sh for', (query) => {
      if (!query.trim()) return;
      setBusy(`Searching for "${query}"`);
      searchSkills(query, root)
        .then((results) => {
          setSearch({ query, results });
          notify(
            results.length
              ? `${results.length} results for "${query}"`
              : `Nothing found for "${query}"`,
            'info',
          );
        })
        .catch((cause: unknown) => notify(String(cause), 'error'))
        .finally(() => setBusy(undefined));
    });

  const install = (result: SkillSearchResult) =>
    prompt.confirm(`Install ${result.id} into this repository?`, () =>
      run(
        `Installing ${result.skillName}`,
        () => addSkill(result.id, root, global),
        () => setSearch(undefined),
      ),
    );

  const update = (skill: InstalledSkill) => {
    const warning = skill.hasLocalChanges ? ' Its local changes will be lost.' : '';
    prompt.confirm(`Reinstall ${skill.name} from ${skill.source ?? 'its source'}?${warning}`, () =>
      run(`Updating ${skill.name}`, () => updateSkill(skill.name, root)),
    );
  };

  const remove = (skill: InstalledSkill) =>
    prompt.confirm(`Remove ${skill.name} from this repository?`, () =>
      run(`Removing ${skill.name}`, () => removeSkill(skill.name, root, global)),
    );

  const edit = (skill: InstalledSkill) => handoff({ type: 'edit', path: `${skill.path}/SKILL.md` });

  /** The buttons for a row. Editing is one of them — never what a click on the row does. */
  const actionsFor = (row: Row): ToolbarAction[] => {
    if (row.kind === 'result') {
      return [
        {
          hotkey: 'i',
          label: installedNames.has(row.result.skillName) ? 'Reinstall' : 'Install',
          onPress: () => install(row.result),
          tone: 'primary',
          disabled: Boolean(busy),
        },
      ];
    }
    const { skill } = row;
    return [
      { hotkey: 'e', label: 'Edit SKILL.md', onPress: () => edit(skill), tone: 'primary' },
      {
        hotkey: 'u',
        label: 'Update',
        onPress: () => update(skill),
        //? Reinstalling goes by the repository's lock file; a user-wide skill has none
        disabled: Boolean(busy) || !skill.source || global,
      },
      { hotkey: 'o', label: 'Reveal', onPress: () => revealPath(skill.path) },
      {
        hotkey: 'x',
        label: 'Remove',
        onPress: () => remove(skill),
        tone: 'danger',
        disabled: Boolean(busy),
      },
    ];
  };

  useInput(
    (input, key) => {
      if (busy) return;
      if (input === '/') return startSearch();
      if (input === 'G') return toggleGlobal();
      if (input === 'R' && missing.length) return restore();
      if (key.escape && search) return setSearch(undefined);

      if (current?.kind === 'result') {
        if (input === 'i') install(current.result);
        return;
      }
      if (current?.kind !== 'installed') return;
      const { skill } = current;
      if (input === 'u') update(skill);
      else if (input === 'x') remove(skill);
      else if (input === 'e') edit(skill);
      else if (input === 'o') revealPath(skill.path);
    },
    { isActive: !prompt.isOpen },
  );

  //? Row actions are the toolbar's; the strip keeps searching
  const hints: Hint[] = search
    ? [
        { key: '/', label: 'search again', onPress: startSearch },
        { key: 'Esc', label: 'installed', onPress: () => setSearch(undefined) },
      ]
    : [
        { key: '/', label: 'search registry', onPress: startSearch },
        {
          key: 'G',
          label: global ? 'showing: user-wide' : 'showing: this repo',
          onPress: toggleGlobal,
        },
        ...(missing.length
          ? [{ key: 'R', label: `restore ${missing.length}`, onPress: restore }]
          : []),
      ];

  const header =
    prompt.line ??
    (busy ? (
      <Text color={colors.accent} wrap="truncate">
        {busy}…
      </Text>
    ) : (
      <Text color={colors.muted} wrap="truncate">
        {search
          ? `skills.sh results for "${search.query}" · Esc back to installed`
          : installed.isLoading && !installed.data
            ? 'Asking the skills CLI what is installed…'
            : global
              ? `${skills.length} user-wide skill(s) — in every repository`
              : `${skills.length} project skill(s) in .agents/skills${
                  missing.length
                    ? ` · ${missing.length} locked but not installed — [R] restores`
                    : ''
                }`}
      </Text>
    ));

  const detailRows = Math.max(
    3,
    //? less the toolbar and its rule
    viewport.contentRows(['appShell', 'viewHints', 'panelFrame', 'viewHeader'], 3) - 4,
  );

  const renderDetail = (item: PickItem<Row> | undefined) => {
    const row = item?.value;
    if (!row) return null;

    if (row.kind === 'result') {
      const { result } = row;
      return (
        <Box flexDirection="column">
          <Toolbar actions={actionsFor(row)} />
          <Text color={colors.text} wrap="truncate">
            {result.id}
          </Text>
          <Text color={colors.muted} wrap="truncate">
            {result.installs.toLocaleString()} installs
          </Text>
          <Text color={colors.muted} wrap="truncate">
            {result.url}
          </Text>
          <Box marginTop={1}>
            <Text color={installedNames.has(result.skillName) ? colors.warn : colors.accent}>
              {installedNames.has(result.skillName)
                ? 'Already installed here — [i] reinstalls it'
                : '[i] installs it'}
            </Text>
          </Box>
        </Box>
      );
    }

    const { skill } = row;
    const doc = readSkillDoc(skill);
    const description = skillDescription(doc);
    const facts: [string, string, string][] = [
      ['path', relative(root, skill.path), colors.muted],
      ['agents', skill.agents.join(', ') || '—', colors.muted],
      [
        'source',
        skill.source ?? (skill.isWorkspaceOrigin ? 'written in this repo' : 'not tracked'),
        colors.muted,
      ],
      ...(skill.lockedHash
        ? [['hash', skill.lockedHash.slice(0, 12), colors.muted] as [string, string, string]]
        : []),
      ...(skill.hasLocalChanges
        ? [['changes', 'modified since it was installed', colors.warn] as [string, string, string]]
        : []),
    ];
    const body = (description ? [description, ''] : []).concat(
      (doc ?? '(no SKILL.md)')
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .trim()
        .split('\n'),
    );

    return (
      <Box flexDirection="column">
        <Toolbar actions={actionsFor(row)} />
        {facts.map(([label, value, color]) => (
          <Text key={label} wrap="truncate">
            <Text color={colors.muted}>{label.padEnd(8)}</Text>
            <Text color={color}>{value}</Text>
          </Text>
        ))}
        <Box flexDirection="column" marginTop={1}>
          {body.slice(0, Math.max(1, detailRows - facts.length - 1)).map((line, index) => (
            <Text
              key={index}
              color={index === 0 && description ? colors.text : colors.muted}
              wrap="truncate"
            >
              {line || ' '}
            </Text>
          ))}
        </Box>
      </Box>
    );
  };

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>{header}</Box>
      <ListDetail
        title={search ? `Registry (${items.length})` : `Skills (${items.length})`}
        items={items}
        emptyText={
          search
            ? 'No results.'
            : installed.isLoading
              ? 'Loading…'
              : (installed.error ?? 'No project skills yet — [/] searches the registry.')
        }
        detailTitle={
          current?.kind === 'result' ? current.result.skillName : (current?.skill.name ?? 'Skill')
        }
        renderDetail={renderDetail}
        hints={hints}
        reservedChrome={['viewHeader']}
        //? A click selects; editing is the toolbar's [e] Edit
        activateOnClick={false}
        initialSelectedId={session.selected.skills}
        isInputActive={!prompt.isOpen && !busy}
        onSelectionChange={(item) => {
          setCurrentId(item?.id);
          session.selected.skills = item?.id;
        }}
      />
    </Box>
  );
};

export default SkillsView;

import { Text, useInput } from 'ink';
import { useState } from 'react';

import Box from '@/dev-tools/ui/components/Box';
import ListDetail from '@/dev-tools/ui/components/ListDetail';
import type { PickItem } from '@/dev-tools/ui/components/PickList';
import Toolbar from '@/dev-tools/ui/components/Toolbar';
import useLoader from '@/dev-tools/ui/hooks/useLoader';
import { useColors } from '@/dev-tools/ui/providers/TuiThemeProvider';

import { getPackageInfo, getPublishTimes } from '../../core/registry';
import { compareVersions, isPrerelease, updateKind } from '../../core/semver';

export interface VersionPickerProps {
  name: string;
  /** The version in use, marked in the list; undefined when adding a new package. */
  current?: string;
  registry: string;
  cacheHours: number;
  /** Start with prereleases shown — the folder's setting; `D` flips it for this picker. */
  showUnstable: boolean;
  /** What Enter does with the version, in words — "install", "switch to". */
  verb: string;
  onPick: (version: string) => void;
  onClose: () => void;
}

interface VersionRow {
  version: string;
  tags: string[];
  deprecated?: string;
  published?: string;
}

/**
 * Every published version of a package, newest first, to move to any of them — the web page's
 * version dropdown, as a list.
 *
 * Publish dates come from the registry's full document, which can be large, so they arrive after
 * the list does rather than holding it up.
 */
export const VersionPicker = ({
  name,
  current,
  registry,
  cacheHours,
  showUnstable: initialUnstable,
  verb,
  onPick,
  onClose,
}: VersionPickerProps) => {
  const colors = useColors();
  const [showUnstable, setShowUnstable] = useState(initialUnstable);
  const { data: info, isLoading } = useLoader(
    () => getPackageInfo(name, { registry, maxAgeMs: cacheHours * 3600_000 }),
    [name, registry],
  );
  const { data: times = {} } = useLoader(() => getPublishTimes(name, registry), [name, registry]);

  const tagsFor = (version: string) =>
    Object.entries(info?.distTags ?? {})
      .filter(([, tagged]) => tagged === version)
      .map(([tag]) => tag);

  const rows: VersionRow[] = [...(info?.versions ?? [])]
    .sort((a, b) => compareVersions(b, a))
    .filter(
      (version) =>
        showUnstable || !isPrerelease(version) || version === current || tagsFor(version).length,
    )
    .map((version) => ({
      version,
      tags: tagsFor(version),
      deprecated: info?.deprecated[version],
      published: times[version]?.slice(0, 10),
    }));

  const items: PickItem<VersionRow>[] = rows.map((row) => {
    const kind = current ? updateKind(current, row.version) : 'none';
    return {
      id: row.version,
      label: row.version,
      hint: [
        row.tags.join(', '),
        row.version === current ? 'in use' : '',
        row.deprecated ? 'deprecated' : '',
        row.published ?? '',
      ]
        .filter(Boolean)
        .join(' · '),
      hintColor: row.deprecated
        ? colors.error
        : row.version === current
          ? colors.accent
          : kind === 'major'
            ? colors.error
            : kind === 'minor'
              ? colors.warn
              : undefined,
      isCurrent: row.version === current,
      value: row,
    };
  });

  useInput((input, key) => {
    if (key.escape) onClose();
    else if (input === 'D') setShowUnstable((was) => !was);
  });

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      <Box flexShrink={0}>
        <Text color={colors.muted} wrap="truncate">
          {`${name} — ${info?.versions.length ?? '…'} versions${showUnstable ? ' incl. prereleases' : ''} · Esc back`}
        </Text>
      </Box>
      <ListDetail
        //? Remounted once the registry answers, so the cursor lands on the version in use (or
        //? `latest`) — an id that did not exist yet when the list first mounted
        key={`${Boolean(info)}-${showUnstable}`}
        title={`Versions (${rows.length})`}
        items={items}
        emptyText={isLoading ? 'Asking the registry…' : (info?.error ?? 'No versions.')}
        detailTitle={name}
        reservedChrome={['viewHeader']}
        activateLabel={verb}
        activateOnClick={false}
        initialSelectedId={
          current && rows.some((row) => row.version === current) ? current : info?.latest
        }
        hints={[
          {
            key: 'D',
            label: showUnstable ? 'hide prereleases' : 'show prereleases',
            onPress: () => setShowUnstable((was) => !was),
          },
          { key: 'Esc', label: 'back', onPress: onClose },
        ]}
        onActivate={(item) => item.value && onPick(item.value.version)}
        renderDetail={(item) => {
          const row = item?.value;
          if (!row) return null;
          const kind = current ? updateKind(current, row.version) : 'none';
          return (
            <Box flexDirection="column">
              <Toolbar
                actions={[
                  {
                    hotkey: 'Enter',
                    label: `${verb[0]?.toUpperCase()}${verb.slice(1)} ${row.version}`,
                    onPress: () => onPick(row.version),
                    tone: 'primary',
                    disabled: row.version === current,
                  },
                  { hotkey: 'Esc', label: 'Back', onPress: onClose },
                ]}
              />
              <Text bold color={colors.heading}>
                {`${name}@${row.version}`}
              </Text>
              {row.tags.length > 0 && (
                <Text color={colors.accent}>{`tagged ${row.tags.join(', ')}`}</Text>
              )}
              {row.published && <Text color={colors.muted}>{`published ${row.published}`}</Text>}
              {current && row.version !== current && (
                <Text
                  color={
                    kind === 'major' ? colors.error : kind === 'none' ? colors.warn : colors.text
                  }
                >
                  {kind === 'none'
                    ? `older than ${current} — a downgrade`
                    : `${kind} ${kind === 'prerelease' ? 'version' : 'update'} from ${current}`}
                </Text>
              )}
              {row.deprecated && (
                <Box marginTop={1}>
                  <Text color={colors.error} wrap="wrap">{`Deprecated: ${row.deprecated}`}</Text>
                </Box>
              )}
            </Box>
          );
        }}
      />
    </Box>
  );
};

export default VersionPicker;

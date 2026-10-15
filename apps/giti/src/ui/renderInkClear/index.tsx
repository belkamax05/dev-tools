import { render, useApp } from 'ink';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import { TuiThemeProvider } from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import type { ClearIgnoredResult, IgnoredOptions } from '../../core/ignored';
import gitiTheme from '../dashboard/theme';
import { DEFAULT_REFRESH_SECONDS } from '../dashboard/views/SettingsView';
import IgnoredView from '../dashboard/views/IgnoredView';

const ClearApp = ({
  root,
  options,
  onCleared,
}: {
  root: string;
  options?: IgnoredOptions;
  onCleared: (result: ClearIgnoredResult) => void;
}) => {
  const { exit } = useApp();
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <IgnoredView root={root} options={options} onClose={exit} onCleared={onCleared} />
    </Box>
  );
};

/**
 * `giti clear`'s tree, full screen, in the dashboard's theme.
 *
 * The same view the dashboard opens from Overview (`I`), so the two can never disagree about
 * what is ignored or what Enter does. It stays open after a clear — the tree rescans, and Esc
 * leaves — and what was removed is printed once the terminal is back, where it stays readable.
 */
const renderInkClear = async (root: string, options?: IgnoredOptions) => {
  //? Only for the palette: the same file the dashboard reads, so `giti clear` looks like it
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: 'classic', refreshSeconds: DEFAULT_REFRESH_SECONDS },
  }).load();

  const results: ClearIgnoredResult[] = [];
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <ClearApp root={root} options={options} onCleared={(result) => results.push(result)} />
    </TuiThemeProvider>,
    { render, keepProcessAlive: true },
  );

  for (const result of results) {
    for (const path of result.removed) console.log(`🗑️  ${path}`);
    for (const { path, error } of result.failed) console.error(`❌ ${path}: ${error}`);
  }
  if (!results.length) console.log('Nothing removed.');
};

export default renderInkClear;

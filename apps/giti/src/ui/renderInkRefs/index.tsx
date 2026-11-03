import { render, Text, useApp, useInput } from 'ink';
import { useState } from 'react';

import runTuiApp from '@/dev-tools/ui/app/runTuiApp';
import Box from '@/dev-tools/ui/components/Box';
import useViewport from '@/dev-tools/ui/hooks/useViewport';
import {
  TuiThemeProvider,
  useColors,
  useTuiTheme,
} from '@/dev-tools/ui/providers/TuiThemeProvider';
import createConfigStore from '@/dev-tools/utils/config/createConfigStore';

import gitiTheme, { GITI_DEFAULT_PALETTE } from '../dashboard/theme';
import type { Tone, UndoOffer } from '../dashboard/types';
import RefsView from '../dashboard/views/RefsView';

/**
 * `RefsView` on a screen of its own, with a status line for what its actions report and the last
 * undo on ^Z — what the dashboard's App gives the view there.
 */
const RefsScreen = ({ cwd }: { cwd: string }) => {
  const { exit } = useApp();
  const colors = useColors();
  const viewport = useViewport();
  const height = Math.max(1, viewport.rows - useTuiTheme().sizes.app.heldBackRows);
  const [captured, setCaptured] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [note, setNote] = useState<{ text: string; tone: Tone }>();
  const [undo, setUndo] = useState<UndoOffer>();
  const reload = () => setRefreshKey((n) => n + 1);
  const runUndo = async () => {
    if (!undo) return;
    setUndo(undefined);
    const result = await undo.run();
    setNote({ text: result.message, tone: result.ok ? 'ok' : 'error' });
    reload();
  };

  useInput(
    (input, key) => {
      if ((key.ctrl && input === 'c') || key.escape || input === 'q') return exit();
      if (key.ctrl && input === 'z') return void runUndo();
      if (input === 'r') reload();
    },
    { isActive: !captured },
  );

  return (
    <Box flexDirection="column" height={height} paddingX={1}>
      <RefsView
        root={cwd}
        refreshKey={refreshKey}
        reload={reload}
        notify={(text, tone = 'info') => setNote({ text, tone })}
        onCaptureInput={setCaptured}
        offerUndo={setUndo}
        reservedChrome={['viewHeader']}
        fitToHost
        extraHints={[
          { key: 'r', label: 'reload', onPress: reload },
          ...(undo ? [{ key: '^Z', label: 'undo', onPress: () => void runUndo() }] : []),
          { key: 'Esc/q', label: 'quit', onPress: exit },
        ]}
      />
      <Text
        wrap="truncate"
        color={
          note?.tone === 'error'
            ? colors.error
            : note?.tone === 'warn'
              ? colors.warn
              : note?.tone === 'ok'
                ? colors.ok
                : colors.muted
        }
      >
        {note ? `${note.text}${undo ? ' · ^Z undoes' : ''}` : ' '}
      </Text>
    </Box>
  );
};

/** Open the refs browser; resolves once it is closed. */
const renderInkRefs = async ({ cwd }: { cwd: string }) => {
  const config = await createConfigStore({
    appName: 'giti',
    defaults: { theme: GITI_DEFAULT_PALETTE },
  }).load();
  await runTuiApp(
    <TuiThemeProvider theme={gitiTheme} palette={config.theme}>
      <RefsScreen cwd={cwd} />
    </TuiThemeProvider>,
    { render, keepProcessAlive: true, enhancedKeyboard: true },
  );
};

export default renderInkRefs;

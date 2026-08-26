/**
 * The shared terminal-UI kit.
 *
 * A component library, the hooks under it, and the terminal-protocol layer they
 * are built on — mouse reporting, the alternate screen, and the stdin filter
 * that keeps the two apart.
 *
 * Import from here or from the module folders directly; both resolve to the same
 * files. Everything below is safe to render inside a consumer's own Ink tree
 * **as long as the consumer is a workspace member of `~/dev/shulker`**, which is
 * what makes it share this lib's single copy of `react` and `ink`. A repo that
 * installs its own copies must stay on the data-in/value-out boundary in
 * `ui/dialogs` instead — see the README.
 */
export * from './app/runTuiApp';
export * from './components';
export * from './hooks';
export {
  default as TuiThemeProvider,
  resolveColors,
  useColors,
  useTuiTheme,
} from './providers/TuiThemeProvider';
export type { ThemeColors, TuiThemeProviderProps } from './providers/TuiThemeProvider';
export * from './terminal';
export * from './theme';

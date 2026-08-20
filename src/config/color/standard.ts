import palette from './palette';

const standardColor = {
  command: palette.cyan,
  info: palette.cyan,
  argument: palette.yellow,
  params: palette.hotpink,
  success: palette.green,
  error: palette.dark_red,
  debug: palette.magenta,
  warning: palette.dark_orange,
  args: palette.yellow,
  arg: palette.yellow,
  todo: palette.dark_green,
  catalog: palette.dark_purple,
} as const satisfies Record<string, string>;

export default standardColor;

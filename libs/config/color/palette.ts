import terminalColor from '../../utils/color/terminalColor';

const palette = {
  cyan: terminalColor('#00ffff'),
  dark_red: terminalColor('#ff3131'),
  red: terminalColor('#ff0000'),
  yellow: terminalColor('#ffff00'),
  hotpink: terminalColor('#ff00af'),
  green: terminalColor('#00ff00'),
  magenta: terminalColor('#c965c9'),
  white: terminalColor('#ffffff'),
  dark_blue: terminalColor('#0000ff'),
  dark_green: terminalColor('#00ff00'),
  dark_yellow: terminalColor('#ffff00'),
  dark_cyan: terminalColor('#00ffff'),
  dark_magenta: terminalColor('#ff00ff'),
  dark_white: terminalColor('#ffffff'),
  dark_gray: terminalColor('#808080'),
  dark_orange: terminalColor('#ffa500'),
  dark_pink: terminalColor('#ff69b4'),
  dark_purple: terminalColor('#800080'),
  dark_turquoise: terminalColor('#40e0d0'),
} as const satisfies Record<string, string>;

export default palette;

import palette from '../../config/color/palette';
import standard from '../../config/color/standard';
import { styles } from '../../config/color/styles';
import terminalColor from '../color/terminalColor';

type StandardVariant = keyof typeof standard;
type PaletteVariant = keyof typeof palette;
type HexVariant = `#${string}`;

const formatColor = (text: string, color: StandardVariant | PaletteVariant | HexVariant) => {
  if (color in standard) {
    return `${standard[color as StandardVariant]}${text}${styles.reset}`;
  }
  if (color in palette) {
    return `${palette[color as PaletteVariant]}${text}${styles.reset}`;
  }
  return `${terminalColor(color)}${text}${styles.reset}`;
};

export default formatColor;

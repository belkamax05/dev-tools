import hexToRgb from './hexToRgb';
import rgbToAnsi from './rgbToAnsi';

// ? ex. "color"
const terminalColor = (hex: string): string => {
  const [r, g, b] = hexToRgb(hex);
  return rgbToAnsi(r, g, b);
};

export default terminalColor;

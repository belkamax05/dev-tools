// Hex to RGB conversion
const hexToRgb = (hex: string): [number, number, number] => {
  const cleanHex = hex.replace(/^#/, '');
  if (cleanHex.length !== 6) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return [r, g, b];
};

export default hexToRgb;

const rgbToAnsi = (r: number, g: number, b: number): string => {
  return `\x1b[38;2;${r};${g};${b}m`;
};

export default rgbToAnsi;

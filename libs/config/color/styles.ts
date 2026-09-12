export const styles = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cursive: '\x1b[3m',
  underline: '\x1b[4m',
} as const satisfies Record<string, string>;

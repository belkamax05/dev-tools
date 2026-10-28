import { describe, expect, test } from 'bun:test';
import getGitiCommand from '.';

describe('getGitiCommand', () => {
  test('is giti when no wrapping CLI names itself', () => {
    expect(getGitiCommand({})).toBe('giti');
  });

  test('is the command a wrapping CLI sets in GITI_COMMAND', () => {
    expect(getGitiCommand({ GITI_COMMAND: 'dfs git' })).toBe('dfs git');
  });

  test('falls back to giti when GITI_COMMAND is blank', () => {
    expect(getGitiCommand({ GITI_COMMAND: '  ' })).toBe('giti');
  });
});

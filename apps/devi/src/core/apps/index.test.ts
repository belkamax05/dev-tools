import { describe, expect, test } from 'bun:test';

import { parseAliases } from './index';

describe('parseAliases', () => {
  test('a list names aliases of the app itself', () => {
    expect(parseAliases(['port', 'bad name', 3])).toEqual([{ name: 'port', args: [] }]);
  });

  test('an object maps each alias to the arguments it opens with', () => {
    expect(parseAliases({ agent: '', mcp: 'mcp', skills: 'skills --user', broken: 1 })).toEqual([
      { name: 'agent', args: [] },
      { name: 'mcp', args: ['mcp'] },
      { name: 'skills', args: ['skills', '--user'] },
    ]);
  });
});

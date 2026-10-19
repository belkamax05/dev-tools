import { expect, test } from 'bun:test';
import describePush from '.';

//? Colour codes are not what is being checked
const plain = (lines: string[]) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI colours is the point
  lines.map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').trim());

test('lists every ref git reports as updated, new or forced', () => {
  const output = [
    'Enumerating objects: 5, done.',
    'To github.com:org/repo.git',
    '   ecf1c64..f02ccd1  main -> main',
    ' * [new branch]      feat -> feat',
    ' + a1b2c3d...e4f5a6b release -> release (forced update)',
  ].join('\n');
  expect(plain(describePush(output))).toEqual([
    'ecf1c64..f02ccd1  main → main',
    '[new branch]  feat → feat',
    'a1b2c3d...e4f5a6b  release → release (forced update)',
  ]);
});

test('says nothing when git moved no ref', () => {
  expect(describePush('Everything up-to-date')).toEqual([]);
});

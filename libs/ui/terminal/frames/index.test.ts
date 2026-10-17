import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';

import { screenErasures, watchForErasures } from '.';

test('tracks incremental line erases, screen erases and split or buffered sequences', () => {
  const stream = new PassThrough() as unknown as NodeJS.WriteStream;
  stream.on('data', () => {});
  const stop = watchForErasures(stream);
  try {
    for (const erase of [
      '\x1b[K',
      '\x1b[0K',
      '\x1b[1K',
      '\x1b[2K',
      '\x1b[J',
      '\x1b[0J',
      '\x1b[1J',
      '\x1b[2J',
      '\x1b[?1049h',
      '\x1b[?1049l',
    ]) {
      const before = screenErasures();
      stream.write(erase);
      expect(screenErasures()).toBe(before + 1);
    }
    let before = screenErasures();
    stream.write(Buffer.from('\x1b[K'));
    expect(screenErasures()).toBe(before + 1);
    before = screenErasures();
    stream.write('\x1b[');
    expect(screenErasures()).toBe(before);
    stream.write('K');
    expect(screenErasures()).toBe(before + 1);
    before = screenErasures();
    stream.write('ordinary text\x1b[3;4H\x1b[32m');
    expect(screenErasures()).toBe(before);
  } finally {
    stop();
  }
});

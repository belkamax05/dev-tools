import { describe, expect, test } from 'bun:test';

import { ESC, ST } from '..';
import { applySgr, color256, parseAnsi, stripAnsi, XTERM_PALETTE } from '.';

const text = (input: string) => parseAnsi(input).map((line) => line.map((s) => s.text).join(''));

const CUSTOM = Array.from({ length: 16 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);

describe('parseAnsi', () => {
  test('plain lines, CRLF and tabs', () => {
    expect(text('one\r\ntwo\nthree')).toEqual(['one', 'two', 'three']);
    expect(text('a\tb')).toEqual(['a       b']);
  });

  test('styles become spans and carry across lines', () => {
    const [first, second] = parseAnsi(`${ESC}[31mred\nstill${ESC}[0m plain`);
    expect(first).toEqual([{ text: 'red', style: { fg: XTERM_PALETTE[1] } }]);
    expect(second?.map((s) => [s.text, s.style.fg])).toEqual([
      ['still', XTERM_PALETTE[1]],
      [' plain', undefined],
    ]);
  });

  test('base colours come from the palette given', () => {
    const [line] = parseAnsi(`${ESC}[31;102mx`, { palette: CUSTOM });
    expect(line?.[0]?.style).toEqual({ fg: CUSTOM[1], bg: CUSTOM[10] });
  });

  test('a spinner redrawn with ESC[1G ESC[J keeps only its last frame', () => {
    const frames = ['◒  fixing', '◐  fixing', '◇  fixes applied']
      .map((frame) => `${ESC}[1G${ESC}[J${frame}`)
      .join('');
    expect(text(`${frames}\nnext`)).toEqual(['◇  fixes applied', 'next']);
  });

  test('carriage return overwrites from the start; ESC[K erases the rest', () => {
    expect(text('progress 10%\rprogress 100%')).toEqual(['progress 100%']);
    expect(text(`long old text\rshort${ESC}[K`)).toEqual(['short']);
    expect(text('long old text\rshort')).toEqual(['shortold text']);
  });

  test('cursor hiding, OSC titles and links are dropped', () => {
    expect(
      text(
        `${ESC}[?25lhi${ESC}]0;title\x07 ${ESC}]8;;https://x${ST}link${ESC}]8;;${ST}${ESC}[?25h`,
      ),
    ).toEqual(['hi link']);
  });
});

describe('stripAnsi', () => {
  test('removes escapes but keeps the text and its line breaks', () => {
    expect(
      stripAnsi(`${ESC}[1;32m✔${ESC}[0m done\r\n${ESC}]8;;https://x${ST}link${ESC}]8;;${ST}`),
    ).toBe('✔ done\r\nlink');
  });
});

describe('colours', () => {
  test('xterm palette, 256-colour cube and greys', () => {
    expect(XTERM_PALETTE.slice(0, 2)).toEqual(['#000000', '#cd0000']);
    expect(color256(1)).toBe('#cd0000');
    expect(color256(1, CUSTOM)).toBe(CUSTOM[1] as string);
    expect(color256(196)).toBe('#ff0000');
    expect(color256(232)).toBe('#080808');
  });

  test('38;5 / 48;2 and resets', () => {
    expect(applySgr({}, [38, 5, 196, 48, 2, 1, 2, 3])).toEqual({ fg: '#ff0000', bg: '#010203' });
    expect(applySgr({ bold: true, fg: '#fff' }, [0])).toEqual({});
    expect(applySgr({ bold: true, dim: true }, [22])).toEqual({ bold: false, dim: false });
    expect(applySgr({}, [92, 101], CUSTOM)).toEqual({ fg: CUSTOM[10], bg: CUSTOM[9] });
  });
});

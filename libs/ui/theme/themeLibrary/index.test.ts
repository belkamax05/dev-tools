import { describe, expect, test } from 'bun:test';

import {
  colorDistance,
  contrastRatio,
  normalizeColor,
  parseColor,
  rotateHue,
  shiftLightness,
} from '../colorMath';
import { COLOR_ROLES, THEMES } from '../palettes';
import { CUSTOM_THEME_ID, cloneTheme, customThemeFrom, parseCustomTheme, withCustomTheme } from '.';

describe('colour values', () => {
  test('hex is normalised to lower-case #rrggbb, names are kept as names', () => {
    expect(normalizeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeColor('7AA2F7')).toBe('#7aa2f7');
    expect(normalizeColor('cyan')).toBe('cyan');
    expect(normalizeColor('#12345')).toBeUndefined();
    expect(normalizeColor('teal')).toBeUndefined();
  });

  test('a name reads as its xterm default', () => {
    expect(parseColor('white')).toEqual([229, 229, 229]);
    expect(parseColor('#ff0080')).toEqual([255, 0, 128]);
  });

  test('nudges come back as hex and move the way they say', () => {
    const lighter = shiftLightness('#565f89', 0.1) as string;
    expect(lighter).toMatch(/^#[0-9a-f]{6}$/);
    expect((parseColor(lighter) as number[])[2]).toBeGreaterThan(0x89);
    expect(rotateHue('#ff0000', 120)).toBe('#00ff00');
    expect(rotateHue('#808080', 90)).toBe('#808080');
  });

  test('contrast is WCAG: black on white is 21, a colour on itself is 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7aa2f7', '#7aa2f7')).toBeCloseTo(1, 5);
  });
});

describe('stock palettes', () => {
  test('every role of every theme is a colour Ink can draw', () => {
    for (const theme of THEMES) {
      for (const { role } of COLOR_ROLES) expect(normalizeColor(theme.colors[role])).toBeDefined();
    }
  });

  //? The point of offering ten: each has to be recognisably its own at a glance
  test('no two themes share an accent and a background that look alike', () => {
    for (const a of THEMES) {
      for (const b of THEMES) {
        if (a.id >= b.id) continue;
        const apart =
          colorDistance(a.colors.accent, b.colors.accent) +
          colorDistance(a.colors.surface, b.colors.surface);
        expect({ pair: `${a.id}/${b.id}`, far: apart > 120 }).toEqual({
          pair: `${a.id}/${b.id}`,
          far: true,
        });
      }
    }
  });

  test('every theme keeps body text readable on its own background', () => {
    for (const theme of THEMES) {
      const ratio = contrastRatio(theme.colors.text, theme.colors.surface) as number;
      expect({ id: theme.id, readable: ratio >= 4.5 }).toEqual({ id: theme.id, readable: true });
    }
  });
});

describe('custom theme', () => {
  const midnight = THEMES.find((theme) => theme.id === 'midnight')!;

  test('a clone is a copy, not a reference', () => {
    const draft = cloneTheme(midnight);
    draft.colors.accent = '#000000';
    expect(midnight.colors.accent).toBe('#7aa2f7');
    expect(draft.basedOn).toBe('midnight');
  });

  test('a stored file with a bad value loses that colour only, back to its base', () => {
    const draft = parseCustomTheme({
      custom: { basedOn: 'midnight', colors: { accent: '#F00', text: 'not a colour' }, opaque: true },
    });
    expect(draft?.colors.accent).toBe('#ff0000');
    expect(draft?.colors.text).toBe(midnight.colors.text);
    expect(draft?.colors.surface).toBe(midnight.colors.surface);
    expect(draft?.opaque).toBe(true);
  });

  test('nothing usable is no custom theme', () => {
    expect(parseCustomTheme({})).toBeUndefined();
    expect(parseCustomTheme('nope')).toBeUndefined();
  });

  test('it becomes the switcher entry "custom", named after its base', () => {
    const theme = customThemeFrom(cloneTheme(midnight));
    expect(theme.id).toBe(CUSTOM_THEME_ID);
    expect(theme.blurb).toContain('Midnight');
  });

  test('adding it to a list never adds it twice', () => {
    const once = withCustomTheme(THEMES);
    expect(withCustomTheme(once).filter((theme) => theme.id === CUSTOM_THEME_ID).length).toBe(
      once.filter((theme) => theme.id === CUSTOM_THEME_ID).length,
    );
  });
});

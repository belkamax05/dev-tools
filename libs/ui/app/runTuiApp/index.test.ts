import { expect, test } from 'bun:test';

import type { InkRender } from '../../../types/InkRender';
import runTuiApp from '.';

for (const enhancedKeyboard of [true, false]) {
  test(`terminal modifier reporting is ${enhancedKeyboard ? 'enabled when requested' : 'unchanged by default'}`, async () => {
    let rendered = false;
    const render: InkRender = (_node, options) => {
      rendered = true;
      expect(options?.kittyKeyboard).toEqual(
        enhancedKeyboard ? { mode: 'enabled', flags: ['disambiguateEscapeCodes'] } : undefined,
      );
      return {
        rerender: () => {},
        unmount: () => {},
        cleanup: () => {},
        clear: () => {},
        waitUntilExit: async () => {},
      };
    };
    await runTuiApp(null, { render, keepProcessAlive: true, enhancedKeyboard });
    expect(rendered).toBe(true);
  });
}

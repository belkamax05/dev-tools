const PACKAGES = ['playwright', 'playwright-core'];

/**
 * The project's own Playwright, resolved from `dir` (the current directory by default), or
 * undefined. dev-tools never depends on it. A resolution outside a `node_modules` folder is
 * Bun's auto-install reaching for its global cache, which is not the project's copy, so it is
 * refused rather than letting a lookup install anything.
 */
export const findPlaywright = (
  dir = process.cwd(),
  resolve: (name: string, from: string) => string = Bun.resolveSync,
) => {
  for (const name of PACKAGES) {
    try {
      const path = resolve(name, dir);
      if (path.includes('/node_modules/')) return path;
    } catch {}
  }
  return undefined;
};

export default findPlaywright;

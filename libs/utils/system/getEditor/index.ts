/** Select the enclosing IDE's editor, then $EDITOR, then vi. */
export const getEditor = (env: Record<string, string | undefined> = process.env): string => {
  // Both IDEs advertise TERM_PROGRAM=vscode. Their injected Git helper paths
  // identify the actual IDE, including Nix installs and macOS app bundles.
  const paths = [env.VSCODE_GIT_ASKPASS_NODE, env.VSCODE_GIT_ASKPASS_MAIN, env.GIT_ASKPASS];
  if (paths.some((path) => /(?:^|[\\/])antigravity(?:-ide|\.app)?(?:[\\/]|$)/i.test(path ?? ''))) {
    return 'antigravity';
  }
  if (paths.some((path) => /(?:^|[\\/])devin(?:-desktop|\.app)?(?:[\\/]|$)/i.test(path ?? ''))) {
    return 'devin';
  }
  return env.EDITOR || 'vi';
};

export default getEditor;

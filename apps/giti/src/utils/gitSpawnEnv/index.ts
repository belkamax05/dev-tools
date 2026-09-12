//? Git env vars that override repository discovery. When inherited — inside a git hook
//? (husky), a rebase, or a shell spawned by another repo's tooling — they make `git` ignore
//? the `cwd` we pass and operate on whatever repository the parent process was working on.
const repoScopedGitEnvVars = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_NAMESPACE',
  'GIT_PREFIX',
] as const;

/**
 * Environment for a git child process, with inherited repository overrides removed so the
 * command always applies to the directory we pass as `cwd`.
 * @returns A copy of `process.env` without repo-scoped git vars
 */
const gitSpawnEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of repoScopedGitEnvVars) delete env[key];
  return env;
};

export default gitSpawnEnv;

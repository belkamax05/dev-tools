let _cwd: string | undefined;

/** Called once by run.ts with the shell's $(pwd) before any commands run. */
export const setWorkingDir = (dir: string) => {
  _cwd = dir;
};

export const isWorkingDirInjected = () => _cwd !== undefined;

/**
 * Returns the working directory the user invoked `shu` from.
 * The shell alias passes $(pwd) as the first arg; run.ts captures it via setWorkingDir.
 */
const getWorkingDir = (): string => _cwd ?? process.cwd();

export default getWorkingDir;

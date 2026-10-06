export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  /** `docker ps`'s human status — `Up 3 hours`, `Exited (0) 2 days ago`. */
  status: string;
}

export interface DockerResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs `docker <args>`; injectable so the logic can be tested without a daemon. */
export type DockerRunner = (args: string[], options: { sudo: boolean }) => Promise<DockerResult>;

const FIELD = '\t';

/** Rows of `docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'`. */
export const parseContainers = (stdout: string): DockerContainer[] =>
  stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [id = '', name = '', image = '', status = ''] = line.split(FIELD);
      return { id, name, image, status };
    });

//? Only a refusal to reach the daemon socket is worth a retry through sudo — any other failure
//? would fail the same way as root
export const needsSudo = (stderr: string) => /permission denied/i.test(stderr);

export const runDocker: DockerRunner = async (args, { sudo }) => {
  const proc = Bun.spawn(sudo ? ['sudo', 'docker', ...args] : ['docker', ...args], {
    //? sudo asks for its password on the terminal, so stdin must stay the user's
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
};

/**
 * Docker, falling back to `sudo docker` once when the daemon refuses this user — the usual
 * state on Linux for anyone outside the `docker` group. The answer is remembered, so a run
 * prompts for a password at most once.
 */
export const createDocker = (runner: DockerRunner = runDocker) => {
  let sudo = false;
  return async (args: string[]) => {
    const result = await runner(args, { sudo });
    if (result.exitCode === 0 || sudo || !needsSudo(result.stderr)) return result;
    sudo = true;
    return runner(args, { sudo });
  };
};

/**
 * Containers that publish `port` on the host, stopped ones included: a stopped container keeps
 * its port mapping and takes the port back the moment it is started again.
 *
 * @throws Error with docker's own message when docker is missing or the daemon is down.
 */
export const findPortContainers = async (
  port: number,
  docker = createDocker(),
): Promise<DockerContainer[]> => {
  const result = await docker([
    'ps',
    '-a',
    '--filter',
    `publish=${port}`,
    '--format',
    ['{{.ID}}', '{{.Names}}', '{{.Image}}', '{{.Status}}'].join(FIELD),
  ]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'docker ps failed');
  return parseContainers(result.stdout);
};

/** Force-remove containers (`docker rm -f`), the only way to free a port a container publishes. */
export const removeContainers = async (ids: string[], docker = createDocker()) => {
  const result = await docker(['rm', '-f', ...ids]);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'docker rm failed');
};

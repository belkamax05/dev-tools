import { describe, expect, test } from 'bun:test';

import { createDocker, type DockerRunner, findPortContainers, parseContainers } from './index';

describe('docker', () => {
  test('reads the containers out of docker ps output', () => {
    expect(
      parseContainers('abc\tweb\tnginx:1\tUp 3 hours\n\ndef\tdb\tpostgres\tExited (0)\n'),
    ).toEqual([
      { id: 'abc', name: 'web', image: 'nginx:1', status: 'Up 3 hours' },
      { id: 'def', name: 'db', image: 'postgres', status: 'Exited (0)' },
    ]);
  });

  test('asks docker for the containers publishing the port, stopped ones included', async () => {
    const calls: string[][] = [];
    const runner: DockerRunner = async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: 'abc\tweb\tnginx\tUp\n', stderr: '' };
    };

    const found = await findPortContainers(8080, createDocker(runner));

    expect(found.map((container) => container.id)).toEqual(['abc']);
    expect(calls[0]).toContain('-a');
    expect(calls[0]).toContain('publish=8080');
  });

  test('retries once through sudo when the daemon refuses this user, then stays there', async () => {
    const modes: boolean[] = [];
    const runner: DockerRunner = async (_args, { sudo }) => {
      modes.push(sudo);
      return sudo
        ? { exitCode: 0, stdout: '', stderr: '' }
        : { exitCode: 1, stdout: '', stderr: 'permission denied while trying to connect' };
    };
    const docker = createDocker(runner);

    await docker(['ps']);
    await docker(['rm', '-f', 'abc']);

    expect(modes).toEqual([false, true, true]);
  });

  test('does not reach for sudo when docker fails for another reason', async () => {
    const modes: boolean[] = [];
    const runner: DockerRunner = async (_args, { sudo }) => {
      modes.push(sudo);
      return { exitCode: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' };
    };

    await expect(findPortContainers(80, createDocker(runner))).rejects.toThrow('Cannot connect');
    expect(modes).toEqual([false]);
  });
});

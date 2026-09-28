import { describe, expect, test } from 'bun:test';

import stopProcess, { isAlive } from './index';

describe('stopProcess', () => {
  test('stops a process that honours SIGTERM', async () => {
    const child = Bun.spawn(['sleep', '30']);
    expect(isAlive(child.pid)).toBe(true);
    const result = await stopProcess(child.pid, { graceMs: 1000 });
    expect(result).toMatchObject({ ok: true, signal: 'SIGTERM' });
    await child.exited;
    expect(isAlive(child.pid)).toBe(false);
  });

  test('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const child = Bun.spawn(['sh', '-c', 'trap "" TERM; sleep 30']);
    await Bun.sleep(100);
    const result = await stopProcess(child.pid, { graceMs: 300 });
    expect(result).toMatchObject({ ok: true, signal: 'SIGKILL' });
  });

  test('refuses to signal itself or init', async () => {
    expect((await stopProcess(process.pid)).ok).toBe(false);
    expect((await stopProcess(1)).ok).toBe(false);
  });
});

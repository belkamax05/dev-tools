import { describe, expect, test } from 'bun:test';

import { descendantsOf, type ProcessInfo, parseElapsed, parsePs, processName } from './index';

describe('parsePs', () => {
  test('keeps the command line whole, spaces and all', () => {
    const [proc] = parsePs(
      '  1234     1  1000 maksym    12.5  0.3 120400    01:02:03 Sl   node server.js --port 3000',
    );
    expect(proc).toMatchObject({
      pid: 1234,
      ppid: 1,
      uid: 1000,
      user: 'maksym',
      cpu: 12.5,
      mem: 0.3,
      rss: 120400,
      elapsed: '01:02:03',
      elapsedSeconds: 3723,
      state: 'Sl',
      command: 'node server.js --port 3000',
      name: 'node',
    });
  });

  test('reads a decimal comma and skips lines that are not processes', () => {
    const list = parsePs('garbage\n  7 1 0 root 1,5 0,1 10 1-00:00:00 S /sbin/init\n');
    expect(list).toHaveLength(1);
    expect(list[0]?.cpu).toBe(1.5);
    expect(list[0]?.elapsedSeconds).toBe(86400);
  });
});

describe('processName', () => {
  test('is the base name of the first word, and leaves kernel threads alone', () => {
    expect(processName('/usr/bin/node a.js')).toBe('node');
    expect(processName('[kworker/0:1]')).toBe('[kworker/0:1]');
  });
});

describe('parseElapsed', () => {
  test('reads every etime shape', () => {
    expect(parseElapsed('05')).toBe(5);
    expect(parseElapsed('02:05')).toBe(125);
    expect(parseElapsed('1:02:05')).toBe(3725);
    expect(parseElapsed('2-1:02:05')).toBe(2 * 86400 + 3725);
  });
});

describe('descendantsOf', () => {
  const proc = (pid: number, ppid: number) => ({ pid, ppid }) as ProcessInfo;

  test('lists children before their parents, the parent last', () => {
    const table = [proc(10, 1), proc(11, 10), proc(12, 11), proc(13, 10), proc(20, 1)];
    const order = descendantsOf(10, table);
    expect(order.at(-1)).toBe(10);
    expect(order.indexOf(12)).toBeLessThan(order.indexOf(11));
    expect(order.sort()).toEqual([10, 11, 12, 13]);
  });

  test('survives a cycle in a stale table', () => {
    expect(descendantsOf(5, [proc(5, 6), proc(6, 5)]).sort()).toEqual([5, 6]);
  });
});

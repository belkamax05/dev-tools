import { describe, expect, test } from 'bun:test';

import { parseLsof, parseSs } from './index';

describe('parseSs', () => {
  test('reads every owner of a socket, and IPv6 and scoped addresses', () => {
    const listeners = parseSs(
      [
        'LISTEN 0      511                *:3000             *:*    users:(("node",pid=1234,fd=20),("node",pid=1240,fd=20))',
        'LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*',
        'LISTEN 0      128             [::1]:8080          [::]:*    users:(("bun",pid=77,fd=3))',
      ].join('\n'),
    );
    expect(listeners).toEqual([
      { port: 3000, address: '*', pid: 1234, command: 'node' },
      { port: 3000, address: '*', pid: 1240, command: 'node' },
      { port: 53, address: '127.0.0.53' },
      { port: 8080, address: '::1', pid: 77, command: 'bun' },
    ]);
  });
});

describe('parseLsof', () => {
  test('reads field output, one process then its sockets', () => {
    const listeners = parseLsof(
      [
        'p501',
        'cnode',
        'f20',
        'n*:4200',
        'f21',
        'n[::1]:4200',
        'p9',
        'cpython3',
        'n127.0.0.1:8000',
      ].join('\n'),
    );
    expect(listeners).toEqual([
      { port: 4200, address: '*', pid: 501, command: 'node' },
      { port: 4200, address: '::1', pid: 501, command: 'node' },
      { port: 8000, address: '127.0.0.1', pid: 9, command: 'python3' },
    ]);
  });
});

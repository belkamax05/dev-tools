import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { emitFrame } from '@/dev-tools/ui/terminal/frames';
import makeRepo from '../../../../core/testRepo';
import type { UndoOffer } from '../../types';
import RefsView from '.';

let last = () => '';
const until = async (ready: () => boolean, what: string) => {
  const deadline = Date.now() + 5000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}:\n${last()}`);
    await Bun.sleep(20);
  }
};

test('a filtered custom ref shows its info, raw object, reflog and preview, and deletes on both sides', async () => {
  const repo = makeRepo({ remote: true });
  repo.write('a.txt', 'custom-change\n');
  repo.sh(['add', 'a.txt']);
  const tree = repo.sh(['write-tree']).trim();
  const commit = repo.sh(['commit-tree', tree, '-p', 'HEAD', '-m', 'custom-marker']).trim();
  repo.sh(['update-ref', '--create-reflog', '-m', 'made-by-test', 'refs/custom/probe', commit]);
  repo.sh(['push', '-q', 'origin', 'refs/custom/probe']);
  const onRemote = () => repo.sh(['ls-remote', 'origin', 'refs/custom/probe']).trim();
  const stdout = Object.assign(new PassThrough(), { columns: 140, rows: 40, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let output = '';
  let undo: UndoOffer | undefined;
  const refreshKey = 0;
  last = () => output;
  stdout.on('data', (chunk) => {
    output = Bun.stripANSI(chunk.toString());
  });
  const app = render(
    <Box height={36} width={136} flexDirection="column">
      <RefsView
        root={repo.root}
        refreshKey={refreshKey}
        reload={() => {}}
        notify={() => {}}
        onCaptureInput={() => {}}
        offerUndo={(offer) => {
          undo = offer;
        }}
        reservedChrome={[]}
      />
    </Box>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      patchConsole: false,
      onRender: emitFrame,
    },
  );
  try {
    await until(() => output.includes('ROOT REFS') && output.includes('symbolic →'), 'HEAD info');
    stdin.write('/');
    await Bun.sleep(50);
    stdin.write('custom/probe');
    await until(() => output.includes('Refs (1)'), 'the filter');
    stdin.write('\r');
    await until(() => output.includes('custom-marker'), 'the ref info');
    expect(output).toContain('REFS/CUSTOM/* (1)');
    stdin.write('2');
    await until(() => /tree [0-9a-f]{40}/.test(output), 'the raw object');
    stdin.write('3');
    await until(() => output.includes('made-by-test'), 'the reflog');
    stdin.write('4');
    await until(() => output.includes('+custom-change'), 'the preview');
    stdin.write('x');
    await until(() => output.includes('[x] origin: refs/custom/probe'), 'the remote counterpart');
    expect(output).toContain('Local + remote (1)');
    expect(last()).toMatch(/Delete refs\/custom\/probe[\s\S]*\[x\] origin: refs\/custom\/probe/);
    stdin.write('D');
    await until(() => Boolean(undo), 'the undo offer');
    expect(repo.sh(['for-each-ref', 'refs/custom']).trim()).toBe('');
    expect(onRemote()).toBe('');
    expect((await undo!.run()).ok).toBe(true);
    expect(repo.sh(['rev-parse', 'refs/custom/probe']).trim()).toBe(commit);
    expect(onRemote()).toContain(commit);
  } finally {
    app.unmount();
    app.cleanup();
    repo.cleanup();
  }
});

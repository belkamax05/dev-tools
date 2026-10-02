import { appendFileSync, writeFileSync } from 'node:fs';

import { graphicsSupport } from '../../../terminal-canvas/index.ts';

/**
 * Record everything an app writes to the terminal, so a rendering bug seen in one terminal can be
 * replayed byte for byte in another — xterm.js in a browser, say — and looked at there.
 *
 * Off unless `DEV_TOOLS_RECORD` names a file. It is JSON Lines: a header with the terminal's size
 * and environment and what the graphics probe found, then one `[ms, data]` per write (data as
 * latin1, so the bytes come back exactly) and one `[ms, { resize }]` per resize.
 *
 * Returns the function that stops recording and puts `stdout.write` back.
 */
export const startRecording = (stdout: NodeJS.WriteStream = process.stdout) => {
  const file = process.env.DEV_TOOLS_RECORD;
  if (!file) return () => {};

  const start = Date.now();
  const line = (value: unknown) => appendFileSync(file, `${JSON.stringify(value)}\n`);
  const support = graphicsSupport();
  writeFileSync(
    file,
    `${JSON.stringify({
      cols: stdout.columns,
      rows: stdout.rows,
      env: {
        TERM: process.env.TERM,
        TERM_PROGRAM: process.env.TERM_PROGRAM,
        TERM_PROGRAM_VERSION: process.env.TERM_PROGRAM_VERSION,
        COLORTERM: process.env.COLORTERM,
      },
      graphics: support,
    })}\n`,
  );

  const write = stdout.write;
  stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const data =
      typeof chunk === 'string' ? Buffer.from(chunk).toString('latin1') : Buffer.from(chunk as Uint8Array).toString('latin1');
    line([Date.now() - start, data]);
    return (write as (...args: unknown[]) => boolean).call(stdout, chunk, ...rest);
  }) as typeof stdout.write;

  const onResize = () => line([Date.now() - start, { resize: { cols: stdout.columns, rows: stdout.rows } }]);
  stdout.on('resize', onResize);

  return () => {
    stdout.write = write;
    stdout.off('resize', onResize);
  };
};

export default startRecording;

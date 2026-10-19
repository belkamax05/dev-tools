import formatColor from '@/dev-tools/utils/format/formatColor';

//? git push's per-ref lines: `   ecf1c64..f02ccd1  main -> main`, ` + a1...b2 main -> main (forced
//? update)`, ` * [new branch]      feat -> feat`, ` * [new tag]  v1 -> v1`. The flag column is one
//? of ` +-*=!` and git pads it, so the pattern allows any spacing around it.
const REF_LINE = /^\s*[+*=!-]?\s*(\[new [a-z ]+\]|[0-9a-f]+\.{2,3}[0-9a-f]+|\[deleted\])\s+(\S+) -> (\S+)(.*)$/;

/**
 * What a push moved, as lines to print under its result: `ecf1c64..f02ccd1  main → main`, one per
 * ref git reported. Read from git's own output, since a push — unlike a pull — leaves nothing
 * local to compare: the remote moved, not this checkout.
 *
 * @param output - Everything the push printed, stdout and stderr together
 * @returns One line per updated ref, in git's order; empty when git listed none
 */
const describePush = (output: string): string[] =>
  output
    .split('\n')
    .map((line) => REF_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, range = '', from = '', to = '', tail = '']) =>
      formatColor(`  ${range}  ${from} → ${to}${tail.trim() ? ` ${tail.trim()}` : ''}`, 'info'),
    );

export default describePush;

import { describe, expect, test } from 'bun:test';
import splitVendoredArgs, {
  forwardVendoredFlags,
  hasOwn,
  ownValue,
  setsIntegration,
  setsSubmoduleMode,
} from '.';

const OWN = ['--no-self', '--no-fetch', '--remote=', '--branch='];

describe('splitVendoredArgs', () => {
  test('keeps the flags giti acts on out of what git is handed', () => {
    const args = splitVendoredArgs(['libs/giti', '--no-self', '--no-verify'], OWN);

    expect(args.dirs).toEqual(['libs/giti']);
    expect(args.own).toEqual(['--no-self']);
    expect(args.passthrough).toEqual(['--no-verify']);
  });

  test('forwards a flag it has never heard of rather than rejecting the command', () => {
    const { passthrough } = splitVendoredArgs(['--force-with-lease', '-q'], OWN);

    expect(passthrough).toEqual(['--force-with-lease', '-q']);
  });

  test('swallows a separated own value instead of mistaking it for a directory', () => {
    const args = splitVendoredArgs(['--remote', 'origin', 'libs/giti'], OWN);

    expect(args.own).toEqual(['--remote', 'origin']);
    expect(args.dirs).toEqual(['libs/giti']);
  });

  test('stops parsing at -- so a git flag can be written in its separated form', () => {
    const args = splitVendoredArgs(['libs/giti', '--', '--push-option', 'ci.skip'], OWN);

    expect(args.dirs).toEqual(['libs/giti']);
    expect(args.passthrough).toEqual(['--push-option', 'ci.skip']);
  });

  test('treats every flag as passthrough when giti claims none of them', () => {
    const { own, passthrough } = splitVendoredArgs(['--no-self', '--stat']);

    expect(own).toEqual([]);
    expect(passthrough).toEqual(['--no-self', '--stat']);
  });

  test('extracts commit message flags and keeps other flags as passthrough', () => {
    const commitOwn = ['--no-self', '-m=', '--message=', '-F=', '--file='];
    const args = splitVendoredArgs(['-m', 'feat: update', '--no-verify', 'libs/giti'], commitOwn);

    expect(args.dirs).toEqual(['libs/giti']);
    expect(args.own).toEqual(['-m', 'feat: update']);
    expect(args.passthrough).toEqual(['--no-verify']);
  });
});

describe('ownValue', () => {
  test('reads a value written either joined or separated', () => {
    expect(ownValue(splitVendoredArgs(['--remote=origin'], OWN), 'remote')).toBe('origin');
    expect(ownValue(splitVendoredArgs(['--remote', 'origin'], OWN), 'remote')).toBe('origin');
  });

  test('answers with an empty string when the flag was never given', () => {
    expect(ownValue(splitVendoredArgs(['--no-self'], OWN), 'remote')).toBe('');
  });

  test('does not confuse one flag for another that starts the same way', () => {
    expect(ownValue(splitVendoredArgs(['--branch=main'], OWN), 'remote')).toBe('');
  });
});

describe('hasOwn', () => {
  test('reports a flag only when giti was the one to claim it', () => {
    expect(hasOwn(splitVendoredArgs(['--dry-run'], ['--dry-run', '-n']), '--dry-run', '-n')).toBe(
      true,
    );
    expect(hasOwn(splitVendoredArgs(['--dry-run'], []), '--dry-run')).toBe(false);
  });
});

describe('forwardVendoredFlags', () => {
  test('hands a plain git command line everything the user typed', () => {
    const { flags, config, dropped } = forwardVendoredFlags(['--no-verify', '-u'], 'git');

    expect(flags).toEqual(['--no-verify', '-u']);
    expect(config).toEqual([]);
    expect(dropped).toEqual([]);
  });

  test('forwards to git subtree only what its own option list accepts', () => {
    const { flags, dropped } = forwardVendoredFlags(['--squash', '--force-with-lease'], 'subtree');

    expect(flags).toEqual(['--squash']);
    expect(dropped).toEqual(['--force-with-lease']);
  });

  test('delivers --no-verify as configuration to a mechanism that has no such option', () => {
    const { flags, config, dropped } = forwardVendoredFlags(['--no-verify'], 'subtree');

    expect(flags).toEqual([]);
    expect(config).toEqual(['-c', 'core.hooksPath=/dev/null']);
    expect(dropped).toEqual([]);
  });

  test('sets an equivalent once however many times it was asked for', () => {
    const { config } = forwardVendoredFlags(['--no-verify', '--no-verify'], 'subrepo');

    expect(config).toEqual(['-c', 'core.hooksPath=/dev/null']);
  });

  test('matches a value-taking flag on its name, not on the value attached to it', () => {
    const { flags, dropped } = forwardVendoredFlags(['--branch=main', '--depth=1'], 'subrepo');

    expect(flags).toEqual(['--branch=main']);
    expect(dropped).toEqual(['--depth=1']);
  });
});

describe('setsIntegration', () => {
  test('spots the flags that say how a pull should integrate', () => {
    expect(setsIntegration(['--rebase'])).toBe(true);
    expect(setsIntegration(['--strategy=ours'])).toBe(true);
    expect(setsIntegration(['--no-verify'])).toBe(false);
  });
});

describe('setsSubmoduleMode', () => {
  test('spots the modes git submodule update refuses to be given twice', () => {
    expect(setsSubmoduleMode(['--rebase'])).toBe(true);
    expect(setsSubmoduleMode(['--checkout'])).toBe(true);
    expect(setsSubmoduleMode(['--force'])).toBe(false);
  });
});

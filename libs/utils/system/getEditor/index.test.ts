import { expect, test } from 'bun:test';

import getEditor from '.';

test('recognizes the IDE helper paths captured from both integrated terminals', () => {
  for (const key of ['VSCODE_GIT_ASKPASS_NODE', 'VSCODE_GIT_ASKPASS_MAIN', 'GIT_ASKPASS']) {
    expect(
      getEditor({
        TERM_PROGRAM: 'vscode',
        EDITOR: 'nano',
        [key]:
          '/nix/store/package/lib/antigravity-ide/resources/app/extensions/git/dist/askpass.sh',
      }),
    ).toBe('antigravity');
    expect(
      getEditor({
        TERM_PROGRAM: 'vscode',
        EDITOR: 'nano',
        [key]: '/nix/store/package/lib/devin-desktop/resources/app/extensions/git/dist/askpass.sh',
      }),
    ).toBe('devin');
  }
});

test('matches app bundle paths and Windows separators', () => {
  expect(getEditor({ GIT_ASKPASS: '/Applications/Antigravity.app/Contents/helper' })).toBe(
    'antigravity',
  );
  expect(getEditor({ VSCODE_GIT_ASKPASS_NODE: 'C:\\Program Files\\Devin\\Devin.exe' })).toBe(
    'devin',
  );
});

test('prefers Antigravity when both IDE markers are present', () => {
  expect(
    getEditor({
      GIT_ASKPASS: '/opt/devin/helper',
      VSCODE_GIT_ASKPASS_NODE: '/opt/antigravity/ide',
    }),
  ).toBe('antigravity');
});

test('falls back to EDITOR without treating generic vscode or PATH as IDE identity', () => {
  expect(
    getEditor({
      TERM_PROGRAM: 'vscode',
      PATH: '/opt/antigravity/bin:/opt/devin/bin',
      GIT_ASKPASS: '/opt/code/resources/app/extensions/git/dist/askpass.sh',
      VISUAL: 'emacs',
      EDITOR: 'code --wait',
    }),
  ).toBe('code --wait');
  expect(getEditor({ GIT_ASKPASS: '/opt/not-antigravity/helper', EDITOR: 'nano' })).toBe('nano');
});

test('retains vi as the default when EDITOR is unset or empty', () => {
  expect(getEditor({})).toBe('vi');
  expect(getEditor({ EDITOR: '', VISUAL: 'emacs' })).toBe('vi');
});

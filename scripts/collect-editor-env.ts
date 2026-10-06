import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const label = process.argv[2];
if (!label || !['antigravity', 'devin', 'baseline'].includes(label)) {
  console.error('Usage: bun scripts/collect-editor-env.ts <antigravity|devin|baseline>');
  process.exit(1);
}

// Only expose identity, terminal and executable-path values. Other variable
// names are useful for discovering IDE markers, but their values may be secrets.
const visibleKeys = new Set([
  'EDITOR',
  'VISUAL',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'COLORTERM',
  'SHELL',
  'PATH',
  'VSCODE_CWD',
  'VSCODE_IPC_HOOK',
  'VSCODE_IPC_HOOK_CLI',
  'VSCODE_PID',
  'VSCODE_INJECTION',
  'VSCODE_GIT_ASKPASS_NODE',
  'VSCODE_GIT_ASKPASS_MAIN',
  'VSCODE_GIT_IPC_HANDLE',
  'GIT_ASKPASS',
  'ELECTRON_RUN_AS_NODE',
  'XDG_CURRENT_DESKTOP',
  'DESKTOP_SESSION',
  'GIO_LAUNCHED_DESKTOP_FILE',
  'GIO_LAUNCHED_DESKTOP_FILE_PID',
]);

const environment = Object.fromEntries(
  Object.keys(process.env)
    .sort()
    .map((key) => [key, visibleKeys.has(key) ? process.env[key] : '<redacted>']),
);
const commands = [
  'antigravity',
  'agy',
  'antigravity-ide',
  'devin-desktop',
  'devin',
  'Devin',
  'code',
];
const report = {
  label,
  capturedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  environment,
  commands: Object.fromEntries(commands.map((command) => [command, Bun.which(command)])),
};

// Keep reports inside this subrepo and out of version control, regardless of cwd.
const directory = join(import.meta.dir, '..', '.cache', 'editor-env');
await mkdir(directory, { recursive: true });
const output = join(directory, `${label}.json`);
await Bun.write(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Saved editor environment report: ${output}`);

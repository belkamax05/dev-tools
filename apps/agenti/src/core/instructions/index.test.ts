import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getIde, type IdeDefinition } from '../ides';
import { projectScope, userScope } from '../scope';
import { adoptInstructions, getInstructions, linkInstructions, unlinkInstructions } from '.';

const claude = getIde('claude-code') as IdeDefinition;
const vscode = getIde('vscode') as IdeDefinition;
const cursor = getIde('cursor') as IdeDefinition;
let root: string;
const scope = () => projectScope(root);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agenti-instr-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('instructions', () => {
  test('an IDE that reads AGENTS.md itself needs nothing', () => {
    expect(getInstructions(scope(), cursor).status).toBe('native');
  });

  test('creates an import file for Claude and a link for Copilot', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Agents');
    expect(getInstructions(scope(), claude).status).toBe('missing');
    expect(linkInstructions(getInstructions(scope(), claude)).ok).toBe(true);
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf-8')).toBe('@AGENTS.md\n');
    expect(linkInstructions(getInstructions(scope(), vscode)).ok).toBe(true);
    expect(lstatSync(join(root, '.github/copilot-instructions.md')).isSymbolicLink()).toBe(true);
    expect(getInstructions(scope(), vscode).status).toBe('synced');
  });

  test('adds the import on top of an existing CLAUDE.md, keeping what it says', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Agents');
    writeFileSync(join(root, 'CLAUDE.md'), 'Claude-only notes');
    expect(getInstructions(scope(), claude).status).toBe('mismatch');
    linkInstructions(getInstructions(scope(), claude));
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf-8')).toBe('@AGENTS.md\n\nClaude-only notes');
    expect(getInstructions(scope(), claude).status).toBe('synced');
    //? Not removable: it has content of its own besides the import
    expect(unlinkInstructions(getInstructions(scope(), claude)).ok).toBe(false);
  });

  test('refuses to replace Copilot content with a link unless forced', () => {
    writeFileSync(join(root, 'AGENTS.md'), '# Agents');
    mkdirSync(join(root, '.github'));
    writeFileSync(join(root, '.github/copilot-instructions.md'), 'mine');
    expect(linkInstructions(getInstructions(scope(), vscode)).ok).toBe(false);
    expect(linkInstructions(getInstructions(scope(), vscode), { force: true }).ok).toBe(true);
  });

  test('adopts CLAUDE.md as AGENTS.md when there is none', () => {
    writeFileSync(join(root, 'CLAUDE.md'), 'Project rules');
    const state = getInstructions(scope(), claude);
    expect(state.status).toBe('no-source');
    expect(adoptInstructions(state).ok).toBe(true);
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toBe('Project rules');
    expect(readFileSync(join(root, 'CLAUDE.md'), 'utf-8')).toBe('@AGENTS.md\n');
  });

  test('user scope imports ~/.agents/AGENTS.md from ~/.claude/CLAUDE.md, relatively', () => {
    const home = userScope(root);
    mkdirSync(join(root, '.agents'));
    writeFileSync(home.instructionsPath, '# Mine');
    linkInstructions(getInstructions(home, claude));
    expect(readFileSync(join(root, '.claude/CLAUDE.md'), 'utf-8')).toBe('@../.agents/AGENTS.md\n');
  });
});

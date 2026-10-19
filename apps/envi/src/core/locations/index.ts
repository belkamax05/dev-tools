import { join } from 'node:path';

import {
  type EnviConfig,
  type SetTarget,
  saveState,
  stateStore,
  withoutVar,
  withVar,
} from '../../config/settings';
import { readEnvFile, removeFromEnvFile, setInEnvFile, setLineInEnvFile } from '../envFile';
import type { DotenvEntry } from '../parse';
import type { Layer, Resolution } from '../resolve';

/**
 * A place envi's values are kept that envi can write to: your vars (the config), machine vars
 * (the state file) or one env file. An `env.config.ts` is code, so it is never one — it is opened.
 */
export type Location =
  | { kind: 'config' }
  | { kind: 'state' }
  | { kind: 'file'; path: string; label: string };

/** A value as written where it is kept: the text and, in an env file, the quotes around it. */
export interface RawValue {
  text: string;
  quote: DotenvEntry['quote'];
}

/** The id of the layer a location becomes — what `VarSource.layerId` holds. */
export const locationId = (location: Location) =>
  location.kind === 'config' ? 'user' : location.kind === 'state' ? 'machine' : `file:${location.path}`;

export const locationLabel = (location: Location) =>
  location.kind === 'config' ? 'your vars' : location.kind === 'state' ? 'machine vars' : location.label;

export const sameLocation = (a: Location, b: Location) => locationId(a) === locationId(b);

/** The location a layer is read from, when envi can write there. */
export const locationOf = (layer: Pick<Layer, 'id' | 'kind' | 'path' | 'label'>): Location | undefined =>
  layer.id === 'user'
    ? { kind: 'config' }
    : layer.id === 'machine'
      ? { kind: 'state' }
      : layer.kind === 'file' && layer.path
        ? { kind: 'file', path: layer.path, label: layer.label }
        : undefined;

/**
 * Every location here, in the order envi applies them: your vars, machine vars, then each env file
 * (a missing one too — writing creates it). Your vars and machine vars are listed even while empty.
 */
export const locationsOf = (resolution: Resolution | undefined): Location[] => [
  { kind: 'config' },
  { kind: 'state' },
  ...(resolution?.layers ?? [])
    .map((layer) => (layer.kind === 'file' ? locationOf(layer) : undefined))
    .filter((location): location is Location => !!location),
];

//? Your vars and machine vars are read like an unquoted dotenv value without escapes: `$NAME`
//? expands, `\$` is a dollar, every other backslash is itself

/** A value from an env file, rewritten so your vars read it back the same. */
export const toSettingText = ({ text, quote }: RawValue): string => {
  if (quote === '') return text;
  if (quote === "'" || quote === '`') return text.replace(/\$/g, '\\$');
  return text.replace(/\\(.)/gs, (whole, next: string) =>
    next === '$' ? whole : next === 'n' ? '\n' : next === 'r' ? '\r' : next === 't' ? '\t' : next,
  );
};

/** A `KEY=…` line an env file reads back as `raw` — quotes and `$references` kept. */
export const toFileLine = (key: string, raw: RawValue): string => {
  if (raw.quote) return `${key}=${raw.quote}${raw.text}${raw.quote}`;
  const text = raw.text;
  const bare =
    !/[\n\r]/.test(text) && text === text.trim() && !/\s#/.test(text) && !/^["'`]/.test(text);
  if (bare) return `${key}=${text}`;
  const body = text
    .replace(/\\(?!\$)/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `${key}="${body}"`;
};

/** `key` as written at `location`, or undefined when it is not set there. */
export const readRaw = async (
  location: Location,
  key: string,
  config: EnviConfig,
): Promise<RawValue | undefined> => {
  if (location.kind === 'config') {
    const text = config.vars[key];
    return text === undefined ? undefined : { text, quote: '' };
  }
  if (location.kind === 'state') {
    const text = (await stateStore.load()).vars[key];
    return text === undefined ? undefined : { text, quote: '' };
  }
  const entry = (await readEnvFile(location.path)).entries.filter((item) => item.key === key).at(-1);
  return entry && { text: entry.raw, quote: entry.quote };
};

/**
 * What every write returns: the config to apply when the change was to your vars (the dashboard
 * applies and saves it, so it is never written behind its back), else undefined.
 */
export type WriteResult = EnviConfig | undefined;

/** Set `key` as written — its references and quotes kept — at `location`. */
export const setRawAt = async (
  location: Location,
  key: string,
  raw: RawValue,
  config: EnviConfig,
): Promise<WriteResult> => {
  if (location.kind === 'config') return { ...config, vars: withVar(config.vars, key, toSettingText(raw)) };
  if (location.kind === 'state') {
    const state = await stateStore.load();
    await saveState({ ...state, vars: withVar(state.vars, key, toSettingText(raw)) });
    return undefined;
  }
  await setLineInEnvFile(location.path, key, toFileLine(key, raw));
  return undefined;
};

/** Set `key` to exactly `value` — nothing in it expands (a value taken from the shell). */
export const setValueAt = async (
  location: Location,
  key: string,
  value: string,
  config: EnviConfig,
): Promise<WriteResult> => {
  if (location.kind !== 'file')
    return setRawAt(location, key, { text: value.replace(/\$/g, '\\$'), quote: '' }, config);
  await setInEnvFile(location.path, key, value);
  return undefined;
};

export const removeAt = async (
  location: Location,
  key: string,
  config: EnviConfig,
): Promise<WriteResult> => {
  if (location.kind === 'config') return { ...config, vars: withoutVar(config.vars, key) };
  if (location.kind === 'state') {
    const state = await stateStore.load();
    await saveState({ ...state, vars: withoutVar(state.vars, key) });
    return undefined;
  }
  await removeFromEnvFile(location.path, key);
  return undefined;
};

/**
 * Move (or, with `keep`, copy) `key` from one location to another, as written there — a
 * `${HOST}` reference stays a reference. The copy lands before the original goes, so a write that
 * fails loses nothing.
 */
export const transferVar = async (
  from: Location,
  to: Location,
  key: string,
  config: EnviConfig,
  { keep = false, as = key }: { keep?: boolean; as?: string } = {},
): Promise<WriteResult> => {
  if (sameLocation(from, to) && as === key) return undefined;
  const raw = await readRaw(from, key, config);
  if (!raw) throw new Error(`${key} is not set in ${locationLabel(from)}`);
  const written = await setRawAt(to, as, raw, config);
  if (keep) return written;
  return (await removeAt(from, key, written ?? config)) ?? written;
};

/** Rename `key` where it is kept — a move to the same place under a new name. */
export const renameAt = (location: Location, key: string, name: string, config: EnviConfig) =>
  transferVar(location, location, key, config, { as: name });

/** Where the setTarget setting writes, as a location — one of `known` when it is listed. */
export const setTargetLocation = (target: SetTarget, cwd: string, known: Location[]): Location => {
  if (target === 'config') return { kind: 'config' };
  if (target === 'state') return { kind: 'state' };
  const path = join(cwd, target);
  return (
    known.find((location) => location.kind === 'file' && location.path === path) ?? {
      kind: 'file',
      path,
      label: target,
    }
  );
};

/** `known`, with `extra` added at the end when it is not one of them. */
export const withLocation = (known: Location[], extra: Location): Location[] =>
  known.some((location) => sameLocation(location, extra)) ? known : [...known, extra];

/** A value typed in the dashboard, as your vars read it: `$OTHER` expands, `\$` is a dollar. */
export const setTextAt = (
  location: Location,
  key: string,
  text: string,
  config: EnviConfig,
  /** The quotes the value had in its env file, kept when the new text fits inside them. */
  quote: RawValue['quote'] = '',
): Promise<WriteResult> =>
  setRawAt(location, key, { text, quote: quote && !text.includes(quote) ? quote : '' }, config);

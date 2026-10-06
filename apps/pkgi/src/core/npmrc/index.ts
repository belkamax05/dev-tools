import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Credentials `.npmrc` scopes to one registry URL prefix (`//host/path/`). */
export interface RegistryAuth {
  /** `//host/path/`, protocol-less, with a trailing slash — what a tarball URL is matched against. */
  prefix: string;
  /** The `Authorization` header value. */
  header: string;
}

/** `${VAR}` in an `.npmrc` value → the environment's value, as npm and bun expand it. */
const expand = (value: string, env: Record<string, string | undefined>) =>
  value.replace(/\$\{([^}]+)\}/g, (_, name: string) => env[name] ?? '');

/**
 * The per-registry credentials in `.npmrc` text: `//host/path/:_authToken=…` (Bearer),
 * `:_auth=…` (Basic, already base64 `user:password`), or `:username=` with `:_password=` (Basic;
 * `_password` is base64 of the password). Unscoped auth and anything else is ignored.
 */
export const parseNpmrcAuth = (
  text: string,
  env: Record<string, string | undefined> = process.env,
): RegistryAuth[] => {
  const byPrefix = new Map<string, Record<string, string>>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const match = line.match(/^(\/\/[^=\s]+?):(_authToken|_auth|username|_password)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, rawPrefix = '', key = '', value = ''] = match;
    const prefix = rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`;
    const fields = byPrefix.get(prefix) ?? {};
    fields[key] = expand(value.replace(/^(["'])(.*)\1$/, '$2'), env);
    byPrefix.set(prefix, fields);
  }
  const out: RegistryAuth[] = [];
  for (const [prefix, fields] of byPrefix) {
    if (fields._authToken) {
      out.push({ prefix, header: `Bearer ${fields._authToken}` });
    } else if (fields._auth) {
      out.push({ prefix, header: `Basic ${fields._auth}` });
    } else if (fields.username && fields._password) {
      const password = Buffer.from(fields._password, 'base64').toString();
      const basic = Buffer.from(`${fields.username}:${password}`).toString('base64');
      out.push({ prefix, header: `Basic ${basic}` });
    }
  }
  return out;
};

/** The credentials for `url` — the longest matching prefix wins, as in npm — or undefined. */
export const authFor = (url: string, auths: RegistryAuth[]): RegistryAuth | undefined => {
  const bare = url.replace(/^https?:/, '');
  return auths
    .filter((auth) => bare.startsWith(auth.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
};

/** Every `.npmrc` an install in `root` reads credentials from: the project's, then the user's. */
export const readNpmrcAuth = async (root: string): Promise<RegistryAuth[]> => {
  const auths: RegistryAuth[] = [];
  for (const file of [join(root, '.npmrc'), join(homedir(), '.npmrc')]) {
    if (existsSync(file)) auths.push(...parseNpmrcAuth(await Bun.file(file).text()));
  }
  return auths;
};

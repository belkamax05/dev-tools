import formatColor from '@/dev-tools/utils/format/formatColor';
import type { VendorKind } from '../vendored';

/** One colour per mechanism, so a column of mixed lines reads at a glance. */
const KIND_COLOR = {
  subrepo: 'magenta',
  submodule: 'cyan',
  subtree: 'yellow',
} as const satisfies Record<VendorKind, string>;

/** Widest kind name, so every label's path starts in the same column. */
const WIDTH = Math.max(...Object.keys(KIND_COLOR).map((kind) => kind.length));

/**
 * The start of every line a pull prints about one vendored directory: which mechanism vendored
 * it, then where it is — `submodule libs/dev-tools`, `subrepo   system`.
 *
 * The kind leads rather than trailing because it is the thing to tell apart first: the same path
 * can be a subrepo in one repository and a submodule in the next (dev-tools is both), and the
 * two pull in entirely different ways.
 *
 * @param kind - The mechanism, or 'self' for the repository everything is vendored into
 * @param dir - Repo-relative directory; ignored for 'self'
 */
const vendoredLabel = (kind: VendorKind | 'self', dir = '') =>
  kind === 'self'
    ? formatColor('this repository', 'catalog')
    : `${formatColor(kind.padEnd(WIDTH), KIND_COLOR[kind])} ${dir}`;

export default vendoredLabel;

/**
 * The two bytes every escape sequence in this directory is built from.
 *
 * Written as character codes rather than as literals: an ESC byte sitting in a
 * source file is invisible in every editor and diff, survives a copy-paste only
 * by luck, and is silently eaten by any tool that strips control characters.
 * The name is also the documentation — `${ESC}[?1049h` reads as a sequence,
 * where a bare literal reads as a typo.
 */
export const ESC = String.fromCharCode(0x1b);

/** String Terminator. BEL also works, but ST is what the spec asks for. */
export const ST = `${ESC}\\`;

export default ESC;

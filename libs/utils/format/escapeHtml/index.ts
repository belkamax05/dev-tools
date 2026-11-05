const escapeWith = (apostrophe: string) => (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, apostrophe);

/** Text made safe anywhere in an HTML page — element content and quoted attribute values. */
export const escapeHtml = escapeWith('&#39;');

/**
 * The same for XML, spelling the apostrophe `&apos;` as XML tools (Jenkins' config.xml) write it —
 * which matters when the result is searched for in their output, not just parsed.
 */
export const escapeXml = escapeWith('&apos;');

export default escapeHtml;

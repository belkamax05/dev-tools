import { expect, test } from 'bun:test';

import { escapeHtml, escapeXml } from '.';

test('escapes the five markup characters, & first', () => {
  expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
    '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
  );
  expect(escapeHtml('&lt;')).toBe('&amp;lt;');
});

test('XML spells the apostrophe &apos;', () => {
  expect(escapeXml(`it's <ok>`)).toBe('it&apos;s &lt;ok&gt;');
});

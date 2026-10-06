/**
 * Converts a raw git diff string into a self-contained HTML page using diff2html (via CDN).
 * The resulting HTML can be written to a file and opened in a browser.
 */
const getDiffHtml = (diffString: string, title: string): string => {
  const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/diff2html/bundles/css/diff2html.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/diff2html/bundles/js/diff2html-ui.min.js"></script>
  <style>
    /* ── Page ── */
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 16px; font-family: sans-serif; background: #0d1117; color: #e6edf3; }
    h2 { font-size: 13px; color: #8b949e; margin: 0 0 12px; }

    /* ── diff2html CSS variable overrides ── */
    :root {
      --d2h-color:                    #e6edf3;
      --d2h-bg-color:                 #0d1117;
      --d2h-file-header-bg-color:     #161b22;
      --d2h-border-color:             #30363d;
      --d2h-line-number-color:        #8b949e;
      --d2h-line-number-bg-color:     #0d1117;
      --d2h-neutral-color:            #8b949e;
      --d2h-neutral-bg-color:         #161b22;
      --d2h-file-line-number-color:   #8b949e;

      /* insert */
      --d2h-ins-bg-color:             #122615;
      --d2h-ins-highlight-bg-color:   #1d4624;

      /* delete */
      --d2h-del-bg-color:             #2d1214;
      --d2h-del-highlight-bg-color:   #5c181c;
    }

    /* ── Structural overrides diff2html doesn't expose via vars ── */

    /* File list (summary box at top) */
    .d2h-file-list-wrapper { background: #161b22; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 12px; }
    .d2h-file-list-header  { background: #161b22; color: #8b949e; border-bottom: 1px solid #30363d; }
    .d2h-file-list li      { border-bottom: 1px solid #21262d; }
    .d2h-file-list li:last-child { border-bottom: none; }
    .d2h-file-list a       { color: #58a6ff; }

    /* File block */
    .d2h-file-wrapper      { border: 1px solid #30363d; border-radius: 6px; margin-bottom: 12px; background: #0d1117; }
    .d2h-file-header       { background: #161b22; border-bottom: 1px solid #30363d; color: #e6edf3; border-radius: 6px 6px 0 0; }
    .d2h-file-name         { color: #e6edf3; }
    .d2h-tag               { background: #21262d; color: #8b949e; border: 1px solid #30363d; }

    /* Code table */
    .d2h-diff-table        { background: #0d1117; }
    .d2h-code-line         { color: #e6edf3; }
    .d2h-code-line-ctn     { color: #e6edf3; }
    .d2h-code-side-linenumber { background: #0d1117; color: #8b949e; border-right: 1px solid #30363d; }

    /* Inserted line */
    .d2h-ins.d2h-change, .d2h-ins { background: #122615; }
    .d2h-ins .d2h-code-line-ctn   { color: #c4e4c9; }
    .d2h-ins .d2h-code-side-linenumber { background: #1b2e1e; color: #68b87a; }
    ins                            { background: #1d4624; color: #e6edf3; text-decoration: none; }

    /* Deleted line */
    .d2h-del.d2h-change, .d2h-del { background: #2d1214; }
    .d2h-del .d2h-code-line-ctn   { color: #cc7a7e; }
    .d2h-del .d2h-code-side-linenumber { background: #36191b; color: #cc7a7e; }
    del                            { background: #5c181c; color: #e6edf3; text-decoration: none; }

    /* Hunk info / context divider */
    .d2h-info              { background: #1c2128; color: #8b949e; border-top: 1px solid #30363d; border-bottom: 1px solid #30363d; }

    /* Empty placeholder cells (side-by-side) — diagonal stripe = "void" space */
    .d2h-emptyplaceholder,
    .d2h-code-side-emptyplaceholder {
      background: repeating-linear-gradient(
        45deg,
        #0d1117,
        #0d1117 4px,
        #131920 4px,
        #131920 10px
      ) !important;
      border-color: #30363d;
    }
    /* Suppress line number text in empty gutter */
    .d2h-code-side-emptyplaceholder.d2h-code-side-linenumber { color: transparent; }
  </style>
</head>
<body>
  <h2>${safeTitle}</h2>
  <div id="diff"></div>
  <script>
    const diffString = ${JSON.stringify(diffString)};
    const config = { drawFileList: true, matching: 'lines', outputFormat: 'side-by-side' };
    const diff2htmlUi = new Diff2HtmlUI(document.getElementById('diff'), diffString, config);
    diff2htmlUi.draw();
    diff2htmlUi.highlightCode();
  </script>
</body>
</html>`;
};

export default getDiffHtml;

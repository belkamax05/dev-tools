# bmi

Bookmarks the way raindrop.io keeps them — pages filed by tags, some of which are categories,
with a description and a preview of each page — as a terminal dashboard, plus commands for scripts. Fuzzy search goes
through all of it at once.

```sh
bmi                              # dashboard
bmi bookmarks|settings          # open it on a tab
bmi list [query] [--tag=name] [--json]
bmi open <query>                 # the best match, in the browser
bmi add <url> [--title=..] [--description=..] [--tags=a,b]
bmi remove <url>
bmi tags [--json]                # the categories as a tree, then the other tags, with counts
bmi tag <name> [--description=..] [--order=n]   # make a tag a category in your list
bmi fetch [query] [--force]      # previews and favicons for every page (or the matching ones)
bmi config                       # where the two lists and the cache are
```

## Two lists, merged

- **The workspace list**: the links a project's team shares, kept in that project's git. bmi
  looks in the workspace root — `$BMI_WORKSPACE_ROOT`, or else the directory it was started in —
  for `bookmarks.config.json`, then `config/bookmarks.config.json`. The first one found is the
  only one read. `$BMI_WORKSPACE_FILE` names a file outright. With none, bmi shows only your
  list. bmi only ever reads it. bmi itself ships no bookmarks.
- **Your list**: `~/.config/bmi/config.json`, next to the theme (a good file to keep in your
  dotfiles). Everything you add, retitle or tag, whether in the dashboard or with `bmi add`, is
  written here.

A launcher that knows its project's root sets `$BMI_WORKSPACE_ROOT` itself, so the workspace
list is found from any subdirectory. dfs-fe-internal's `dfs bookmarks` (also `dfs bm` and
`dfs links`) does this.

Pages and categories from the workspace list are marked with `⌂` and drawn in the theme's highlight
colour. In the grid, the card gets a highlight outline and a `⌂ workspace` chip over its top-right
corner, which stays when the card is selected. In the lists, the row's hint carries the `⌂`.
Your own pages keep the muted outline.

`u` (or the [u] Hide yours / Show yours button) hides your own pages and categories, so only the
workspace list is shown. The choice is remembered. A workspace page you retitled stays, with your
title, since workspace bookmarks are always shown. Adding a page or a category shows yours again,
so it doesn't vanish as it's added.

Both files have the same shape, and only a bookmark's `url` is required:

```jsonc
{
  "tags": {                            // declared tags: the categories
    "jira": { "description": "The tracker", "order": 1 },
    "repositories": {},
    "repositories/gitlab": {}          // nested: it's under repositories
  },
  "bookmarks": [
    "bun.sh",                          // a bare URL is enough; https:// is assumed
    { "url": "https://acme.atlassian.net/jira/your-work", "title": "My work", "tags": ["jira", "sprint"] },
    { "url": "https://gitlab.example/wc", "title": "wc", "tags": ["repositories/gitlab", "backend"] }
  ]
}
```

### Tags and categories

A page is filed one way, by its tags. A tag written down under `tags` is *declared*, and that
makes it a category: it gets a section on the Bookmarks tab, a description and an optional
`order` (lower first, then the rest in list order). Every other tag is a plain label. Plain tags
are found by search and shown on the page, but they don't get a section. A page with no category
goes under Unsorted.

- **Nesting:** tags nest with `/`, so `repositories/gitlab` implies `repositories`. `#repositories`
  finds both, and `#gitlab` finds the nested one. Keep it to two levels, since deeper trees are hard
  to read in a terminal.
- **Where a page is listed:** under its most specific categories only. A page in
  `repositories/gitlab` isn't also listed under `repositories`. A page tagged with two categories is
  listed in both, but it's still one page, with one title and one set of tags.
- **Name clashes:** a plain tag with the same name as a category files the page there. Name the
  categories so this is what you mean, or pick a different word for the label.

`keywords` is another name for `tags`, and either one can be a comma-separated string. Tags are
lower-cased. A page is matched by its URL, ignoring the scheme, `www.`, a trailing slash and the
fragment, so one page written twice is one page with its tags combined. When both lists describe
the same page or category, your title and description win and the tags are combined. To rename a
workspace page, you write it into your own list with a new title, which is what `n` does on it.
You can retitle, describe and tag a workspace page (including adding categories with `T`), but
you can't take the workspace's tags away. Only pages that are yours alone can be moved or removed.

**Older files:** the old `groups: [{ name, description, tags, bookmarks }]` shape is still read.
Each group becomes a declared tag, and it's put on each of its pages along with the group's own
tags. The next time bmi saves your list, it's written in the new shape.

### GitHub repositories

A bookmark of a GitHub repository (any page of `github.com/<owner>/<repo>`) gets a **GitHub**
panel in the detail pane, under its tags. It has a button for each of the repository's pages you
use most. Each button is clickable and has an uppercase hotkey, so none of them clashes with the
Bookmarks tab's own keys:

| Toggle | Opens | Key | On by default |
| --- | --- | --- | --- |
| `pulls` | Pull requests | `P` | yes |
| `actions` | Actions | `A` | yes |
| `pages` | the GitHub Pages site (`<owner>.github.io/<repo>/`) | `G` | yes |
| `issues` | Issues | `I` | no |
| `branches` | Branches | `B` | no |
| `commits` | Commits | `C` | no |
| `releases` | Releases | `L` | no |
| `settings` | Settings | `S` | no |

The toggles go on the bookmark, as `github`:

```jsonc
{ "url": "https://github.com/acme/web", "github": { "pages": false, "issues": true } }
```

A toggle you leave out takes its default. Your list wins over the workspace's key by key, so to
personalise a workspace repository, write the same URL into your own list with just the toggles
you want changed. Retitling or tagging the page keeps them.

## Search first, like rofi

bmi always opens on 🔖 Bookmarks with the search focused, whatever tab you used last time (it
doesn't remember one). Typing filters straight away. ↑/↓ move, Enter opens, Tab goes to the next
tab, Ctrl+U clears the query and Ctrl+W deletes the last word. Esc hands the keyboard to the
hotkeys below and **keeps the query**, so the hotkeys work on what you found. For example, type
`dfs-fe`, press Esc, then `P` for its pull requests. From the hotkeys, `c` (or the [c] Clear
button) clears the query, and `/` or a click on the search line brings focus back to the search.

Every action has a hotkey and a clickable control: the buttons above the detail pane, the hints
under the list, the footer, the tabs, and the Yes/No and Save/Cancel buttons on every question.
The [g] button (or `g` in hotkey mode) steps the Bookmarks layout through list, grid and tiles.
The choice is remembered.

- **List**: one row per page.
- **Grid**: bordered cards with a 32 × 8-cell preview image area. Under it, the favicon is on the
  left, with the title and the URL stacked beside it. Images keep their aspect ratio, and a missing
  one shows a placeholder. `p` (or [p] Hide images / Show images) drops the image area, which
  leaves cards just the favicon row tall. That choice is remembered too.
- **Tiles**: about half a card's height and a third of its width, with the favicon centred over
  the title and the host. There's no preview image.

Card and tile widths are minimums rather than sizes. Each row fits as many as it can and shares
the rest of the width out, so they stretch to fill it like a flex-box row. Visible cards fetch
previews when automatic previews are enabled. Grids keep category headings and use all four arrow
keys to move. Search, selection and the detail pane work in every layout.

The mouse wheel scrolls lists. A click selects a row, and a second click on the selected row
opens it, so a stray click never launches the browser.

| Tab | Keys (in hotkey mode) |
| --- | --- |
| 🔖 Bookmarks | every page, under each category it's in. Enter/`o` open · `y` copy the URL · `a` add (tagged with the tag in view) · `n` title · `d` description · `T` tags · `m` move to other categories (a new name declares one) · `x` remove · `f` fetch the preview now · `i` open the preview image · `u` hide/show yours · `g` layout · `p` grid images on/off · `/` search · `c` clears the search · Esc leaves the tag in view |
| 📂 Tags | categories as a tree, then the other tags, each with how many pages it has. Enter shows a tag's pages on the Bookmarks tab · `O` opens every page in it (asks first above 5) · `a` new category · `c` makes a plain tag a category · `d` description · `x` stops using your category (its pages stay) |
| 🔧 Settings | theme, how images are drawn, whether previews are fetched automatically, `e` edit your list, `E` edit the workspace list, `X` clear |

Outside the search: `1-3`/`Tab` switch tab, `r` re-read both lists, `t` theme, `q` quit.

## Search

Each word of the query has to match somewhere: the title, the tags (with the parents they
imply, and each segment of a nested one), the categories, the URL, or the description (a
category's description counts as its pages'). A title match ranks highest, then tags, then
categories, then the URL, then the description. A whole substring beats letters scattered in order,
and a match at the start of a word beats one in the middle. Scattered matches, like `sprnt` for
"Sprint board", only count in titles, tags and categories, and only when they start at the
beginning of a word. Across a sentence of description, three letters in order turn up by chance.
A word starting with `#` is a tag filter rather than a search term, so `#ops board` means pages
with a tag (or a segment of one) starting with `ops` that match "board". Typing a category's name
lists every page in it.

## Previews and favicons

When the cursor rests on a page, bmi reads the start of the page (its `<head>`, at most
512 KB) and shows what the page says about itself: the Open Graph title, description and site
name, falling back to `<title>` and `<meta name="description">`. The `og:image` is shown as a
link, not drawn. The favicon is drawn in half blocks with its transparency kept. bmi picks a PNG
icon of 32–64px if the page offers one, otherwise an apple-touch-icon, then the page's ICO, then
`/favicon.ico`. It decodes PNG and ICO (both embedded-PNG and BMP entries). It skips SVG, GIF and
JPEG icons.

Everything fetched goes to `~/.cache/bmi`:

- `previews.json`: one record per page, refreshed after 14 days. A failed fetch is retried after
  a day.
- `icons/`: each favicon re-encoded as a small PNG and keyed by the icon's URL, so all pages on
  one host share a file.

In the dashboard, a page with no title of its own shows the one its preview found. If a page redirects to a
different host, which usually means a login page for a private Jira or wiki, the preview says so.
Its favicon is usually still right.

Images (favicons and preview cards) are drawn with the best method the terminal supports: the
kitty protocol, then sixel, then iTerm2's, and coloured half-blocks where none is available. You
can pick another under Settings → Images. Methods the terminal didn't report are greyed out, and
`bmi config` prints what's in use. `DEV_TOOLS_GRAPHICS=kitty|sixel|iterm2|halfblock` overrides the
setting for one run. In VS Code-based editors (xterm.js), images are cleared by briefly leaving and
re-entering the alternate screen whenever one moves or goes away. That causes a short flicker, but
it's the only cleanup that doesn't leave grey placeholder blocks behind there.

To fetch nothing until asked, turn previews to "Only on [f]" in Settings. `bmi fetch` fills the
cache for every page in one go, six at a time.

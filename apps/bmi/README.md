# bmi

Bookmarks the way raindrop.io keeps them — pages in groups, with tags, a description and a
preview of each page — as a terminal dashboard, plus commands for scripts. Fuzzy search goes
through all of it at once.

```sh
bmi                              # dashboard
bmi bookmarks|groups|settings    # open it on a tab
bmi list [query] [--group=name] [--json]
bmi open <query>                 # the best match, in the browser
bmi add <url> [--title=..] [--description=..] [--tags=a,b] [--group=name]
bmi remove <url> [--group=name]
bmi groups [--json]
bmi fetch [query] [--force]      # previews and favicons for every page (or the matching ones)
bmi config                       # where the two lists and the cache are
```

## Two lists, merged

- **The static list**: `apps/bmi/bookmarks.json`, kept in git with bmi. It holds the links a team
  shares. `$BMI_STATIC_FILE` points at a different file, for example one that lives in another
  repository. bmi only ever reads it.
- **Your list**: `~/.config/bmi/config.json`, next to the theme. Everything you add, retitle or
  tag, whether in the dashboard or with `bmi add`, is written here.

Both files have the same shape, and only `url` (plus a group's `name`) is required:

```jsonc
{
  "bookmarks": [                       // pages in no group: "Unsorted"
    "bun.sh",                          // a bare URL is enough; https:// is assumed
    { "url": "https://ink.dev", "title": "Ink", "description": "…", "tags": ["tui"] }
  ],
  "groups": [
    {
      "name": "jira",
      "description": "The tracker",
      "tags": ["tickets"],             // every page in the group is found by these too
      "bookmarks": [
        { "url": "https://acme.atlassian.net/jira/your-work", "title": "My work" },
        { "url": "https://acme.atlassian.net/jira/software/projects/OPS/boards/7", "keywords": "ops, board" }
      ]
    }
  ]
}
```

`keywords` is another name for `tags`, and either one can be a comma-separated string. Groups
are matched by name without regard to case. A page is matched by its URL within its group,
ignoring the scheme, `www.`, a trailing slash and the fragment. When both lists describe the
same page or group, your title and description win and the tags are combined. So to rename a
static page you write it into your own list with a new title, which is what `n` does on it.
You can retitle, describe and tag a static page this way, but you can only move or remove
pages you added yourself.

## Search first, like rofi

bmi always opens on 🔖 Bookmarks with the search focused, whatever tab you used last time (it
doesn't remember one). Typing filters straight away. ↑/↓ move, Enter opens, Tab goes to the next
tab, Ctrl+U clears the query and Ctrl+W deletes the last word. Esc clears the query; on an empty
query it hands the keyboard to the hotkeys below. `/` or a click on the search line brings
focus back to the search.

Every action has a hotkey and a clickable control: the buttons above the detail pane, the hints
under the list, the footer, the tabs, and the Yes/No and Save/Cancel buttons on every question.
The mouse wheel scrolls lists. A click selects a row, and a second click on the selected row
opens it, so a stray click never launches the browser.

| Tab | Keys (in hotkey mode) |
| --- | --- |
| 🔖 Bookmarks | every page, under its group's name. Enter/`o` open · `y` copy the URL · `a` add (to the group in view) · `n` title · `d` description · `T` tags · `m` move to a group · `x` remove · `f` fetch the preview now · `i` open the preview image · `/` search · Esc clears the group |
| 📂 Groups | Enter shows the group's pages on the Bookmarks tab, search focused · `O` opens every page in it (asks first above 5) · `a` new group · `d` description · `T` tags · `x` remove your group |
| 🔧 Settings | theme, whether previews are fetched automatically, `e` edit your list, `E` edit the static list, `X` clear |

Outside the search: `1-3`/`Tab` switch tab, `r` re-read both lists, `t` theme, `q` quit.

## Search

Each word of the query has to match somewhere: the title, the tags (the group's tags count),
the group name, the URL or the description. A title match ranks highest, then tags, then the
group, then the URL, then the description. A whole substring beats letters scattered in order,
and a match at the start of a word beats one in the middle. Scattered matches, like `sprnt` for
"Sprint board", only count in titles, tags and group names, and only when they start at the
beginning of a word. Across a sentence of description, three letters in order turn up by chance.
A word starting with `#` is a tag filter rather than a search term, so `#ops board` means pages
tagged `ops…` that match "board". Typing a group's name lists every page in that group.

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

To fetch nothing until asked, turn previews to "Only on [f]" in Settings. `bmi fetch` fills the
cache for every page in one go, six at a time.

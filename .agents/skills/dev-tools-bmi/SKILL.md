---
name: dev-tools-bmi
description: Use bmi (dev-tools) for bookmarks — a team workspace list in git (`bookmarks.config.json`) merged with a personal list, tags/categories, fuzzy search, opening links, and page previews. Trigger when asked to find or open a team link (Jira, repos, dashboards, envs), add a bookmark, organise tags/categories, or edit a project's bookmarks file.
---

# bmi — bookmarks

`bmi` lives in `apps/bmi` (`bin/bmi`).

```sh
bmi list [query] [--tag=name] [--json]   # find links — use this to answer "where is X"
bmi open <query>                          # best match in the browser
bmi <query> [--tag=name]                  # one match opens, several ask, none errors
bmi add <url> [--title=..] [--description=..] [--tags=a,b]   # into YOUR list
bmi remove <url>                          # your own pages only
bmi tags [--json]                         # categories tree + plain tags with counts
bmi tag <name> [--description=..] [--order=n]   # make a tag a category
bmi fetch [query] [--force]               # previews/favicons into ~/.cache/bmi
bmi config                                # where the lists and cache are
bmi                                       # dashboard (search-first)
```

## Two lists

- **Workspace list** (read-only for bmi): `bookmarks.config.json`, then
  `config/bookmarks.config.json`, in `$BMI_WORKSPACE_ROOT` (else cwd); `$BMI_WORKSPACE_FILE` names
  a file outright. To add a *team* link, edit that file in the repo — `bmi add` writes only the
  personal list.
- **Your list**: `~/.config/bmi/config.json` — everything added/retitled/tagged via bmi.

Both have the same shape; only `url` is required:

```jsonc
{
  "tags": { "jira": { "description": "The tracker", "order": 1 }, "repositories/gitlab": {} },
  "bookmarks": [
    "bun.sh",
    { "url": "https://github.com/acme/web", "title": "web", "tags": ["repositories"],
      "github": { "pages": false, "issues": true } }
  ]
}
```

- Declared tags are **categories** (sections); others are plain labels. Nest with `/`, max two
  levels. `keywords` = `tags`; comma strings allowed; lower-cased.
- Pages match by URL ignoring scheme, `www.`, trailing slash, fragment — duplicates merge.
- Your title/description win over the workspace's; tags combine. GitHub repo bookmarks get
  `github` toggles (`pulls`, `actions`, `pages` on by default; `issues`, `branches`, `commits`,
  `releases`, `settings` off).

## Search

Every word must match (title > tags > categories > URL > description). `#tag` filters by tag
prefix: `#ops board`.

## Changing bmi

`src/run.ts`, `src/core/*`, `src/ui/*`; images via `libs/terminal-canvas`. Verify with `bun test`,
`bunx tsc --noEmit`, `bun run lint` from `apps/bmi`.

import openUrl from '@/dev-tools/utils/system/openUrl';

import {
  buildLibrary,
  configStore,
  loadWorkspaceList,
  TAB_IDS,
  type TabId,
  userList,
} from './config/settings';
import {
  coerceBookmark,
  coerceTags,
  displayTitle,
  entriesTagged,
  findBookmark,
  hasBookmark,
  type Library,
  normalizeTag,
  placementOf,
  withBookmark,
  withoutBookmark,
  withTag,
} from './core/bookmarks';
import { openPreviewCache } from './core/preview';
import search from './core/search';

const HELP = `bmi — bookmarks, raindrop-style: categories, tags, fuzzy search, page previews

usage:
  bmi                             open the dashboard
  bmi <tab>                       open it on a tab: ${TAB_IDS.join(', ')}
  bmi list [query] [--tag=name] [--json]
                                  the bookmarks matching a fuzzy query (title, tags,
                                  categories, URL, description); #tag keeps only pages with
                                  that tag; --tag keeps the pages tagged with it or below it
  bmi open <query>                open the best match in the browser
  bmi add <url> [--title=..] [--description=..] [--tags=a,b]
                                  add to your own list (or add to the page there)
  bmi remove <url>                remove from your own list
  bmi tags [--json]               the categories as a tree, then the other tags, with counts
  bmi tag <name> [--description=..] [--order=n]
                                  declare a tag in your list, making it a category
  bmi fetch [query] [--force]     fetch page previews and favicons into the cache
  bmi config                      print where the lists and the cache are

Two lists, merged: the project's (bookmarks.config.json, or config/bookmarks.config.json, in
$BMI_WORKSPACE_ROOT or the current directory; $BMI_WORKSPACE_FILE names one outright) and your
own in the config file. Both are { tags: { name: { description?, order? } }, bookmarks: [...] }:
a bookmark is a URL or { url, title?, description?, tags? }, and a tag declared under "tags" is
a category. Tags nest with "/" — "repositories/gitlab" is under "repositories".
`;

const flagValue = (flags: string[], name: string) =>
  flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);

const loadEverything = async () => {
  const [config, workspace] = await Promise.all([configStore.load(), loadWorkspaceList()]);
  if (workspace.error) {
    console.error(`bmi: ignoring ${workspace.path}: ${workspace.error}`);
  }
  return {
    config,
    library: buildLibrary(workspace.list, userList(config)),
    workspace,
  };
};

/** The pages under `--tag` (`--group`, from before tags), or every page without one. */
const scopeOf = (library: Library, flags: string[]) => {
  const tag = normalizeTag(flagValue(flags, 'tag') ?? flagValue(flags, 'group'));
  return tag ? entriesTagged(library, tag) : library.entries;
};

/** Run `work` over `items`, `limit` at a time. */
const pool = async <T>(items: T[], limit: number, work: (item: T) => Promise<void>) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++] as T;
        await work(item);
      }
    }),
  );
};

/**
 * `bmi [tab | list | open | add | remove | tags | tag | fetch | config] [flags]`.
 *
 * The dashboard is imported lazily, as the other apps do, so the scripted commands never load
 * React or Ink.
 */
export const run = async (...argv: string[]) => {
  const flagList = argv.filter((arg) => arg.startsWith('--'));
  const flags = new Set(flagList);
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('--'));

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  if (first === 'list' || first === 'ls' || first === 'find') {
    const { library } = await loadEverything();
    const hits = search(scopeOf(library, flagList), library.tags, rest.join(' '));
    if (flags.has('--json')) {
      console.log(
        JSON.stringify(
          hits.map((hit) => hit.entry),
          null,
          2,
        ),
      );
      return;
    }
    const width = process.stdout.isTTY ? process.stdout.columns : 0;
    for (const { entry } of hits) {
      const placed = placementOf(entry, library);
      const where = placed.length ? `[${placed.join(', ')}] ` : '';
      const tags = entry.tags.length ? `  #${entry.tags.join(' #')}` : '';
      const line = `${where}${displayTitle(entry)}  ${entry.url}${tags}`;
      console.log(width ? line.slice(0, width) : line);
    }
    if (!hits.length) process.exitCode = 1;
    return;
  }

  if (first === 'open' || first === 'go') {
    const { library } = await loadEverything();
    const [best] = search(library.entries, library.tags, rest.join(' '));
    if (!rest.length || !best) {
      console.error(
        rest.length ? `Nothing matches "${rest.join(' ')}"` : 'usage: bmi open <query>',
      );
      process.exitCode = 1;
      return;
    }
    console.log(`${displayTitle(best.entry)} — ${best.entry.url}`);
    openUrl(best.entry.url);
    return;
  }

  if (first === 'add') {
    const bookmark = coerceBookmark({
      url: rest[0] ?? '',
      title: flagValue(flagList, 'title'),
      description: flagValue(flagList, 'description'),
      //? --group, from before tags, files the page under that tag
      tags: coerceTags(flagValue(flagList, 'tags'), flagValue(flagList, 'group')),
    });
    if (!bookmark) {
      console.error('usage: bmi add <url> [--title=..] [--description=..] [--tags=a,b]');
      process.exitCode = 1;
      return;
    }
    const config = await configStore.load();
    const list = userList(config);
    //? Adding a page already there adds its tags to the ones it has, rather than replacing them
    const tags = coerceTags(findBookmark(list, bookmark.url)?.tags, bookmark.tags);
    await configStore.save({
      ...config,
      ...withBookmark(list, { ...bookmark, ...(tags.length && { tags }) }),
    });
    console.log(`Added ${bookmark.url}${tags.length ? `  #${tags.join(' #')}` : ''}`);
    return;
  }

  if (first === 'remove' || first === 'rm') {
    const url = coerceBookmark(rest[0] ?? '')?.url;
    const config = await configStore.load();
    if (!url || !hasBookmark(userList(config), url)) {
      console.error(
        url
          ? `${url} is not in your list — pages in the workspace list cannot be removed`
          : 'usage: bmi remove <url>',
      );
      process.exitCode = 1;
      return;
    }
    await configStore.save({ ...config, ...withoutBookmark(userList(config), url) });
    console.log(`Removed ${url}`);
    return;
  }

  if (first === 'tags' || first === 'groups') {
    const { library } = await loadEverything();
    if (flags.has('--json')) {
      console.log(
        JSON.stringify(
          library.tags.map(({ entries, ...tag }) => ({ ...tag, count: entries.length })),
          null,
          2,
        ),
      );
      return;
    }
    for (const tag of library.tags) {
      const name = tag.declared ? `${'  '.repeat(tag.depth)}${tag.name}` : `#${tag.key}`;
      console.log(
        `${name.padEnd(24)} ${String(tag.entries.length).padStart(3)}  ${tag.description ?? ''}`,
      );
    }
    return;
  }

  if (first === 'tag') {
    const key = normalizeTag(rest[0]);
    if (!key) {
      console.error('usage: bmi tag <name> [--description=..] [--order=n]');
      process.exitCode = 1;
      return;
    }
    const description = flagValue(flagList, 'description')?.trim();
    const order = Number(flagValue(flagList, 'order'));
    const config = await configStore.load();
    await configStore.save({
      ...config,
      ...withTag(userList(config), key, {
        ...(description && { description }),
        ...(Number.isFinite(order) && flagValue(flagList, 'order') !== undefined && { order }),
      }),
    });
    console.log(`Declared ${key} — it is a category now`);
    return;
  }

  if (first === 'fetch') {
    const { library } = await loadEverything();
    const cache = await openPreviewCache();
    const hits = search(library.entries, library.tags, rest.join(' '));
    const urls = hits.map((hit) => hit.entry.url);
    let done = 0;
    await pool(urls, 6, async (url) => {
      const preview = await cache.ensure(url, { force: flags.has('--force') });
      done += 1;
      const icon = preview.iconFile ? '◆' : '◇';
      const what = preview.error ? `✗ ${preview.error}` : (preview.title ?? '');
      console.log(`[${done}/${urls.length}] ${icon} ${url}  ${what}`);
    });
    return;
  }

  if (first === 'config' || first === 'where') {
    const { workspace } = await loadEverything();
    const cache = await openPreviewCache();
    console.log(`your list  ${configStore.path}`);
    console.log(`workspace  ${workspace.path}${workspace.exists ? '' : '  (none)'}`);
    console.log(`cache      ${cache.directory}`);
    return;
  }

  if (first !== undefined && !TAB_IDS.includes(first as TabId)) {
    console.error(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    process.exitCode = 1;
    return;
  }

  const { default: renderDashboard } = await import('./ui/renderDashboard');
  await renderDashboard(first as TabId | undefined);
  process.exit(0);
};

export default run;

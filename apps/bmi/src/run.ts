import openUrl from '@/dev-tools/utils/system/openUrl';

import {
  buildLibrary,
  configStore,
  loadStaticList,
  TAB_IDS,
  type TabId,
  userList,
} from './config/settings';
import {
  coerceBookmark,
  coerceTags,
  displayTitle,
  type Entry,
  hasBookmark,
  withBookmark,
  withoutBookmark,
} from './core/bookmarks';
import { openPreviewCache } from './core/preview';
import search from './core/search';

const HELP = `bmi — bookmarks, raindrop-style: groups, tags, fuzzy search, page previews

usage:
  bmi                             open the dashboard
  bmi <tab>                       open it on a tab: ${TAB_IDS.join(', ')}
  bmi list [query] [--group=name] [--json]
                                  the bookmarks matching a fuzzy query (title, tags, group,
                                  URL, description); #tag keeps only pages with that tag
  bmi open <query>                open the best match in the browser
  bmi add <url> [--title=..] [--description=..] [--tags=a,b] [--group=name]
                                  add to your own list (or update the page there)
  bmi remove <url> [--group=name] remove from your own list
  bmi groups [--json]             the groups and how many pages each has
  bmi fetch [query] [--force]     fetch page previews and favicons into the cache
  bmi config                      print where the lists and the cache are

Two lists, merged: the static one shipped with bmi (bookmarks.json, or $BMI_STATIC_FILE) and
your own in the config file. Both are { bookmarks: [...], groups: [{ name, bookmarks }] }, and
a bookmark is a URL or { url, title?, description?, tags? }.
`;

const flagValue = (flags: string[], name: string) =>
  flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);

const loadEverything = async () => {
  const [config, staticResult] = await Promise.all([configStore.load(), loadStaticList()]);
  if (staticResult.error) {
    console.error(`bmi: ignoring ${staticResult.path}: ${staticResult.error}`);
  }
  return {
    config,
    library: buildLibrary(staticResult.list, userList(config)),
    staticResult,
  };
};

const sameGroup = (entry: Entry, group: string | undefined) =>
  group === undefined || (entry.group ?? '').toLowerCase() === group.toLowerCase();

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
 * `bmi [tab | list | open | add | remove | groups | fetch | config] [flags]`.
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
    const group = flagValue(flagList, 'group');
    const hits = search(
      library.entries.filter((entry) => sameGroup(entry, group)),
      library.groups,
      rest.join(' '),
    );
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
      const where = entry.group ? `[${entry.group}] ` : '';
      const tags = entry.tags.length ? `  #${entry.tags.join(' #')}` : '';
      const line = `${where}${displayTitle(entry)}  ${entry.url}${tags}`;
      console.log(width ? line.slice(0, width) : line);
    }
    if (!hits.length) process.exitCode = 1;
    return;
  }

  if (first === 'open' || first === 'go') {
    const { library } = await loadEverything();
    const [best] = search(library.entries, library.groups, rest.join(' '));
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
      tags: coerceTags(flagValue(flagList, 'tags')),
    });
    if (!bookmark) {
      console.error(
        'usage: bmi add <url> [--title=..] [--description=..] [--tags=a,b] [--group=name]',
      );
      process.exitCode = 1;
      return;
    }
    const group = flagValue(flagList, 'group')?.trim() || undefined;
    const config = await configStore.load();
    await configStore.save({
      ...config,
      ...withBookmark(userList(config), bookmark, group),
    });
    console.log(`Added ${bookmark.url}${group ? ` to ${group}` : ''}`);
    return;
  }

  if (first === 'remove' || first === 'rm') {
    const url = coerceBookmark(rest[0] ?? '')?.url;
    const group = flagValue(flagList, 'group')?.trim() || undefined;
    const config = await configStore.load();
    if (!url || !hasBookmark(userList(config), url, group)) {
      console.error(
        url
          ? `${url} is not in your list${group ? ` under ${group}` : ' outside a group (--group=name?)'} — pages in the static list cannot be removed`
          : 'usage: bmi remove <url> [--group=name]',
      );
      process.exitCode = 1;
      return;
    }
    await configStore.save({
      ...config,
      ...withoutBookmark(userList(config), url, group),
    });
    console.log(`Removed ${url}`);
    return;
  }

  if (first === 'groups') {
    const { library } = await loadEverything();
    if (flags.has('--json')) {
      console.log(JSON.stringify(library.groups, null, 2));
      return;
    }
    for (const group of library.groups) {
      console.log(
        `${group.name.padEnd(20)} ${String(group.entries.length).padStart(3)}  ${group.description ?? ''}`,
      );
    }
    return;
  }

  if (first === 'fetch') {
    const { library } = await loadEverything();
    const cache = await openPreviewCache();
    const hits = search(library.entries, library.groups, rest.join(' '));
    //? One fetch per page, not per entry: a page filed in two groups is the same page
    const urls = [...new Set(hits.map((hit) => hit.entry.url))];
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
    const { staticResult } = await loadEverything();
    const cache = await openPreviewCache();
    console.log(`your list  ${configStore.path}`);
    console.log(`static     ${staticResult.path}`);
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

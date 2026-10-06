/**
 * The pages of a GitHub repository a bookmark of it is most often a step towards — its pull
 * requests, its Actions runs, its GitHub Pages site — as links of their own.
 *
 * Which ones a page shows is a set of toggles, written on the bookmark as `github`:
 *
 * ```jsonc
 * { "url": "https://github.com/acme/web", "github": { "pages": false, "issues": true } }
 * ```
 *
 * A toggle left out takes its default; the user's list wins over the workspace's, key by key, so
 * the workspace can offer a repository's links and each person keep the ones they use.
 */

export interface GitHubRepo {
  owner: string;
  name: string;
  /** `https://github.com/owner/name`, whatever page of the repository the bookmark is on. */
  url: string;
}

export interface RepoFeature {
  label: string;
  /** Uppercase, so none of them takes a key the Bookmarks tab already uses. */
  hotkey: string;
  /** Shown unless the bookmark switches it off. */
  isDefault: boolean;
  link: (repo: GitHubRepo) => string;
}

/** Every feature bmi knows, in the order the panel draws them. */
export const REPO_FEATURES = {
  pulls: {
    label: 'Pull requests',
    hotkey: 'P',
    isDefault: true,
    link: (repo) => `${repo.url}/pulls`,
  },
  actions: {
    label: 'Actions',
    hotkey: 'A',
    isDefault: true,
    link: (repo) => `${repo.url}/actions`,
  },
  pages: {
    label: 'GitHub Pages',
    hotkey: 'G',
    isDefault: true,
    //? The published site. A repository named `<owner>.github.io` is the owner's site itself
    link: (repo) =>
      repo.name.toLowerCase() === `${repo.owner.toLowerCase()}.github.io`
        ? `https://${repo.owner.toLowerCase()}.github.io/`
        : `https://${repo.owner.toLowerCase()}.github.io/${repo.name}/`,
  },
  issues: {
    label: 'Issues',
    hotkey: 'I',
    isDefault: false,
    link: (repo) => `${repo.url}/issues`,
  },
  branches: {
    label: 'Branches',
    hotkey: 'B',
    isDefault: false,
    link: (repo) => `${repo.url}/branches`,
  },
  commits: {
    label: 'Commits',
    hotkey: 'C',
    isDefault: false,
    link: (repo) => `${repo.url}/commits`,
  },
  releases: {
    label: 'Releases',
    hotkey: 'L',
    isDefault: false,
    link: (repo) => `${repo.url}/releases`,
  },
  settings: {
    label: 'Settings',
    hotkey: 'S',
    isDefault: false,
    link: (repo) => `${repo.url}/settings`,
  },
} satisfies Record<string, RepoFeature>;

export type RepoFeatureId = keyof typeof REPO_FEATURES;
export type RepoToggles = Partial<Record<RepoFeatureId, boolean>>;

export const REPO_FEATURE_IDS = Object.keys(REPO_FEATURES) as RepoFeatureId[];

/**
 * First path segments on github.com that are GitHub's own pages, not an owner: `github.com/pulls`
 * is the user's pull requests, `github.com/orgs/acme/…` an organisation's settings.
 */
const NOT_AN_OWNER = new Set([
  'about',
  'apps',
  'collections',
  'customer-stories',
  'enterprise',
  'events',
  'explore',
  'features',
  'issues',
  'login',
  'marketplace',
  'new',
  'notifications',
  'orgs',
  'organizations',
  'pricing',
  'pulls',
  'search',
  'settings',
  'sponsors',
  'topics',
  'trending',
  'users',
]);

/** The repository a github.com URL is on — any page of it — or undefined for anything else. */
export const githubRepoOf = (url: string): GitHubRepo | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.host.replace(/^www\./, '').toLowerCase() !== 'github.com') return undefined;
  const [owner, rawName] = parsed.pathname.split('/').filter(Boolean);
  if (!owner || !rawName || NOT_AN_OWNER.has(owner.toLowerCase())) return undefined;
  const name = rawName.replace(/\.git$/, '');
  return { owner, name, url: `https://github.com/${owner}/${name}` };
};

/** Keep only booleans for features bmi knows — what a hand-edited `github` field may hold. */
export const coerceRepoToggles = (raw: unknown): RepoToggles | undefined => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: RepoToggles = {};
  for (const id of REPO_FEATURE_IDS) {
    const value = (raw as Record<string, unknown>)[id];
    if (typeof value === 'boolean') out[id] = value;
  }
  return Object.keys(out).length ? out : undefined;
};

export interface RepoLink {
  id: RepoFeatureId;
  label: string;
  hotkey: string;
  url: string;
}

/** The links a bookmark's panel shows: each feature switched on, by its toggle or its default. */
export const repoLinksOf = (
  url: string,
  toggles: RepoToggles = {},
): { repo: GitHubRepo; links: RepoLink[] } | undefined => {
  const repo = githubRepoOf(url);
  if (!repo) return undefined;
  const links = REPO_FEATURE_IDS.filter(
    (id) => toggles[id] ?? REPO_FEATURES[id].isDefault,
  ).map((id) => ({
    id,
    label: REPO_FEATURES[id].label,
    hotkey: REPO_FEATURES[id].hotkey,
    url: REPO_FEATURES[id].link(repo),
  }));
  return { repo, links };
};

export default repoLinksOf;

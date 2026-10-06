import { remoteWebUrl } from '@/dev-tools/utils/system/openUrl';

export type RepoHost = 'github' | 'gitlab' | 'other';

/** Pages `giti open` knows how to reach; not every host has every one. */
export type RepoLinkTarget = 'home' | 'actions' | 'pulls' | 'issues' | 'pages' | 'settings' | 'pr';

export interface RepoWebLinks {
  host: RepoHost;
  /** The repository's own page — the one link every web-backed remote has. */
  home: string;
  links: Partial<Record<RepoLinkTarget, string>>;
}

interface RepoWebLinksOptions {
  /** Branch to open a pull/merge request from; without it there is no `pr` link. */
  branch?: string;
  /** Branch the request targets. Left out, the host picks its own default. */
  baseBranch?: string;
}

//? Matched on the host only, not the whole URL, so a repo called `gitlab-tools` on GitHub is still
//? GitHub. SSH host aliases (`github.com-work`) keep the real host as a prefix, hence `startsWith`.
const detectHost = (hostname: string): RepoHost => {
  if (hostname.startsWith('github.com')) return 'github';
  if (hostname.includes('gitlab')) return 'gitlab';
  return 'other';
};

/**
 * Web pages for a repository, derived from one of its remote URLs.
 *
 * Undefined when the remote has no web page at all (a local path, a `file://` remote). For a
 * host giti does not recognise only `home` is filled in — guessing another host's URL layout
 * would open pages that do not exist.
 */
const repoWebLinks = (
  remoteUrl: string,
  { branch, baseBranch }: RepoWebLinksOptions = {},
): RepoWebLinks | undefined => {
  const webUrl = remoteWebUrl(remoteUrl);
  if (!webUrl) return undefined;

  const { hostname, pathname } = new URL(webUrl);
  //? An SSH alias such as `github.com-work` is a name in ~/.ssh/config, not a site — the browser
  //? needs the real host
  const host = detectHost(hostname);
  const home = host === 'github' ? `https://github.com${pathname}` : webUrl;

  if (host === 'github') {
    const [owner = '', repo = ''] = pathname.split('/').filter(Boolean);
    const source = branch && encodeURIComponent(branch);
    return {
      host,
      home,
      links: {
        home,
        actions: `${home}/actions`,
        pulls: `${home}/pulls`,
        issues: `${home}/issues`,
        pages: `https://${owner}.github.io/${repo}/`,
        settings: `${home}/settings`,
        ...(source && {
          pr: baseBranch
            ? `${home}/compare/${encodeURIComponent(baseBranch)}...${source}?expand=1`
            : `${home}/compare/${source}?expand=1`,
        }),
      },
    };
  }

  if (host === 'gitlab') {
    const params = new URLSearchParams();
    if (branch) params.set('merge_request[source_branch]', branch);
    if (baseBranch) params.set('merge_request[target_branch]', baseBranch);
    return {
      host,
      home,
      links: {
        home,
        actions: `${home}/-/pipelines`,
        pulls: `${home}/-/merge_requests`,
        issues: `${home}/-/issues`,
        settings: `${home}/-/settings/general`,
        ...(branch && { pr: `${home}/-/merge_requests/new?${params}` }),
      },
    };
  }

  return { host, home, links: { home } };
};

export default repoWebLinks;

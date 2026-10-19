/**
 * What hosts print when they turn a push away for want of rights — not for anything in the push
 * itself. GitHub over SSH and HTTPS, GitLab, Bitbucket, and a protected branch on any of them.
 */
const REFUSALS = [
  /Permission to \S+ denied/i,
  /Permission denied \(publickey/i,
  /Write access to repository not granted/i,
  /The requested URL returned error: 403/i,
  /You are not allowed to push/i,
  /protected branch hook declined/i,
  /\bGH00[0-9]\b|\bGH01[0-9]\b/,
  /You do not have permission to push/i,
];

/**
 * Whether a failed push was refused because this user may not push there — the case `send` lets
 * pass with a warning for a subrepo or subtree, whose changes still travel with the repository
 * and reach upstream with the next push by someone who can. Any other failure (rejected as
 * non-fast-forward, a hook, a network error) stays a failure.
 *
 * @param output - Everything the failed push printed
 */
const isPushRefused = (output: string) => REFUSALS.some((pattern) => pattern.test(output));

export default isPushRefused;

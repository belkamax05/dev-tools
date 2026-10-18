const pad = (value: number) => String(value).padStart(2, '0');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `16 Oct 09:29` — day first, month as a word, in the machine's own timezone. */
export const shortStamp = (at: number) => {
  const date = new Date(at);
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/**
 * `16 Oct 2026 09:29` in the machine's own timezone. Jenkins and GitHub both hand out absolute
 * instants (epoch ms, ISO with `Z`); printing them as UTC put every time an hour or more off the
 * clock on the wall and off the GitHub web UI, which shows local time. The day comes first and the
 * month is a word, so `10-16` is never read either way round.
 */
export const stamp = (at: number) => {
  const date = new Date(at);
  return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

/** `44h` or `44h25m` (`exact`) — how long ago, in the unit that keeps it readable. */
export const age = (at?: number, exact = false, now = Date.now()) => {
  if (!at) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48)
    return exact && minutes % 60 ? `${hours}h${pad(minutes % 60)}m` : `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

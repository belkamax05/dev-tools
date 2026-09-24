/**
 * Put text on the system clipboard through the terminal (OSC 52), which works
 * over SSH and needs no clipboard tool installed — kitty, foot, WezTerm,
 * iTerm2 and tmux (with set-clipboard on) all honour it.
 */
export const copyToClipboard = (text: string) => {
  process.stdout.write(`\u001b]52;c;${Buffer.from(text).toString('base64')}\u0007`);
};

export default copyToClipboard;

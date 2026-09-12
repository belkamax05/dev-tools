import { spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Opens a file with the default OS application (browser for HTML, etc.).
 */
const openFile = (filePath: string): void => {
  const osPlatform = platform();

  if (osPlatform === 'darwin') {
    spawn('open', [filePath], { stdio: 'ignore', detached: true }).unref();
  } else if (osPlatform === 'linux') {
    spawn('xdg-open', [filePath], { stdio: 'ignore', detached: true }).unref();
  } else if (osPlatform === 'win32') {
    spawn('cmd', ['/c', 'start', '', filePath], { stdio: 'ignore', detached: true }).unref();
  }
};

export default openFile;

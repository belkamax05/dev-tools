import { touchStamp } from '../../config/settings';
import type { WriteResult } from '../../core/locations';
import type { ViewProps } from '../App';

/**
 * Run a write to a location and report it: a change to your vars goes through the app (which
 * saves it and re-resolves on its own); a file or the state file changed is stamped for hooked
 * shells and re-read.
 */
export const useWrite = ({
  onConfigChange,
  notify,
  reload,
}: Pick<ViewProps, 'onConfigChange' | 'notify' | 'reload'>) =>
  (work: Promise<WriteResult>, message: string) =>
    work
      .then(async (next) => {
        if (next) onConfigChange(next);
        else {
          await touchStamp();
          reload();
        }
        notify(message, 'ok');
      })
      .catch((error: Error) => notify(error.message, 'error'));

export default useWrite;

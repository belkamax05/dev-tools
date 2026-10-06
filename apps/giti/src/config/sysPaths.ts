import { join } from 'node:path';

import systemConfig from './systemConfig';

//? Mirrors @/system/config/sysPaths, narrowed to the fields giti's own commands reach. Like the
//? original, everything hangs off systemConfig.repoRootDir; the getters keep it lazy the way the
//? original's Proxy does.
const sysPaths = {
  get rootDir() {
    return systemConfig.repoRootDir;
  },
  get cacheDir() {
    return join(systemConfig.repoRootDir, '.cache');
  },
  get commandsDir() {
    return join(systemConfig.repoRootDir, 'src', 'commands');
  },
};

export default sysPaths;

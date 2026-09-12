import type { SystemConfig } from '../types/SystemConfig';
import getRepoRootDir from '../utils/getRepoRootDir';

//? Stands in for @/system/config/systemConfig. shulker-controller reads a build-time
//? .cache/system-config.json; giti has no cache, so `repoRootDir` is resolved the same way
//? createSystemConfig resolves it — from the location of this code — rather than read back
//? from disk. `user` stays absent, which validateUser reads as "no rules to fail against".
const systemConfig: SystemConfig = {
  repoRootDir: getRepoRootDir(),
};

export default systemConfig;

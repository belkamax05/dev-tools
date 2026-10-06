import type { UserConfig } from './UserConfig';

//? Narrowed mirror of shulker-controller's SystemConfigResult — only the fields giti's mirrored
//? commands actually reach. The controller's full SystemConfigBase describes its shell, agents,
//? ports and repositories, none of which giti has. Notably absent is `commitHash`: it identifies
//? the controller's own build, so it has no meaning in a general-purpose git tool.
export interface SystemConfig {
  repoRootDir: string;
  user?: UserConfig;
}

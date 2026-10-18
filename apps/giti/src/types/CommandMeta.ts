export interface CommandMeta {
  /**
   * Name of the command
   */
  name: string;
  /**
   * Description of the command
   */
  description: string;
  /**
   * Arguments of the command
   */
  args?: string;
  /**
   * If true, the command will be evaluated in the shell
   * This is used for commands that need to be executed in the shell
   */
  eval?: boolean;
  /**
   * If true, the command will not be displayed in the interactive menu
   */
  hidden?: boolean;
  /**
   * False: no `git <name>` alias is generated for it. For a command named like one of git's own
   * (`push`, `pull`) — git would run its own and ignore the alias anyway. `giti <name>` still works.
   */
  gitAlias?: boolean;
}

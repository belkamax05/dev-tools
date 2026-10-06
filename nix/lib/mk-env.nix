# Composes env modules into one environment, loadable two ways from the
# same definition:
#   shell   - for shell.nix: `nix-shell`, or direnv's `use nix` on cd
#   profile - a buildEnv that `include` builds once and puts on PATH for
#             every shell (see ./activate.sh), no direnv or cd needed
#
# A module is { packages ? { }, paths ? [ ], variables ? { }, install ? [ ] }:
#   packages  - attrset of derivations. A later module's entry replaces an
#               earlier one with the same name (an embedding repo's pinned
#               bun over dev-tools' unpinned one) instead of both landing
#               on PATH.
#   paths     - extra PATH dirs, e.g. a repo's bin/ of shims. A later
#               module's dirs land ahead of an earlier one's.
#   variables - exported env vars. Later module wins.
#   install   - folders whose packages the *shell* installs on entry, with
#               `pkgi install --nix --if-changed` (see apps/pkgi's
#               README): node_modules built in the Nix store from the
#               lockfile of the manager package.json's packageManager
#               names (./node-modules.nix), by that manager - so the
#               pinned one among `packages` - and copied in. Keyed by the
#               lockfile alone: the same lockfile is the same store path,
#               whatever wrote it; a no-op while node_modules is already
#               the build of the current one. List a repo's own root here
#               from its env module, not dev-tools' shared module.nix - an
#               embedded copy (e.g. a repo's libs/dev-tools) is a
#               workspace member its root's install already covers.
#               Only the shell: profile's env.sh is sourced at every shell
#               startup by `include`, which shouldn't install anything.
#               Under direnv it also watches node_modules' install stamp
#               and the lockfile, so deleting node_modules or pulling a new
#               lockfile installs again at the next prompt - no reload.
#               DEV_TOOLS_AUTO_INSTALL=0 turns it off.
# So list modules base first: [ dev-tools, the repo embedding it ].
{
  pkgs,
  name,
  modules,
}:

let
  inherit (pkgs) lib;

  packages = lib.foldl' (acc: m: acc // (m.packages or { })) { } modules;
  paths = lib.concatMap (m: m.paths or [ ]) (lib.reverseList modules);
  variables = lib.foldl' (acc: m: acc // (m.variables or { })) { } modules;
  install = lib.unique (lib.concatMap (m: m.install or [ ]) modules);

  # pkgi's scripted commands need only bun and this checkout's own libs, not
  # node_modules - so it can install a repo that has none yet, dev-tools
  # itself included. `bun` is the environment's own: the shell puts
  # `packages` on PATH before shellHook runs.
  pkgi = "${toString ../..}/bin/pkgi";

  # The one place paths/variables are rendered - sourced by the shell's
  # shellHook and by activate.sh alike.
  envScript = pkgs.writeTextDir "share/${name}/env.sh" (
    lib.optionalString (paths != [ ]) ''
      export PATH=${lib.escapeShellArg (lib.concatStringsSep ":" paths)}:"$PATH"
    ''
    + lib.concatStrings (
      lib.mapAttrsToList (key: value: "export ${key}=${lib.escapeShellArg (toString value)}\n") variables
    )
  );

  # stdout goes to stderr: under direnv's `use nix`, shellHook runs inside
  # the command whose output direnv reads back.
  installScript = pkgs.writeText "${name}-install.sh" (
    lib.optionalString (install != [ ]) ''
      case "''${DEV_TOOLS_AUTO_INSTALL:-1}" in
      0 | false | no | off) ;;
      *)
          for _dt_install_dir in ${lib.escapeShellArgs install}; do
              (cd "$_dt_install_dir" && bun ${lib.escapeShellArg pkgi} install --nix --if-changed) >&2 ||
                  printf '%s: installing packages in %s failed - see above, then run `pkgi install` there\n' \
                      ${lib.escapeShellArg name} "$_dt_install_dir" >&2
              # Under direnv: re-run at the next prompt when node_modules'
              # install stamp or the lockfile changes or goes away - direnv
              # otherwise only re-evaluates on its own watched *.nix/.envrc,
              # never on `rm -rf node_modules` or a pull that moves the
              # lockfile. A heredoc, not a pipe: watch_file must run in this
              # shell to land in DIRENV_WATCHES.
              if command -v watch_file >/dev/null 2>&1; then
                  while IFS= read -r _dt_watch; do
                      [ -n "$_dt_watch" ] && watch_file "$_dt_watch"
                  done <<_dt_watched_
      $(cd "$_dt_install_dir" && bun ${lib.escapeShellArg pkgi} install --print-watched)
      _dt_watched_
              fi
          done
          unset _dt_install_dir _dt_watch
          ;;
      esac
    ''
  );
in
{
  inherit
    packages
    paths
    variables
    install
    installScript
    ;

  shell = pkgs.mkShell {
    packages = lib.attrValues packages;
    shellHook = ''
      . ${envScript}/share/${name}/env.sh
      . ${installScript}
    '';
  };

  profile = pkgs.buildEnv {
    name = "${name}-env";
    paths = lib.attrValues packages ++ [ envScript ];
  };
}

# Composes env modules into one environment, loadable two ways from the
# same definition:
#   shell   - for shell.nix: `nix-shell`, or direnv's `use nix` on cd
#   profile - a buildEnv that `include` builds once and puts on PATH for
#             every shell (see ./activate.sh), no direnv or cd needed
#
# A module is { packages ? { }, paths ? [ ], variables ? { } }:
#   packages  - attrset of derivations. A later module's entry replaces an
#               earlier one with the same name (dfs-fe-internal's pinned
#               bun over dev-tools' unpinned one) instead of both landing
#               on PATH.
#   paths     - extra PATH dirs, e.g. a repo's bin/ of shims. A later
#               module's dirs land ahead of an earlier one's.
#   variables - exported env vars. Later module wins.
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
in
{
  inherit packages paths variables;

  shell = pkgs.mkShell {
    packages = lib.attrValues packages;
    shellHook = ". ${envScript}/share/${name}/env.sh";
  };

  profile = pkgs.buildEnv {
    name = "${name}-env";
    paths = lib.attrValues packages ++ [ envScript ];
  };
}

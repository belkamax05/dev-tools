# Turns a directory of package modules into an attrset of derivations -
# shared by dev-tools' own nix/packages and any repo that embeds dev-tools.
#
# Adding a package = adding one file - no registry to update:
#     packages/ripgrep.nix   ->  { pkgs, ... }: pkgs.ripgrep
# A directory with its own default.nix works the same way, for packages that
# need more than one file. Every module is called with `args` (at least
# `pkgs`; a caller may add more, e.g. dfs-fe-internal's `unstable`).
{
  lib,
  dir,
  args,
}:

let
  isPackageModule =
    name: type:
    name != "default.nix"
    && (
      (type == "regular" && lib.hasSuffix ".nix" name)
      || (type == "directory" && builtins.pathExists (dir + "/${name}/default.nix"))
    );

  modules = lib.filterAttrs isPackageModule (builtins.readDir dir);

  allPackages = lib.mapAttrs' (
    name: _type: lib.nameValuePair (lib.removeSuffix ".nix" name) (import (dir + "/${name}") args)
  ) modules;

  # Packages that declare meta.platforms drop out silently on a system they
  # don't list, rather than failing the whole shell for a package nothing
  # else needs unconditionally. No meta.platforms = every system, same as
  # nixpkgs' own default.
  currentSystem = args.pkgs.stdenv.hostPlatform.system;
  supportsCurrentSystem =
    pkg: !(pkg ? meta && pkg.meta ? platforms) || builtins.elem currentSystem pkg.meta.platforms;
  platformFiltered = lib.filterAttrs (_: supportsCurrentSystem) allPackages;

  # Per-checkout on/off switch, gitignored - hand-create `.enabled.json` next
  # to the modules with every package you want `false`. A package missing
  # from the file defaults to enabled.
  enabledFile = dir + "/.enabled.json";
  enabled =
    if builtins.pathExists enabledFile then builtins.fromJSON (builtins.readFile enabledFile) else { };
in
lib.filterAttrs (name: _: enabled.${name} or true) platformFiltered

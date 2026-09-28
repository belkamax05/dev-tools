# Pinned nixpkgs for dev-tools' own, standalone Nix setup (shell.nix,
# .envrc, include). A repo that embeds dev-tools (dfs-fe-internal's
# libs/dev-tools) passes its own `pkgs` into ./module.nix instead, so this
# tree is only fetched when dev-tools is used on its own.
#
# Bump by changing `url` (a branch tarball tracks that release; swap in
# .../archive/<commit>.tar.gz to freeze an exact revision).
{
  url ? "https://github.com/NixOS/nixpkgs/archive/refs/heads/nixos-26.05.tar.gz",
  config ? { },
  overlays ? [ ],
}:

import (fetchTarball url) { inherit config overlays; }

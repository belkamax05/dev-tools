# nixos-unstable, for packages where the stable pin lags behind - currently
# bun (stable ships 1.3.x; unstable tracks the latest release). Same knobs as
# ./nixpkgs.nix, only the tree differs. Lazy: only fetched when a package
# module actually uses it, and a repo embedding dev-tools passes its own.
{
  url ? "https://github.com/NixOS/nixpkgs/archive/refs/heads/nixos-unstable.tar.gz",
  ...
}@overrides:

import ./nixpkgs.nix (overrides // { inherit url; })

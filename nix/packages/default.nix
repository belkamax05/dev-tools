# dev-tools' package set: every module next to this file is picked up
# automatically - see ../lib/discover-packages.nix.
{
  pkgs ? import ../nixpkgs.nix { },
  unstable ? import ../unstable.nix { },
}:

import ../lib/discover-packages.nix {
  inherit (pkgs) lib;
  dir = ./.;
  args = { inherit pkgs unstable; };
}

# dev-tools on its own: `.shell` for ../shell.nix, `.profile` for ../include.
{
  pkgs ? import ./nixpkgs.nix { },
  unstable ? import ./unstable.nix { },
}:

import ./lib/mk-env.nix {
  inherit pkgs;
  name = "dev-tools";
  modules = [ (import ./module.nix { inherit pkgs unstable; }) ];
}

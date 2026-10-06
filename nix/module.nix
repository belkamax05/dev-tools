# dev-tools as an env module (see ./lib/mk-env.nix): its packages, and its
# bin/ shims on PATH. A repo embedding dev-tools imports this with its own
# `pkgs`/`unstable` and lists it first in its own mk-env call.
{
  pkgs ? import ./nixpkgs.nix { },
  unstable ? import ./unstable.nix { },
}:

{
  packages = import ./packages { inherit pkgs unstable; };
  paths = [ "${toString ../.}/bin" ];
}

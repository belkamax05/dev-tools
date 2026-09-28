# On-demand dev environment - `nix-shell`, or automatically on cd via
# .envrc. Defined in nix/env.nix; include loads the same thing globally.
{
  pkgs ? import ./nix/nixpkgs.nix { },
  unstable ? import ./nix/unstable.nix { },
}:

(import ./nix/env.nix { inherit pkgs unstable; }).shell

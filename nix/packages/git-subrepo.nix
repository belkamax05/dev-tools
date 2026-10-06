# `git subrepo` - how dev-tools is vendored into other repos (their
# libs/dev-tools/.gitrepo) and pushed/pulled back. giti's subrepo commands
# fall back to installing it via brew when it's missing.
{ pkgs, ... }:

pkgs.git-subrepo

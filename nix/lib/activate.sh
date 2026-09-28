#!/bin/sh
# `use nix`, but global: builds a repo's nix/env.nix `profile` (the same
# packages/paths/variables its shell.nix gives direnv) and loads it into the
# current shell - meant to be sourced from a repo's `include`, i.e. from your
# shell rc, so it applies in every directory, not only under the repo.
#
#   dev_tools_nix_env <repo-root> <name> [extra-dir-to-watch...]
#
# Returns non-zero, having changed nothing, when Nix isn't installed, when
# DEV_TOOLS_NIX=0, or when the first build fails - the caller falls back to
# its non-Nix setup then.
#
# Shell startup stays fast: the build is an out-link under
# <repo-root>/.cache/nix/ (also a GC root, so nix-collect-garbage keeps it),
# and is only redone when a *.nix / .enabled.json under <repo-root>/nix (or
# an extra watched dir, e.g. an embedded libs/dev-tools/nix) is newer than
# the last build. A failed rebuild warns and keeps using the previous one.

dev_tools_nix_env() {
    _dtne_root=$1
    _dtne_name=$2
    shift 2

    case "${DEV_TOOLS_NIX:-1}" in
    0 | false | no | off) return 1 ;;
    esac
    command -v nix-build >/dev/null 2>&1 || return 1

    _dtne_link="$_dtne_root/.cache/nix/$_dtne_name"
    _dtne_stamp="$_dtne_link.stamp"
    if [ ! -e "$_dtne_link" ] || [ ! -e "$_dtne_stamp" ] ||
        [ -n "$(find "$_dtne_root/nix" "$@" \( -name '*.nix' -o -name '.enabled.json' \) \
            -newer "$_dtne_stamp" 2>/dev/null | head -n 1)" ]; then
        mkdir -p "$_dtne_root/.cache/nix"
        printf '%s: building Nix environment (only after nix/ changes)...\n' "$_dtne_name" >&2
        if nix-build "$_dtne_root/nix/env.nix" -A profile -o "$_dtne_link" >/dev/null; then
            touch "$_dtne_stamp"
        else
            printf '%s: Nix build failed, %s\n' "$_dtne_name" \
                "$([ -e "$_dtne_link" ] && echo 'keeping the previous environment' || echo 'falling back to non-Nix setup')" >&2
        fi
    fi

    _dtne_env="$_dtne_link/share/$_dtne_name/env.sh"
    if [ ! -e "$_dtne_env" ]; then
        unset _dtne_root _dtne_name _dtne_link _dtne_stamp _dtne_env
        return 1
    fi
    export PATH="$_dtne_link/bin:$PATH"
    # shellcheck disable=SC1090
    . "$_dtne_env"
    unset _dtne_root _dtne_name _dtne_link _dtne_stamp _dtne_env
}

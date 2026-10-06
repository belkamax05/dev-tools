# Runs every bin/ shim (`#!/usr/bin/env bun`). From nixos-unstable, which
# tracks the latest bun release (the stable pin lags a minor behind). A repo
# embedding dev-tools that pins its own bun (as an embedding repo may)
# replaces this one: same `bun` name, later module wins.
{ unstable, ... }:

unstable.bun

# node_modules as a Nix build of a lockfile - any package manager's. pkgi
# (`pkgi install --nix`, apps/pkgi/src/core/nix) reads the lockfile of the
# manager package.json names and writes the manifest this takes:
#
#   tarballs   - every archive the lockfile pins, with the integrity hash
#                the lockfile itself records: each is a fetchurl, so fetched
#                once and verified, network allowed only there
#   files      - the install's inputs besides them (the lockfile, every
#                workspace's package.json, patches, manager config), copied
#                into the store alone - nothing else in the repo can change
#                the result
#   install    - that manager's own frozen install, argv + env, with
#                @REGISTRY@ where the registry URL goes, and `overlay`:
#                files the build copy gets instead of the checkout's (pnpm's
#                release-age check, which needs registry metadata - see
#                pkgi's core/nix)
#   workspaces - the folders whose node_modules become the output
#
# The build is the sandbox's: no network. The tarballs are served back to
# the manager from a local registry on 127.0.0.1 at their usual URL paths,
# so what it installs is exactly - and only - what the lockfile pins. The
# output path is a function of those inputs: the same lockfile (and
# manifests) gives the same path whichever command wrote it, and a
# different one builds - or finds - its own.
#
# Lifecycle scripts of the workspaces themselves (preinstall, prepare...)
# are dropped for the build: they act on the checkout (husky's git hooks),
# not on node_modules, so pkgi runs them there after placing the output.
# Dependencies' own install scripts run as the manager would run them.
{
  pkgs ? import ../nixpkgs.nix { },
  # pkgi's manifest (JSON) and the repo root it describes, as strings.
  manifest,
  root,
}:

let
  inherit (pkgs) lib;
  m = builtins.fromJSON (builtins.readFile manifest);

  rootPath = /. + root;
  wanted = lib.genAttrs m.files (_: true);
  # A folder is kept when some wanted file lies under it.
  isAncestor = rel: lib.any (file: lib.hasPrefix "${rel}/" file) m.files;
  src = builtins.path {
    name = "${m.name}-install-inputs";
    path = rootPath;
    filter =
      path: type:
      let
        rel = lib.removePrefix "${toString rootPath}/" (toString path);
      in
      if type == "directory" then isAncestor rel else wanted ? ${rel};
  };

  # Store names allow fewer characters than archive names use.
  storeName = url: lib.strings.sanitizeDerivationName (baseNameOf url);
  urlPath = url: lib.removePrefix "/" (builtins.elemAt (builtins.match "https?://[^/]+(/.*)" url) 0);

  registry = pkgs.linkFarm "${m.name}-registry" (
    map (t: {
      name = urlPath t.url;
      path = pkgs.fetchurl {
        name = storeName t.url;
        inherit (t) url;
        hash = t.integrity;
      };
    }) m.tarballs
  );

  manager = builtins.storePath m.managerStorePath;

  withRegistry = lib.replaceStrings [ "@REGISTRY@" ] [ "$registry_url" ];
  installEnv = lib.concatStrings (
    lib.mapAttrsToList (key: value: "export ${key}=\"${withRegistry value}\"\n") (m.install.env or { })
  );
  installArgv = lib.concatMapStringsSep " " (arg: "\"${withRegistry arg}\"") m.install.argv;
  overlay = lib.concatStrings (
    lib.mapAttrsToList (
      path: text: "cp ${pkgs.writeText "overlay" text} ${lib.escapeShellArg path}\n"
    ) (m.install.overlay or { })
  );
in
pkgs.runCommand "${m.name}-node-modules"
  {
    nativeBuildInputs = [
      manager
      pkgs.jq
      pkgs.python3
    ];
    workspaces = m.workspaces;
    passthru = { inherit src registry; };
  }
  ''
    export HOME="$TMPDIR/home"
    mkdir -p "$HOME"
    cp -R --no-preserve=mode ${src} work
    cd work
    ${overlay}

    # The workspaces' own lifecycle scripts run in the checkout, not here.
    for ws in $workspaces ""; do
      pkg="''${ws:+$ws/}package.json"
      [ -f "$pkg" ] || continue
      jq 'if .scripts then .scripts |= with_entries(select(.key | test("^(pre|post)?(install|prepare|prepublish)$") | not)) else . end' \
        "$pkg" >"$pkg.tmp" && mv "$pkg.tmp" "$pkg"
    done

    python3 - ${registry} "$TMPDIR/port" <<'PY' &
    import functools, http.server, sys
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
    handler.func.log_message = lambda *args: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    open(sys.argv[2], "w").write(str(server.server_address[1]))
    server.serve_forever()
    PY
    server=$!
    while [ ! -s "$TMPDIR/port" ]; do sleep 0.1; done
    registry_url="http://127.0.0.1:$(cat "$TMPDIR/port")/"

    ${installEnv}
    ${installArgv}
    kill "$server"

    mkdir -p "$out"
    for ws in $workspaces ""; do
      if [ -d "''${ws:+$ws/}node_modules" ]; then
        mkdir -p "$out/$ws"
        cp -RP "''${ws:+$ws/}node_modules" "$out/$ws/"
      fi
    done
  ''

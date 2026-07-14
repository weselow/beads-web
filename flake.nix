{
  description = "Beads Web";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };

          frontend = pkgs.buildNpmPackage {
            pname = "beads-web-frontend";
            version = "0.11.2";
            src = ./.;

            nodejs = pkgs.nodejs_22;
            npmDepsHash = "sha256-q2HY15iKcykBSZjEL6/bDf7oWftXxnsgNQDVtPq64rI=";

            env.NEXT_TELEMETRY_DISABLED = "1";

            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -R out "$out/"
              runHook postInstall
            '';
          };
        in
        {
          default = pkgs.rustPlatform.buildRustPackage {
            pname = "beads-web";
            version = "0.11.2";
            src = ./.;

            cargoLock.lockFile = ./server/Cargo.lock;
            cargoRoot = "server";
            buildAndTestSubdir = "server";

            postPatch = ''
              cp -R ${frontend}/out out
            '';

            nativeBuildInputs = [ pkgs.pkg-config ];
            buildInputs = [
              pkgs.openssl
              pkgs.zlib
            ];

            doCheck = false;

            installPhase = ''
              runHook preInstall
              binary="target/${pkgs.stdenv.hostPlatform.config}/release/beads-server"
              if [ ! -x "$binary" ]; then
                binary="target/release/beads-server"
              fi
              install -Dm755 "$binary" "$out/bin/beads-web"
              runHook postInstall
            '';

            meta = {
              description = "Visual Kanban UI for Beads CLI";
              homepage = "https://github.com/weselow/beads-web";
              mainProgram = "beads-web";
            };
          };
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              cargo
              clippy
              nodejs_22
              openssl
              pkg-config
              rustc
              rustfmt
              zlib
            ];

            env.NEXT_TELEMETRY_DISABLED = "1";
          };
        }
      );
    };
}

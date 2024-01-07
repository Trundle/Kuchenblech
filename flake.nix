{
  description = "A secret sharing service that requires minimal trust.";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-utils = {
      url = "github:numtide/flake-utils";
    };
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };
    crane = {
      url = "github:ipetkov/crane";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay, crane, ... }:
    let
      cargoTOML = builtins.fromTOML (builtins.readFile ./backend/Cargo.toml);
      name = cargoTOML.package.name;

      pkgsFor = system: import nixpkgs {
        inherit system;
        overlays = [
          rust-overlay.overlays.default

          (final: prev: {
            rustToolchain = final.rust-bin.fromRustupToolchainFile ./backend/rust-toolchain;
            craneLib = (crane.mkLib prev).overrideToolchain final.rustToolchain;
          })
        ];
      };

      lib = nixpkgs.lib;
      systems = flake-utils.lib.system;
    in
    lib.foldl lib.recursiveUpdate { } [
      (flake-utils.lib.eachDefaultSystem (system:
        let
          pkgs = pkgsFor system;
        in
        {
          packages.kuchenblech = pkgs.craneLib.buildPackage {
            pname = name;
            src = pkgs.craneLib.cleanCargoSource "${self}/backend";

            postInstall = ''
              mkdir -p $out/share
              cp ${self}/index.html $out/share/
              cp -r ${self}/static $out/share/

              # Otherwise, cargoVendorDir stripping fails
              chmod +w $out/share/static/css \
                $out/share/static/fonts \
                $out/share/static/img \
                $out/share/static/js
            '';

            meta = with lib; {
              maintainers = with maintainers; [ trundle ];
              license = with licenses; [ asl20 ];
              mainProgram = "kuchenblech";
            };
          };

          packages.default = self.packages.${system}.kuchenblech;

          devShells.default = pkgs.mkShell {
            name = "${name}-dev-shell";

            nativeBuildInputs = with pkgs; [
              rustToolchain
            ];
          };
        }))

      (flake-utils.lib.eachSystem [ systems.x86_64-linux ] (system:
        let
          pkgs = pkgsFor system;
        in
        {
          packages.kuchenblech-x86_64-unknown-linux-musl = self.packages.${system}.kuchenblech.overrideAttrs (_: {
            CARGO_BUILD_TARGET = "x86_64-unknown-linux-musl";
          });

          packages.default = self.packages.${system}.kuchenblech-x86_64-unknown-linux-musl;

          checks.module-static-kuchenblech = pkgs.callPackage ./nixos/test.nix {
            kuchenblech = self.packages.${system}.kuchenblech-x86_64-unknown-linux-musl;
            kuchenblechNixosModule = self.nixosModule;
          };
        }))

      (flake-utils.lib.eachSystem [ systems.aarch64-linux systems.x86_64-linux ] (system:
        let
          pkgs = pkgsFor system;
        in
        {
          checks.module-dynamic-kuchenblech = pkgs.callPackage ./nixos/test.nix {
            kuchenblech = self.packages.${pkgs.system}.default;
            kuchenblechNixosModule = self.nixosModule;
          };
        }))

      {
        nixosModule = import ./nixos/module.nix;
        overlays.default = final: _prev: {
          kuchenblech = self.packages.${final.system}.default;
        };
      }
    ];
}

{ config, lib, pkgs, ... }:

let
  cfg = config.services.kuchenblech;
in
with lib; {
  options.services.kuchenblech = {
    enable = mkEnableOption "the kuchenblech service";

    package = mkPackageOption pkgs "kuchenblech" {
      default = [ "kuchenblech" ];
    };

    port = mkOption {
      type = types.port;
      default = 8080;
      description = ''
        Which port Kuchenblech should listen on.
      '';
    };
  };

  config = mkIf cfg.enable {
    systemd.services.kuchenblech = {
      enable = true;
      description = "A minimal-trust secret sharing service.";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      environment = {
        PORT = toString cfg.port;
      };

      serviceConfig = {
        Type = "exec";
        ExecStart = getExe cfg.package;
        Restart = "always";
        WorkingDirectory = "${cfg.package}/share";

        # Set up a chroot jail
        RuntimeDirectory = [ "kuchenblech" ];
        RootDirectory = "%t/kuchenblech";
        BindReadOnlyPaths = [
          cfg.package
          cfg.package.stdenv.cc.libc
        ] ++ cfg.package.buildInputs;

        # BindReadOnlyPaths= prevents this setting from having any effect
        # but it also does not hurt to still restrict it.
        ProtectProc = "noaccess";

        # Service Hardening
        CapabilityBoundingSet = "";
        DeviceAllow = "";
        DevicePolicy = "closed";
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        NoNewPrivileges = true;
        PrivateDevices = true;
        PrivateMounts = true;
        # Needs to listen on socket (and doesn't have socket activation)
        PrivateNetwork = false;
        PrivateTmp = true;
        PrivateUsers = true;
        ProcSubset = "pid";
        ProtectClock = true;
        ProtectControlGroups = true;
        ProtectHome = true;
        ProtectHostname = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        RemoveIPC = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        RestrictSUIDSGID = true;
        SystemCallArchitectures = "native";
        SystemCallErrorNumber = "EPERM";
        SystemCallFilter = [ "@system-service" ];
        UMask = "0066";

        DynamicUser = true;
      };
    };
  };
}

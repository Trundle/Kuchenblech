{ nixosTest
, kuchenblech
, kuchenblechNixosModule
}:
nixosTest {
  name = "kuchenblech-test";

  nodes.machine = { ... }: {
    imports = [ kuchenblechNixosModule ];

    services.kuchenblech = {
      enable = true;
      package = kuchenblech;
    };
  };

  testScript = ''
    machine.wait_for_unit("kuchenblech.service");

    with subtest("kuchenblech service running"):
      machine.succeed("systemctl status kuchenblech.service")

    out = machine.succeed("systemd-analyze security kuchenblech.service")
    print(out)
  '';
}

import { describe, expect, it } from "vitest";

import {
  PLUGIN_NAME,
  redirectUri,
  resolveSsoOptions,
  SsoConfigError,
  type SsoOptions,
} from "./config";

const google = { clientId: "id", clientSecret: "secret" };

function options(overrides: Partial<SsoOptions> = {}): SsoOptions {
  return {
    baseUrl: "https://cms.example",
    providers: { google },
    ...overrides,
  };
}

describe("resolveSsoOptions defaults", () => {
  it("defaults autoProvision off", () => {
    expect(resolveSsoOptions(options()).autoProvision).toBe(false);
  });

  it("defaults verified-email linking on", () => {
    expect(resolveSsoOptions(options()).allowLinkByVerifiedEmail).toBe(true);
  });

  it("lists the configured providers", () => {
    const resolved = resolveSsoOptions(
      options({
        providers: { google, github: { clientId: "a", clientSecret: "b" } },
      })
    );
    expect(resolved.enabledProviders).toEqual(["google", "github"]);
  });

  it("does not count a provider left undefined", () => {
    const resolved = resolveSsoOptions(
      options({ providers: { google, microsoft: undefined } })
    );
    expect(resolved.enabledProviders).toEqual(["google"]);
  });
});

describe("baseUrl validation", () => {
  it("normalises a trailing slash to a bare origin", () => {
    expect(
      resolveSsoOptions(options({ baseUrl: "https://cms.example/" })).baseUrl
    ).toBe("https://cms.example");
  });

  it.each([
    ["a relative value", "/admin"],
    ["a bare host", "cms.example"],
    ["an empty string", ""],
  ])("rejects %s", (_label, baseUrl) => {
    expect(() => resolveSsoOptions(options({ baseUrl }))).toThrow(
      SsoConfigError
    );
  });

  it("rejects a non-http scheme", () => {
    expect(() =>
      resolveSsoOptions(options({ baseUrl: "ftp://cms.example" }))
    ).toThrow(/http or https/);
  });

  it("rejects an origin carrying a path, which would corrupt every redirect URI", () => {
    expect(() =>
      resolveSsoOptions(options({ baseUrl: "https://cms.example/nested" }))
    ).toThrow(/bare origin/);
  });
});

describe("provider validation", () => {
  it("requires at least one provider", () => {
    expect(() => resolveSsoOptions(options({ providers: {} }))).toThrow(
      /at least one provider/
    );
  });

  it("requires a clientId", () => {
    expect(() =>
      resolveSsoOptions(
        options({ providers: { google: { clientId: "", clientSecret: "s" } } })
      )
    ).toThrow(/clientId is required/);
  });

  it("requires a clientSecret", () => {
    expect(() =>
      resolveSsoOptions(
        options({ providers: { google: { clientId: "i", clientSecret: "" } } })
      )
    ).toThrow(/clientSecret is required/);
  });
});

describe("Microsoft tenant validation", () => {
  const microsoft = { clientId: "id", clientSecret: "secret" };

  /**
   * On a multi-tenant authority the issuer is per-tenant, so validating `iss`
   * proves only that some Entra tenant signed the token. Without a `tid`
   * allowlist every Microsoft account in the world satisfies the check, which
   * is a configuration that cannot be made safe at runtime.
   */
  it("refuses a multi-tenant authority with no tenant allowlist", () => {
    expect(() =>
      resolveSsoOptions(options({ providers: { microsoft } }))
    ).toThrow(/allowedTenantIds is required/);
  });

  it("refuses the organizations authority with no tenant allowlist", () => {
    expect(() =>
      resolveSsoOptions(
        options({
          providers: { microsoft: { ...microsoft, tenant: "organizations" } },
        })
      )
    ).toThrow(/allowedTenantIds is required/);
  });

  it("accepts a multi-tenant authority once an allowlist is supplied", () => {
    expect(() =>
      resolveSsoOptions(
        options({
          providers: {
            microsoft: {
              ...microsoft,
              tenant: "common",
              allowedTenantIds: ["guid"],
            },
          },
        })
      )
    ).not.toThrow();
  });

  it("accepts a single-tenant authority without an allowlist", () => {
    expect(() =>
      resolveSsoOptions(
        options({
          providers: {
            microsoft: { ...microsoft, tenant: "contoso.onmicrosoft.com" },
          },
        })
      )
    ).not.toThrow();
  });

  it("treats an empty allowlist as absent", () => {
    expect(() =>
      resolveSsoOptions(
        options({
          providers: {
            microsoft: { ...microsoft, tenant: "common", allowedTenantIds: [] },
          },
        })
      )
    ).toThrow(/allowedTenantIds is required/);
  });
});

describe("auto-provisioning validation", () => {
  it("requires a default role when provisioning is enabled", () => {
    expect(() => resolveSsoOptions(options({ autoProvision: true }))).toThrow(
      /defaultRoleSlug is required/
    );
  });

  it("accepts provisioning with a default role", () => {
    const resolved = resolveSsoOptions(
      options({ autoProvision: true, defaultRoleSlug: "viewer" })
    );
    expect(resolved.autoProvision).toBe(true);
    expect(resolved.defaultRoleSlug).toBe("viewer");
  });
});

describe("redirectUri", () => {
  /**
   * The host mounts the Nextly request handler at `/admin/api`, and the route
   * registry serves a plugin's routes under `/plugins/<package name>`. A value
   * that differs from the provider's registered URI by one character is
   * rejected at the token exchange, so this shape is pinned rather than
   * reconstructed per adapter.
   */
  it("builds the path the route registry actually serves", () => {
    expect(redirectUri("https://cms.example", "google")).toBe(
      `https://cms.example/admin/api/plugins/${PLUGIN_NAME}/callback/google`
    );
  });

  it("differs per provider", () => {
    expect(redirectUri("https://cms.example", "github")).not.toBe(
      redirectUri("https://cms.example", "google")
    );
  });
});

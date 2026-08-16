/**
 * The admin-meta split at the HTTP boundary.
 *
 * `/api/admin-meta` answers before a session exists, because the sign-in
 * screen draws with it. `/api/admin-meta/workspace` describes the installation
 * — mounted plugins and what they contribute, locales, sidebar groups — and
 * requires a session.
 *
 * The property worth pinning is the DISPATCH, not the payload. Both paths
 * begin `admin-meta`, so a handler that matches on the first segment alone
 * answers for the second as well: the authenticated URL then returns the
 * public payload with a 200, which reads exactly like a working route. Only a
 * real Request through the real handler can see that, so these assert the
 * wire.
 *
 * No database is involved — an unauthenticated request is refused before any
 * connection is opened, which is itself part of what these lock in.
 */

import { afterAll, describe, expect, it } from "vitest";

import { createDynamicHandlers } from "../routeHandler";
import { sanitizeConfig } from "../shared/types/config";

const ORIGINAL_DB_DIALECT = process.env.DB_DIALECT;

// sqlite is the one dialect that needs no connection string.
process.env.DB_DIALECT = "sqlite";

afterAll(() => {
  if (ORIGINAL_DB_DIALECT === undefined) delete process.env.DB_DIALECT;
  else process.env.DB_DIALECT = ORIGINAL_DB_DIALECT;
});

function handlers({ withPlugin = false }: { withPlugin?: boolean } = {}) {
  return createDynamicHandlers({
    config: sanitizeConfig({
      collections: [],
      admin: { branding: { logoText: "Acme" } },
      // A plugin contributing BOTH a public client config and a gated page, so
      // the projection has something it must carry and something it must not.
      plugins: withPlugin
        ? ([
            {
              name: "@acme/p",
              version: "1.0.0",
              nextly: "*",
              contributes: {
                admin: {
                  clientConfig: { providerId: "acme-sso" },
                  pages: [
                    {
                      path: "settings",
                      component: "AcmeSettings",
                      requiredPermission: "manage-acme",
                    },
                  ],
                },
              },
            },
          ] as never)
        : undefined,
    }),
  });
}

/** Next.js hands route segments in as a promise; mirror that shape. */
function ctx(params: string[]) {
  return { params: Promise.resolve({ params }) };
}

function request(path: string) {
  return new Request(`http://localhost/api/${path}`, { method: "GET" });
}

describe("admin-meta split over HTTP", () => {
  it("serves branding without a session", async () => {
    const response = await handlers().GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ logoText: "Acme" });
  });

  it("refuses the workspace route without a session", async () => {
    const response = await handlers().GET(
      request("admin-meta/workspace"),
      ctx(["admin-meta", "workspace"])
    );

    expect(response.status).toBe(401);
  });

  it("does not answer the workspace route from the public handler", async () => {
    // The separating assertion. A first-segment match would return 200 with
    // the branding payload, so status alone cannot tell a working gate from a
    // route that quietly fell through: `logoText` is present in exactly the
    // response that should never be produced here.
    const response = await handlers().GET(
      request("admin-meta/workspace"),
      ctx(["admin-meta", "workspace"])
    );

    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain("Acme");
  });

  it("marks the workspace response as belonging to one session", async () => {
    const response = await handlers().GET(
      request("admin-meta/workspace"),
      ctx(["admin-meta", "workspace"])
    );

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("leaves the public route cacheable", async () => {
    // The separating half. Setting the headers unconditionally would satisfy
    // the case above while telling every cache to skip the one response that
    // is the same for everyone and is fetched before every sign-in.
    const response = await handlers().GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );

    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("vary")).toBeNull();
  });

  it("serves no field outside the branding vocabulary to an anonymous caller", async () => {
    // An ALLOWLIST, deliberately. A list of fields to withhold has to be
    // extended by whoever adds the next one, and plugin authors choose what a
    // contribution carries — so the next sensitive field would be public by
    // default and nothing here would notice. Asserting the whole key set
    // instead means any addition to the public half fails this until someone
    // decides it belongs there.
    const response = await handlers().GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(
      [
        "colors",
        "favicon",
        "logoText",
        "logoUrl",
        "logoUrlDark",
        "logoUrlLight",
        // Permitted, and narrowed by its own pair of cases below: the entries
        // carry a name and a public client config and nothing else.
        "pluginClientConfigs",
      ].filter(key => key in payload)
    );
    // The population clause: a payload that happened to be empty would satisfy
    // the subset assertion above without proving anything was read.
    expect(payload.logoText).toBe("Acme");
  });

  it("serves a plugin's public client config before sign-in", async () => {
    // A plugin may contribute components to the SIGN-IN screen, and those read
    // their own config through the SDK before a session exists. That channel is
    // public by declaration and holds no secrets, so withholding it removes the
    // configuration those components render from.
    const response = await handlers({ withPlugin: true }).GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload.pluginClientConfigs).toEqual([
      { name: "@acme/p", clientConfig: { providerId: "acme-sso" } },
    ]);
    // Under its OWN key. Sharing `plugins` would let these entries stand in
    // for the installed list on the client, where the two halves are merged.
    expect(payload.plugins).toBeUndefined();
  });

  it("withholds everything else about that plugin from the public route", async () => {
    // The separating assertion, and the reason the projection NAMES its two
    // fields rather than deleting the rest: an exact key set fails when a
    // contribution field added later reaches the public payload, which a check
    // for specific forbidden fields would not.
    const response = await handlers({ withPlugin: true }).GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );
    const payload = (await response.json()) as Record<string, unknown>;
    const plugins = payload.pluginClientConfigs as Array<
      Record<string, unknown>
    >;

    expect(Object.keys(plugins[0] ?? {}).sort()).toEqual([
      "clientConfig",
      "name",
    ]);
    expect(JSON.stringify(payload)).not.toContain("manage-acme");
    expect(JSON.stringify(payload)).not.toContain("AcmeSettings");
  });

  it("withholds plugin contributions from the public route", async () => {
    const response = await handlers().GET(
      request("admin-meta"),
      ctx(["admin-meta"])
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(payload.plugins).toBeUndefined();
    expect(payload.showBuilder).toBeUndefined();
    expect(payload.locales).toBeUndefined();
    expect(payload.customGroups).toBeUndefined();
  });
});

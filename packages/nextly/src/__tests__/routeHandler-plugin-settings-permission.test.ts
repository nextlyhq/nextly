/**
 * Which permission a plugin's settings take at the route gate.
 *
 * The checks the gate delegates to are replaced by a fake that admits a
 * caller holding the named permission and refuses everyone else, so each
 * case asserts the OUTCOME for a caller with a given set of grants rather
 * than which function was called.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const granted = vi.hoisted(() => new Set<string>());
/** Whether the caller carries a valid session or key at all. */
const caller = vi.hoisted(() => ({ signedIn: true }));
/** How many times a request made the process boot its services. */
const boots = vi.hoisted(() => ({ count: 0 }));
/**
 * The two places the gate can find the plugins: the config services were
 * registered with, which exists only once a dispatch has booted them, and the
 * config the route handlers were created with, which exists from the start.
 * `undefined` is a source that is not there.
 */
const plugins = vi.hoisted(() => ({
  registered: undefined as unknown[] | undefined,
  handler: undefined as unknown[] | undefined,
  /** What a boot registers, once one runs; none until a case says so. */
  booted: undefined as unknown[] | undefined,
}));

vi.mock("../auth/middleware", async importOriginal => {
  const actual = await importOriginal<typeof import("../auth/middleware")>();
  const admitted = {
    userId: "u1",
    userEmail: "u1@x.com",
    authMethod: "session",
  };
  const refused = { statusCode: 403, error: "Forbidden" };
  const one = async (action: string, resource: string) =>
    granted.has(`${action}-${resource}`) ? admitted : refused;
  const any = async (list: Array<{ action: string; resource: string }>) =>
    list.some(({ action, resource }) => granted.has(`${action}-${resource}`))
      ? admitted
      : refused;
  // Both forms of each check answer alike, whether the gate hands them the
  // request or the caller it already authenticated.
  return {
    ...actual,
    requireAuthentication: vi.fn(async () =>
      caller.signedIn
        ? admitted
        : { statusCode: 401, error: "Authentication required" }
    ),
    requirePermission: vi.fn(
      async (_req: Request, action: string, resource: string) =>
        one(action, resource)
    ),
    authorizeCaller: vi.fn(
      async (_caller: unknown, action: string, resource: string) =>
        one(action, resource)
    ),
    requireAnyPermission: vi.fn(
      async (
        _req: Request,
        list: Array<{ action: string; resource: string }>
      ) => any(list)
    ),
    authorizeCallerForAny: vi.fn(
      async (
        _caller: unknown,
        list: Array<{ action: string; resource: string }>
      ) => any(list)
    ),
  };
});

vi.mock("../dispatcher/dispatcher", async importOriginal => ({
  ...(await importOriginal<typeof import("../dispatcher/dispatcher")>()),
  readServiceConfig: () =>
    plugins.registered === undefined
      ? undefined
      : { plugins: plugins.registered },
}));

vi.mock("../route-handler", async importOriginal => ({
  ...(await importOriginal<typeof import("../route-handler")>()),
  getHandlerConfig: () =>
    plugins.handler === undefined ? null : { plugins: plugins.handler },
  // A boot registers the plugin list its `setup` transformers leave.
  ensureServicesInitialized: async () => {
    boots.count += 1;
    if (plugins.booted !== undefined) plugins.registered = plugins.booted;
  },
}));

import { _resolveAuthorizationForTest as resolveAuthorization } from "../routeHandler";

const settings = z.object({ apiKey: z.string().default("") });

/** Whether a caller holding exactly `grants` gets through. */
async function admits(
  grants: string[],
  httpMethod: "GET" | "PATCH",
  plugin = "@acme/pay"
): Promise<boolean> {
  granted.clear();
  for (const grant of grants) granted.add(grant);
  const result = await resolveAuthorization(
    new Request("http://localhost/api/plugins-settings/x", {
      method: httpMethod,
    }),
    "pluginSettings",
    httpMethod === "GET" ? "getPluginSettings" : "updatePluginSettings",
    httpMethod === "GET" ? "single" : "update",
    { plugin },
    httpMethod
  );
  // `null` is a visitor admitted, which a signed-in request never is.
  return result !== null && !("statusCode" in result);
}

const declared = (): unknown[] => [
  {
    name: "@acme/pay",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: {
      settings,
      permissions: [{ action: "update", resource: "pay-settings" }],
      settingsPermission: "update-pay-settings",
    },
  },
  {
    name: "@acme/plain",
    version: "1.0.0",
    nextly: ">=0.0.1",
    contributes: { settings },
  },
];

beforeEach(() => {
  // A booted process whose handlers were created without a config: the
  // registered config is the only source.
  plugins.registered = declared();
  plugins.handler = undefined;
  plugins.booted = undefined;
  caller.signedIn = true;
  boots.count = 0;
});

describe("a plugin that names its settings permission", () => {
  it("admits a write from a caller holding it", async () => {
    expect(await admits(["update-pay-settings"], "PATCH")).toBe(true);
  });

  it("refuses a write from a caller holding only manage-settings", async () => {
    // The point of naming one: settings kept to a narrower role than every
    // settings administrator.
    expect(await admits(["manage-settings"], "PATCH")).toBe(false);
  });

  it("lets a caller holding it read the settings too", async () => {
    expect(await admits(["update-pay-settings"], "GET")).toBe(true);
  });
});

describe("a plugin that names none", () => {
  it("admits a write from a caller holding manage-settings", async () => {
    expect(await admits(["manage-settings"], "PATCH", "@acme/plain")).toBe(
      true
    );
  });

  it("refuses a write from a caller holding another plugin's permission", async () => {
    // The control for the cases above: a gate that admitted anyone holding
    // any settings-shaped permission would pass them.
    expect(await admits(["update-pay-settings"], "PATCH", "@acme/plain")).toBe(
      false
    );
  });
});

describe("on a cold process, before any dispatch has booted services", () => {
  beforeEach(() => {
    // The first request: the handlers hold the config, and nothing has been
    // registered until the boot runs.
    plugins.registered = undefined;
    plugins.handler = declared();
    plugins.booted = declared();
  });

  it("admits a write from a caller holding the plugin's permission", async () => {
    expect(await admits(["update-pay-settings"], "PATCH")).toBe(true);
  });

  it("refuses a write from a caller holding only manage-settings", async () => {
    // A gate that found no declaration here fell back to core's permission,
    // which admits exactly the caller the plugin's own one keeps out.
    expect(await admits(["manage-settings"], "PATCH")).toBe(false);
  });
});

describe("on a cold process whose setup transformer changed the permission", () => {
  beforeEach(() => {
    // Declared with one permission; a `setup` transformer leaves the plugin
    // naming another, which is the one the dispatch then serves under.
    plugins.registered = undefined;
    plugins.handler = declared();
    plugins.booted = declared().map(plugin => {
      const definition = plugin as {
        name: string;
        contributes?: Record<string, unknown>;
      };
      return definition.name === "@acme/pay"
        ? {
            ...definition,
            contributes: {
              ...definition.contributes,
              permissions: [{ action: "manage", resource: "pay-settings" }],
              settingsPermission: "manage-pay-settings",
            },
          }
        : definition;
    });
  });

  it("refuses a write from a caller holding only the permission as declared", async () => {
    // Judged against the declared list, this first write passed, and the
    // dispatch then performed it under a permission the caller did not hold.
    expect(await admits(["update-pay-settings"], "PATCH")).toBe(false);
  });

  it("admits a write from a caller holding the permission the boot resolved", async () => {
    expect(await admits(["manage-pay-settings"], "PATCH")).toBe(true);
  });
});

describe("a caller with no session or key, on a cold process", () => {
  beforeEach(() => {
    plugins.registered = undefined;
    plugins.handler = declared();
    plugins.booted = declared();
    caller.signedIn = false;
  });

  it.each(["GET", "PATCH"] as const)(
    "is refused on a %s before anything boots",
    async httpMethod => {
      // A request about to be refused for want of a session must not make the
      // process start its services, run its migrations or start plugins.
      const result = await resolveAuthorization(
        new Request("http://localhost/api/plugins-settings/x", {
          method: httpMethod,
        }),
        "pluginSettings",
        httpMethod === "GET" ? "getPluginSettings" : "updatePluginSettings",
        httpMethod === "GET" ? "single" : "update",
        { plugin: "@acme/pay" },
        httpMethod
      );
      expect(result).toMatchObject({ statusCode: 401 });
      expect(boots.count).toBe(0);
    }
  );

  it("boots once the caller is signed in", async () => {
    // The control: a gate that never booted would pass the cases above.
    caller.signedIn = true;
    granted.clear();
    granted.add("update-pay-settings");
    await resolveAuthorization(
      new Request("http://localhost/api/plugins-settings/x", {
        method: "PATCH",
      }),
      "pluginSettings",
      "updatePluginSettings",
      "update",
      { plugin: "@acme/pay" },
      "PATCH"
    );
    expect(boots.count).toBe(1);
  });
});

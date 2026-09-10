/**
 * When an empty plugin registry means "not booted yet" rather than "no routes".
 *
 * Service initialisation is lazy, so the first request an app serves reaches
 * the registry before anything has filled it, and a public plugin route
 * answered 400 there.
 *
 * The cure must not be worse: booting because the app HAS routes would run
 * database and plugin startup for a cold request to any path at all, so
 * anonymous scanning could force that work on demand. The question is about
 * THIS request, answered from the config so no boot is needed to decide
 * whether to boot.
 *
 * @module plugins/routes/should-register
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { pluginRouteBootDecision } from "./should-register";

const plugins = [
  {
    name: "@acme/forms",
    contributes: {
      routes: [
        { method: "POST", path: "/forms/:slug/submit", mount: "root" },
        { method: "GET", path: "/export" },
      ],
    },
  },
] as never;

/** The same shape, but the route is reachable without a session. */
const publicPlugins = [
  {
    name: "@acme/forms",
    contributes: {
      routes: [
        {
          method: "POST",
          path: "/forms/:slug/submit",
          mount: "root",
          public: true,
        },
      ],
    },
  },
] as never;

describe("whether to fill the plugin registry first", () => {
  it("boots for a request a rooted route would answer", () => {
    expect(
      pluginRouteBootDecision(
        plugins,
        {
          method: "POST",
          path: "/forms/contact/submit",
          hasCredential: true,
        },
        "root"
      )
    ).toEqual({ kind: "boot" });
  });

  it("boots for a request a namespaced route would answer", () => {
    expect(
      pluginRouteBootDecision(
        plugins,
        {
          method: "GET",
          path: "/plugins/@acme/forms/export",
          hasCredential: true,
        },
        "plugin"
      )
    ).toEqual({ kind: "boot" });
  });

  it("does NOT boot for a path no declared route matches", () => {
    // The case that makes this a predicate about the request rather than about
    // the app: a cold `/api/garbage` must answer 400 without connecting a
    // database, or scanning it is a way to force startup work.
    expect(
      pluginRouteBootDecision(
        plugins,
        { method: "GET", path: "/garbage", hasCredential: true },
        "root"
      )
    ).toEqual({ kind: "skip" });
  });

  it("does NOT boot when the method is the only thing that differs", () => {
    expect(
      pluginRouteBootDecision(
        plugins,
        {
          method: "GET",
          path: "/forms/contact/submit",
          hasCredential: true,
        },
        "root"
      )
    ).toEqual({ kind: "skip" });
  });

  it("does NOT boot for a disabled plugin's route", () => {
    // A disabled plugin contributes no behaviour, so booting for its path
    // would boot for a route that is never going to answer.
    const disabled = [
      {
        name: "@acme/forms",
        enabled: false,
        contributes: {
          routes: [
            { method: "POST", path: "/forms/:slug/submit", mount: "root" },
          ],
        },
      },
    ] as never;
    expect(
      pluginRouteBootDecision(
        disabled,
        {
          method: "POST",
          path: "/forms/contact/submit",
          hasCredential: true,
        },
        "root"
      )
    ).toEqual({ kind: "skip" });
  });

  /**
   * This used to shortcut on a populated route registry, which is not the same
   * question. `initializePlugins` fills that registry well before
   * `registerServices` finishes seeding permissions and settling migrations, so
   * a second request arriving in that window read a positive count, skipped the
   * single-flight latch, and ran its handler against a half-built runtime.
   *
   * Whether boot has finished belongs to `ensureServicesInitialized`, which
   * holds the latch. This decides only whether a route could answer, so the
   * same config and request give the same verdict at any point during boot.
   * There is no longer a state it could read at the wrong moment.
   */
  it("gives one verdict for one request, whatever boot is doing", () => {
    const ask = () =>
      pluginRouteBootDecision(
        plugins,
        {
          method: "POST",
          path: "/forms/contact/submit",
          hasCredential: true,
        },
        "root"
      );

    expect(ask()).toEqual({ kind: "boot" });
    expect(ask()).toEqual(ask());
  });

  /**
   * The invariant behind the verdict above, stated where re-adding a shortcut
   * would trip it. Any read of the registry here is a read of boot's own
   * intermediate state: it is populated by `initializePlugins`, long before
   * `registerServices` finishes. The completion signal lives with the latch, in
   * `ensureServicesInitialized`, and this module must not grow a second opinion
   * about it.
   */
  it("does not read the route registry to decide", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./should-register.ts", import.meta.url)),
      "utf8"
    );

    // The control: the file was actually found and is the module in question.
    expect(source).toContain("export function pluginRouteBootDecision");
    expect(source).not.toContain("getPluginRouteRegistry");
  });

  it("does not boot for an app that declares no routes", () => {
    expect(
      pluginRouteBootDecision(
        [],
        { method: "GET", path: "/anything", hasCredential: true },
        "root"
      )
    ).toEqual({ kind: "skip" });
    expect(
      pluginRouteBootDecision(
        undefined,
        { method: "GET", path: "/anything", hasCredential: true },
        "root"
      )
    ).toEqual({ kind: "skip" });
  });
});

/**
 * The two mounts are consulted at different points in the request, so a
 * decision made for one must not be made on behalf of the other.
 */
describe("scoped to the mount being consulted", () => {
  it("does not reach a root route from the namespaced pass", () => {
    expect(
      pluginRouteBootDecision(
        publicPlugins,
        {
          method: "POST",
          path: "/forms/contact/submit",
          hasCredential: true,
        },
        "plugin"
      )
    ).toEqual({ kind: "skip" });
  });

  it("does not reach a namespaced route from the root pass", () => {
    expect(
      pluginRouteBootDecision(
        plugins,
        {
          method: "GET",
          path: "/plugins/@acme/forms/export",
          hasCredential: true,
        },
        "root"
      )
    ).toEqual({ kind: "skip" });
  });

  /**
   * The namespaced pass runs BEFORE the built-in router, so a decision it gets
   * wrong is paid for by core's own traffic. Every route it files sits under
   * `/plugins`, which is knowable without running anything -- including for an
   * app whose `setup` transformer makes the route set unknowable.
   */
  it("refuses the namespaced pass a path that cannot be under /plugins", () => {
    const withSetup = [
      { name: "@acme/x", setup: () => ({}), contributes: { routes: [] } },
    ] as never;
    expect(
      pluginRouteBootDecision(
        withSetup,
        { method: "GET", path: "/collections", hasCredential: false },
        "plugin"
      )
    ).toEqual({ kind: "skip" });
  });

  /**
   * `applyPluginConfigTransformers` runs `setup` for every plugin that declares
   * one, without consulting `enabled` - and an existing integration test
   * requires exactly that. So a DISABLED plugin's transformer still runs, and
   * can add routes or enable the plugin that owns them. Filtering the disabled
   * out before looking for transformers answers a question about a config boot
   * is not going to build.
   */
  it("boots for a transformer on a DISABLED plugin", () => {
    const disabledSetup = [
      {
        name: "@acme/x",
        enabled: false,
        setup: () => ({}),
        contributes: { routes: [] },
      },
    ] as never;
    expect(
      pluginRouteBootDecision(
        disabledSetup,
        { method: "GET", path: "/anything-at-all", hasCredential: false },
        "root"
      )
    ).toEqual({ kind: "boot" });
  });

  it("boots when a setup transformer could add the route", () => {
    // `setup` runs during initialisation and may add or alter routes, so what
    // a plugin declares is not the whole set. Only running it can say, which is
    // the thing being decided, so the honest answer is to stop claiming to
    // know. The root pass is reached only once core has declined, so this costs
    // core's traffic nothing.
    const withSetup = [
      { name: "@acme/x", setup: () => ({}), contributes: { routes: [] } },
    ] as never;
    expect(
      pluginRouteBootDecision(
        withSetup,
        { method: "GET", path: "/anything-at-all", hasCredential: false },
        "root"
      )
    ).toEqual({ kind: "boot" });
  });
});

describe("a secure route a caller brought nothing for", () => {
  it("refuses without booting, and names the route that refused", () => {
    // A secure route answers 401 to a credential-free caller, and that answer
    // needs no database. Booting for it would hand an anonymous caller a cold
    // start on every protected endpoint it can name -- while simply not booting
    // would leave the request to the invalid-route 400, answering the same call
    // 400 cold and 401 warm.
    const decision = pluginRouteBootDecision(
      plugins,
      {
        method: "GET",
        path: "/plugins/@acme/forms/export",
        hasCredential: false,
      },
      "plugin"
    );

    expect(decision.kind).toBe("authRequired");
    expect(decision.kind === "authRequired" && decision.route.path).toBe(
      "/export"
    );
  });

  /**
   * A resolver-valued `requiredPermission` names one of the plugin's own
   * collections, so it can only be computed against a booted `ctx.self`. Warm
   * dispatch runs it BEFORE authenticating and fail-closes to 403 when it
   * throws. Refusing 401 from here would hide a broken gate behind a missing
   * credential, and flip the answer as soon as unrelated traffic warmed the
   * process.
   */
  it("boots rather than refusing when the gate is a resolver", () => {
    const resolverGated = [
      {
        name: "@acme/forms",
        contributes: {
          routes: [
            {
              method: "GET",
              path: "/export",
              requiredPermission: () => "create-patterns",
            },
          ],
        },
      },
    ] as never;
    expect(
      pluginRouteBootDecision(
        resolverGated,
        {
          method: "GET",
          path: "/plugins/@acme/forms/export",
          hasCredential: false,
        },
        "plugin"
      )
    ).toEqual({ kind: "boot" });
  });

  it("still refuses when the gate is a fixed slug", () => {
    // The control. A fixed slug cannot throw, so nothing is hidden by deciding
    // here, and the cold start an anonymous caller could force is worth more
    // than the boot.
    const slugGated = [
      {
        name: "@acme/forms",
        contributes: {
          routes: [
            {
              method: "GET",
              path: "/export",
              requiredPermission: "export-submissions",
            },
          ],
        },
      },
    ] as never;
    expect(
      pluginRouteBootDecision(
        slugGated,
        {
          method: "GET",
          path: "/plugins/@acme/forms/export",
          hasCredential: false,
        },
        "plugin"
      ).kind
    ).toBe("authRequired");
  });

  it("boots a PUBLIC route for a caller carrying nothing", () => {
    // The control. A public route is meant to be reached without credentials,
    // so refusing to boot for one would make it permanently unreachable on a
    // cold worker, which is the defect this predicate exists to prevent.
    expect(
      pluginRouteBootDecision(
        publicPlugins,
        {
          method: "POST",
          path: "/forms/contact/submit",
          hasCredential: false,
        },
        "root"
      )
    ).toEqual({ kind: "boot" });
  });
});

/**
 * The registry answers "which route" with the most literal segments. Deciding
 * that differently here means a cold request is judged against one route and
 * served by another, and the difference is invisible until a worker happens to
 * be cold.
 */
describe("reaches the same route the warm registry would", () => {
  const overlapping = [
    {
      name: "@acme/items",
      contributes: {
        routes: [
          // Declared FIRST and secure, so first-match order picks this one.
          { method: "GET", path: "/items/:id", mount: "root" },
          // More literal, so the registry picks THIS one for `/items/count`.
          { method: "GET", path: "/items/count", mount: "root", public: true },
        ],
      },
    },
  ] as never;

  it("prefers the literal route over an earlier capture", () => {
    expect(
      pluginRouteBootDecision(
        overlapping,
        { method: "GET", path: "/items/count", hasCredential: false },
        "root"
      )
    ).toEqual({ kind: "boot" });
  });

  it("still reaches the capture for a path only it matches", () => {
    const decision = pluginRouteBootDecision(
      overlapping,
      { method: "GET", path: "/items/42", hasCredential: false },
      "root"
    );

    expect(decision.kind).toBe("authRequired");
    expect(decision.kind === "authRequired" && decision.route.path).toBe(
      "/items/:id"
    );
  });
});

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
        0,
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
        0,
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
        0,
        plugins,
        { method: "GET", path: "/garbage", hasCredential: true },
        "root"
      )
    ).toEqual({ kind: "skip" });
  });

  it("does NOT boot when the method is the only thing that differs", () => {
    expect(
      pluginRouteBootDecision(
        0,
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
        0,
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

  it("does not boot once the registry holds anything", () => {
    // Every request after the first. An await in front of the match on the hot
    // path would buy nothing, and the warm registry owes the 401 itself.
    expect(
      pluginRouteBootDecision(
        3,
        plugins,
        {
          method: "POST",
          path: "/forms/contact/submit",
          hasCredential: false,
        },
        "root"
      )
    ).toEqual({ kind: "skip" });
  });

  it("does not boot for an app that declares no routes", () => {
    expect(
      pluginRouteBootDecision(
        0,
        [],
        { method: "GET", path: "/anything", hasCredential: true },
        "root"
      )
    ).toEqual({ kind: "skip" });
    expect(
      pluginRouteBootDecision(
        0,
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
        0,
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
        0,
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
        0,
        withSetup,
        { method: "GET", path: "/collections", hasCredential: false },
        "plugin"
      )
    ).toEqual({ kind: "skip" });
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
        0,
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
      0,
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

  it("boots a PUBLIC route for a caller carrying nothing", () => {
    // The control. A public route is meant to be reached without credentials,
    // so refusing to boot for one would make it permanently unreachable on a
    // cold worker, which is the defect this predicate exists to prevent.
    expect(
      pluginRouteBootDecision(
        0,
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
        0,
        overlapping,
        { method: "GET", path: "/items/count", hasCredential: false },
        "root"
      )
    ).toEqual({ kind: "boot" });
  });

  it("still reaches the capture for a path only it matches", () => {
    const decision = pluginRouteBootDecision(
      0,
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

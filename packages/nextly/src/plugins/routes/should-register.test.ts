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

import { shouldRegisterPluginRoutes } from "./should-register";

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
      shouldRegisterPluginRoutes(0, plugins, {
        method: "POST",
        path: "/forms/contact/submit",
        hasCredential: true,
      })
    ).toBe(true);
  });

  it("boots for a request a namespaced route would answer", () => {
    expect(
      shouldRegisterPluginRoutes(0, plugins, {
        method: "GET",
        path: "/plugins/@acme/forms/export",
        hasCredential: true,
      })
    ).toBe(true);
  });

  it("does NOT boot for a path no declared route matches", () => {
    // The case that makes this a predicate about the request rather than about
    // the app: a cold `/api/garbage` must answer 400 without connecting a
    // database, or scanning it is a way to force startup work.
    expect(
      shouldRegisterPluginRoutes(0, plugins, {
        method: "GET",
        path: "/garbage",
        hasCredential: true,
      })
    ).toBe(false);
  });

  it("does NOT boot when the method is the only thing that differs", () => {
    expect(
      shouldRegisterPluginRoutes(0, plugins, {
        method: "GET",
        path: "/forms/contact/submit",
        hasCredential: true,
      })
    ).toBe(false);
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
      shouldRegisterPluginRoutes(0, disabled, {
        method: "POST",
        path: "/forms/contact/submit",
        hasCredential: true,
      })
    ).toBe(false);
  });

  it("does not boot once the registry holds anything", () => {
    // Every request after the first. An await in front of the match on the hot
    // path would buy nothing.
    expect(
      shouldRegisterPluginRoutes(3, plugins, {
        method: "POST",
        path: "/forms/contact/submit",
        hasCredential: true,
      })
    ).toBe(false);
  });

  it("does NOT boot a secure route for a caller carrying nothing", () => {
    // A secure route answers 401 to a credential-free caller, and that answer
    // needs no database. Booting for it would hand an anonymous caller a cold
    // start on every protected endpoint it can name.
    expect(
      shouldRegisterPluginRoutes(0, plugins, {
        method: "GET",
        path: "/plugins/@acme/forms/export",
        hasCredential: false,
      })
    ).toBe(false);
  });

  it("boots a PUBLIC route for a caller carrying nothing", () => {
    // The control. A public route is meant to be reached without credentials,
    // so refusing to boot for one would make it permanently unreachable on a
    // cold worker, which is the defect this predicate exists to prevent.
    expect(
      shouldRegisterPluginRoutes(0, publicPlugins, {
        method: "POST",
        path: "/forms/contact/submit",
        hasCredential: false,
      })
    ).toBe(true);
  });

  it("boots when a setup transformer could add the route", () => {
    // `setup` runs during initialisation and may add or alter routes, so what
    // a plugin declares is not the whole set. Only running it can say, which is
    // the thing being decided, so the honest answer is to stop claiming to know.
    const withSetup = [
      { name: "@acme/x", setup: () => ({}), contributes: { routes: [] } },
    ] as never;
    expect(
      shouldRegisterPluginRoutes(0, withSetup, {
        method: "GET",
        path: "/anything-at-all",
        hasCredential: false,
      })
    ).toBe(true);
  });

  it("does not boot for an app that declares no routes", () => {
    expect(
      shouldRegisterPluginRoutes(0, [], {
        method: "GET",
        path: "/anything",
        hasCredential: true,
      })
    ).toBe(false);
    expect(
      shouldRegisterPluginRoutes(0, undefined, {
        method: "GET",
        path: "/anything",
        hasCredential: true,
      })
    ).toBe(false);
  });
});

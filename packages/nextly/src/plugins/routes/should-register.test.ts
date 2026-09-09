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

describe("whether to fill the plugin registry first", () => {
  it("boots for a request a rooted route would answer", () => {
    expect(
      shouldRegisterPluginRoutes(0, plugins, "POST", "/forms/contact/submit")
    ).toBe(true);
  });

  it("boots for a request a namespaced route would answer", () => {
    expect(
      shouldRegisterPluginRoutes(
        0,
        plugins,
        "GET",
        "/plugins/@acme/forms/export"
      )
    ).toBe(true);
  });

  it("does NOT boot for a path no declared route matches", () => {
    // The case that makes this a predicate about the request rather than about
    // the app: a cold `/api/garbage` must answer 400 without connecting a
    // database, or scanning it is a way to force startup work.
    expect(shouldRegisterPluginRoutes(0, plugins, "GET", "/garbage")).toBe(
      false
    );
  });

  it("does NOT boot when the method is the only thing that differs", () => {
    expect(
      shouldRegisterPluginRoutes(0, plugins, "GET", "/forms/contact/submit")
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
      shouldRegisterPluginRoutes(0, disabled, "POST", "/forms/contact/submit")
    ).toBe(false);
  });

  it("does not boot once the registry holds anything", () => {
    // Every request after the first. An await in front of the match on the hot
    // path would buy nothing.
    expect(
      shouldRegisterPluginRoutes(3, plugins, "POST", "/forms/contact/submit")
    ).toBe(false);
  });

  it("does not boot for an app that declares no routes", () => {
    expect(shouldRegisterPluginRoutes(0, [], "GET", "/anything")).toBe(false);
    expect(shouldRegisterPluginRoutes(0, undefined, "GET", "/anything")).toBe(
      false
    );
  });
});

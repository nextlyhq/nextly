/**
 * When an empty plugin registry means "not booted yet" rather than "no routes".
 *
 * Service initialisation is lazy, so the first request an app serves reaches
 * the registry before anything has filled it. A public plugin route answered
 * 400 there, and a serverless worker repeated that on every cold start.
 *
 * Booting for every unknown path is the wrong cure: it hands an unauthenticated
 * caller a cold start it could not otherwise cause, which is exactly what the
 * initialisation further down `handleServiceRequest` is careful to avoid.
 *
 * @module plugins/routes/should-register
 */
import { describe, expect, it } from "vitest";

import { shouldRegisterPluginRoutes } from "./should-register";

const withRoutes = [{ contributes: { routes: [{ path: "/x" }] } }];
const withoutRoutes = [{ contributes: { widgets: [] } }] as never;

describe("whether to fill the plugin registry first", () => {
  it("boots on a cold registry when a plugin contributes routes", () => {
    expect(shouldRegisterPluginRoutes(0, withRoutes)).toBe(true);
  });

  it("does not boot once the registry holds anything", () => {
    // Every request after the first. Booting again would put an await in front
    // of the match on the hot path for no gain.
    expect(shouldRegisterPluginRoutes(3, withRoutes)).toBe(false);
  });

  it("does not boot for an app that contributes no routes", () => {
    // The control that keeps the cure from being worse: an unknown path on an
    // app with no plugin routes must not connect a database before answering
    // 400 to a caller who presented nothing.
    expect(shouldRegisterPluginRoutes(0, withoutRoutes)).toBe(false);
    expect(shouldRegisterPluginRoutes(0, [])).toBe(false);
    expect(shouldRegisterPluginRoutes(0, undefined)).toBe(false);
  });

  it("reads the routes a plugin declares, not merely that it declares something", () => {
    // An empty array is not a contribution. Treating `contributes` as the
    // signal would boot for every plugin that adds a widget and no route.
    expect(
      shouldRegisterPluginRoutes(0, [{ contributes: { routes: [] } }])
    ).toBe(false);
  });
});

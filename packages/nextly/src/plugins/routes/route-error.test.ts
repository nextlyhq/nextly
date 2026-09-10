import { describe, expect, it } from "vitest";

import { NextlyError } from "../../errors/nextly-error";

import * as routeError from "./route-error";
import { isRouteError } from "./route-error";

describe("isRouteError", () => {
  /**
   * Derived from the module's own exports rather than a list repeated here.
   * A refusal added later is carried into this test by existing, so the way
   * `NEXTLY_ROUTE_UNREACHABLE_ROOT` was missed is not available to it: a
   * constructor absent from the classifier fails here instead of reaching
   * `mountableRoutes` as an unhandled throw.
   */
  it("recognises every refusal this module raises", () => {
    const builders = Object.entries(routeError).filter(
      ([name]) => name !== "isRouteError"
    );

    expect(builders.length).toBeGreaterThan(0);
    for (const [name, build] of builders) {
      const raised = (build as (...args: unknown[]) => unknown)(
        "@acme/plugin",
        "/path",
        ["other"]
      );

      expect(raised, `${name} must build a NextlyError`).toBeInstanceOf(
        NextlyError
      );
      expect(isRouteError(raised), `${name} must be classified`).toBe(true);
    }
  });

  /**
   * The narrowness the classifier exists for. A defect inside the fold must not
   * reach a reader as "this plugin declares bad routes", which sends them to
   * edit a declaration that was never the problem.
   */
  it("does not claim an unrelated failure", () => {
    expect(isRouteError(new TypeError("boom"))).toBe(false);
    expect(
      isRouteError(
        new NextlyError({
          code: "NEXTLY_INTERNAL_ERROR",
          statusCode: 500,
          publicMessage: "x",
          logMessage: "x",
        })
      )
    ).toBe(false);
  });
});

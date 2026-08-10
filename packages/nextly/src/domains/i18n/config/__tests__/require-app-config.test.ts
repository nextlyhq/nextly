// The guard behind "Internationalization requires a `localization` block".
//
// Its default source is the DI container, which is right for every dispatcher
// request. But services are also constructible directly — `CollectionsHandler`
// takes a localization config as a constructor argument — and such an instance
// is fully able to serve localized entities regardless of what any container
// holds. The caller's own answer therefore wins when it has one.

import { describe, expect, it, beforeEach, afterEach } from "vitest";

import { container } from "../../../../di/container";
import { NextlyError } from "../../../../errors";
import {
  assertLocalizationConfigured,
  isAppLocalizationConfigured,
} from "../require-app-config";

const LOCALIZATION = {
  locales: [{ code: "en", label: "English", rtl: false, fallbackLocale: [] }],
  defaultLocale: "en",
  fallback: true,
};

function registerConfig(localization: unknown): void {
  container.register("config", () => ({ localization }));
}

describe("assertLocalizationConfigured", () => {
  beforeEach(() => {
    container.clear();
  });

  afterEach(() => {
    container.clear();
  });

  it("throws a typed validation error when nothing is configured anywhere", () => {
    registerConfig(undefined);

    let thrown: unknown;
    try {
      assertLocalizationConfigured("collection", "posts");
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(NextlyError);
    expect((thrown as NextlyError).logContext).toMatchObject({
      reason: "localization-not-configured",
      entity: "collection",
      slug: "posts",
    });
  });

  it("passes on the container's config when the caller says nothing", () => {
    registerConfig(LOCALIZATION);
    expect(isAppLocalizationConfigured()).toBe(true);
    expect(() =>
      assertLocalizationConfigured("collection", "posts")
    ).not.toThrow();
  });

  // The regression this argument exists for: a handler constructed with its
  // own localization config, in a process whose container has none.
  it("passes on the caller's own config when DI has none", () => {
    registerConfig(undefined);
    expect(() =>
      assertLocalizationConfigured("collection", "posts", true)
    ).not.toThrow();
  });

  // The inverse is deliberately reachable too, so a caller that KNOWS it holds
  // no config is not rescued by an unrelated registration. Call sites that
  // merely don't know pass undefined rather than false.
  it("rejects on an explicit false even when DI is configured", () => {
    registerConfig(LOCALIZATION);
    expect(() =>
      assertLocalizationConfigured("single", "homepage", false)
    ).toThrow(NextlyError);
  });

  it("reads an unregistered container as unconfigured rather than throwing", () => {
    expect(isAppLocalizationConfigured()).toBe(false);
    expect(() => assertLocalizationConfigured("component", "hero")).toThrow(
      NextlyError
    );
  });
});

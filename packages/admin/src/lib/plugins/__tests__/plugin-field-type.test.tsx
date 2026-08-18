/**
 * Which editor a plugin contributes for a field type, and whether that answer
 * is knowable yet.
 *
 * The property under test is not "does it find the component" — a plain lookup
 * does that. It is that the two states which CANNOT support a conclusion are
 * reported as themselves rather than as an empty result, because an empty
 * result is what every caller turned into "no plugin contributes this type".
 *
 * @module lib/plugins/plugin-field-type.test
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePluginFieldType } from "@admin/lib/plugins/plugin-field-type";

/** What the provider reports, mutable so each state can be driven. */
let branding: { plugins?: unknown[] } = {};
let status = {
  isPending: false,
  isUnavailable: false,
  isBrandingUnavailable: false,
};

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => branding,
  useBrandingStatus: () => status,
}));

afterEach(() => {
  branding = {};
  status = {
    isPending: false,
    isUnavailable: false,
    isBrandingUnavailable: false,
  };
});

/** A settled list that contributes an editor for `rating`. */
function withRating() {
  branding = {
    plugins: [
      {
        name: "@acme/p",
        fieldTypes: [{ type: "rating", component: "@acme/p/admin#Rating" }],
      },
    ],
  };
}

describe("usePluginFieldType", () => {
  it("reports the contributed component once the list has arrived", () => {
    withRating();

    const { result } = renderHook(() => usePluginFieldType("rating"));

    expect(result.current).toEqual({
      status: "ready",
      component: "@acme/p/admin#Rating",
    });
  });

  it("reports a type no plugin contributes as READY with no component", () => {
    // The control for every case below. This is the only state in which
    // "unknown field type" is a true statement, and without it the assertions
    // about `loading` and `unavailable` would pass just as well against a hook
    // that never reported `ready` at all.
    withRating();

    const { result } = renderHook(() => usePluginFieldType("nothing-has-this"));

    expect(result.current).toEqual({ status: "ready", component: undefined });
  });

  it("reports a list still in flight as LOADING, not as an empty answer", () => {
    status = { ...status, isPending: true };

    const { result } = renderHook(() => usePluginFieldType("rating"));

    expect(result.current).toEqual({ status: "loading" });
  });

  it("reports a list that never arrived as UNAVAILABLE, not as an empty answer", () => {
    // THE case. `useBranding()` returns `{}` when nothing arrived, so a failed
    // request and a project with no plugins are the same value — and a caller
    // reading it cannot tell "there is no such plugin" from "I could not ask".
    status = { ...status, isUnavailable: true };

    const { result } = renderHook(() => usePluginFieldType("rating"));

    expect(result.current).toEqual({ status: "unavailable" });
  });

  it("prefers LOADING over unavailable while both are set", () => {
    // A request in flight has not failed. Reporting it as unavailable would
    // show a permanent error for the moment every load passes through, and the
    // provider can carry both flags while the two halves settle.
    status = { ...status, isPending: true, isUnavailable: true };

    const { result } = renderHook(() => usePluginFieldType("rating"));

    expect(result.current).toEqual({ status: "loading" });
  });

  it("reports READY with no component for a settled EMPTY list", () => {
    // A project that genuinely installs no plugins. Distinguished from the two
    // states above only by the status flags, which is exactly why they travel.
    branding = {};

    const { result } = renderHook(() => usePluginFieldType("rating"));

    expect(result.current).toEqual({ status: "ready", component: undefined });
  });

  it("ignores a plugin that contributes no field types", () => {
    branding = { plugins: [{ name: "@acme/other" }] };

    const { result } = renderHook(() => usePluginFieldType("rating"));

    expect(result.current).toEqual({ status: "ready", component: undefined });
  });
});

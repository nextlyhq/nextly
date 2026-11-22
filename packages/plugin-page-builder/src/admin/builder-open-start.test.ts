/**
 * The builder opened straight from its address: its code is fetched and its
 * start-up read sent as the admin loads, at that address only, with what the
 * address says of the document and its language.
 */
import { describe, expect, it, vi } from "vitest";

import { builderOpenAddress, startBuilderOpen } from "./builder-open-start";

describe("builderOpenAddress", () => {
  it.each([
    ["/admin/collections/pages/abc/builder", "", true, undefined],
    ["/admin/collections/pages/abc/builder/", "?field=layout", true, undefined],
    ["/admin/singles/home/builder", "?locale=es", false, "es"],
    ["/site/admin/collections/pages/abc/builder", "", true, undefined],
  ])("reads %s%s", (pathname, search, onCollection, locale) => {
    expect(builderOpenAddress(pathname, search)).toEqual({
      onCollection,
      locale,
    });
  });

  it.each([
    "/admin/collections/pages/abc",
    "/admin/collections/pages/abc/versions",
    "/admin/collections/pages/builder",
    "/admin/collections/pages/abc/builder/more",
    "/admin/dashboard",
  ])("names no builder at %s", pathname => {
    expect(builderOpenAddress(pathname, "")).toBeNull();
  });
});

describe("startBuilderOpen", () => {
  it("fetches the code and sends the start-up read at the builder's address", async () => {
    const preload = vi.fn();
    const startReads = vi.fn(async () => undefined);
    startBuilderOpen(
      { pathname: "/admin/collections/pages/abc/builder", search: "" },
      { preload, startReads }
    );
    expect(preload).toHaveBeenCalledTimes(1);
    expect(startReads).toHaveBeenCalledWith({
      onCollection: true,
      locale: undefined,
    });
  });

  it("does nothing anywhere else, or without an address", () => {
    const preload = vi.fn();
    const startReads = vi.fn(async () => undefined);
    startBuilderOpen(
      { pathname: "/admin/collections/pages/abc", search: "" },
      { preload, startReads }
    );
    startBuilderOpen(undefined, { preload, startReads });
    expect(preload).not.toHaveBeenCalled();
    expect(startReads).not.toHaveBeenCalled();
  });

  it("leaves a start-up read that could not be sent to the editor", async () => {
    const startReads = vi.fn(() => Promise.reject(new Error("offline")));
    expect(() =>
      startBuilderOpen(
        { pathname: "/admin/singles/home/builder", search: "" },
        { preload: vi.fn(), startReads }
      )
    ).not.toThrow();
    await Promise.resolve();
  });
});

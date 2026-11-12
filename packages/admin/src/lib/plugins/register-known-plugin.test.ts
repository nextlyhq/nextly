/**
 * `registerKnownPlugin` is deprecated: it keeps working, and says so once.
 *
 * A file of its own because the notice is said once per process: a test
 * calling it earlier in the same file would leave nothing here to observe.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearRegistry,
  hasComponent,
  registerComponent,
  registerKnownPlugin,
} from "./component-registry";

describe("registerKnownPlugin, deprecated", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRegistry();
  });

  it("says once that it is deprecated, naming what replaces it, and registers what it is given at once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Card = () => null;
    const first = vi.fn(async () => {
      registerComponent("@acme/first/admin#Card", Card);
    });
    const second = vi.fn(async () => {});

    registerKnownPlugin("@acme/first", first);
    registerKnownPlugin("@acme/second", second);

    const notices = warn.mock.calls.filter(([message]) =>
      String(message).includes("registerKnownPlugin()")
    );
    expect(notices).toHaveLength(1);
    expect(String(notices[0]?.[0])).toContain("is deprecated");
    expect(String(notices[0]?.[0])).toContain("registerComponents()");

    // Still working, and no longer waiting for a collection to name the
    // plugin: each function runs as it is handed over.
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(hasComponent("@acme/first/admin#Card")).toBe(true)
    );
  });

  it("names a registration that failed, without throwing into the module that called it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      registerKnownPlugin("@acme/broken", async () => {
        throw new Error("no such export");
      })
    ).not.toThrow();

    await vi.waitFor(() =>
      expect(
        warn.mock.calls.some(([message]) =>
          String(message).includes('"@acme/broken"')
        )
      ).toBe(true)
    );
  });

  it("names a registration that throws before it returns, as one that rejects", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() =>
      registerKnownPlugin("@acme/throws-at-once", () => {
        throw new Error("thrown before any promise");
      })
    ).not.toThrow();

    await vi.waitFor(() =>
      expect(
        warn.mock.calls.some(([message]) =>
          String(message).includes('"@acme/throws-at-once"')
        )
      ).toBe(true)
    );
  });
});

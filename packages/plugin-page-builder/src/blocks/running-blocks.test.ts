/**
 * The registry a page builder's readers judge by when its own copy never
 * started: a dev server compiles a route's modules again, and core may judge
 * a save with a field type from that copy, which neither started nor saw a
 * boot. It reads the started site's blocks through the running instance, and
 * refuses only when no site has started at all.
 */
import { createBlockRegistry } from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

/** The running instance as `requireNextly` answers it, or none. */
const running = vi.hoisted(() => ({
  instance: undefined as
    | { plugins: Record<string, Record<string, unknown>> }
    | undefined,
}));

vi.mock("nextly/runtime", () => ({
  requireNextly: () => {
    if (running.instance === undefined) throw new Error("not started");
    return running.instance;
  },
}));

const { runningBlocks } = await import("./registration-service");

/** The started site's blocks, as its page builder offers them. */
const siteBlocks = {
  get: (name: string) =>
    name === "core/text" ? { name: "core/text" } : undefined,
  has: (name: string) => name === "core/text",
  all: () => [{ name: "core/text" }],
};

describe("a page builder whose own copy never started", () => {
  it("reads the started site's blocks through the running instance", () => {
    running.instance = {
      plugins: {
        "@nextlyhq/plugin-page-builder": { "site-blocks": siteBlocks },
      },
    };
    try {
      const reader = runningBlocks(createBlockRegistry());
      expect(reader.has("core/text")).toBe(true);
      expect(reader.all()).toEqual([{ name: "core/text" }]);
    } finally {
      running.instance = undefined;
    }
  });

  it("refuses, rather than answering no blocks, while no site has started", () => {
    expect(() => runningBlocks(createBlockRegistry()).all()).toThrow(
      "has not started"
    );
  });
});

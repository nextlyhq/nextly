/**
 * The three ways to reach an instance, each published where its callers are.
 *
 * `getCachedNextly` looks like it belongs beside `requireNextly` on
 * `nextly/runtime`: both read an already-booted runtime rather than starting
 * one, and a note in the tracker proposed exactly that, on the grounds that a
 * root export documenting itself as internal cannot be reasoned about.
 *
 * Moving it would be wrong, and the reason is not visible from either function.
 * `nextly/runtime` is the entry allowed to import `next/*`, and its own
 * contract says plugin authors should import from the ROOT so their consumers
 * are not forced into a `next` peer dependency. A plugin reading a document
 * outside a route has no `ctx.services` and needs this function, so putting it
 * behind the runtime entry would charge every such plugin a Next.js dependency.
 *
 * So the placement is asserted, with the reason written down beside it. A
 * future reader following the tracker note fails here rather than shipping the
 * peer dependency.
 */

import { describe, expect, it } from "vitest";

describe("instance accessors are published where their callers can reach them", () => {
  it("keeps the async accessor on the Node-safe root, for plugins", async () => {
    const root = (await import("../index")) as Record<string, unknown>;

    expect(typeof root.getCachedNextly).toBe("function");
    // The initialiser is the one an application reaches for, and shares the
    // entry. Asserted together so a change that moves either is visible here.
    expect(typeof root.getNextly).toBe("function");
  });

  it("keeps the synchronous accessor on the runtime entry", async () => {
    const runtime = (await import("../runtime")) as Record<string, unknown>;

    expect(typeof runtime.requireNextly).toBe("function");
  });

  it("does not publish the synchronous accessor from the root", async () => {
    // The control. If the root carried both, this file would be asserting a
    // separation that does not exist, and the reason above would be describing
    // a boundary nothing enforces.
    const root = (await import("../index")) as Record<string, unknown>;

    expect(root.requireNextly).toBeUndefined();
  });

  it("states in its own docs who the async accessor is for", async () => {
    // The claim this file exists to protect is an argument, and an argument
    // lives in prose. Read from source rather than trusted to review: the
    // sentence it replaced said the opposite, and was wrong for years.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../init.ts", import.meta.url)),
      "utf8"
    );

    const docblock = source.slice(
      0,
      source.indexOf("export async function getCachedNextly")
    );

    expect(docblock).toContain("plugin authors");
    expect(docblock).not.toContain("Do NOT use this in user code");
  });
});

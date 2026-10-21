/**
 * Work shared within one batch: once per key, per source, per batch, and never
 * a failure kept for the next asker.
 */
import { describe, expect, it, vi } from "vitest";

import { createBatchScope } from "../batch-scope";

describe("a batch's shared work", () => {
  it("runs a key's work once, however many ask for it at the same time", async () => {
    const scope = createBatchScope().forSource("plugin:seo/issues");
    const compute = vi.fn(async () => 42);
    const answers = await Promise.all([
      scope.getOrCompute("scan", compute),
      scope.getOrCompute("scan", compute),
      scope.getOrCompute("scan", compute),
    ]);
    expect(answers).toEqual([42, 42, 42]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("keeps two sources apart, even when they choose the same key", async () => {
    const batch = createBatchScope();
    const one = await batch
      .forSource("plugin:acme/a")
      .getOrCompute("rows", async () => "a's rows");
    const two = await batch
      .forSource("plugin:acme/b")
      .getOrCompute("rows", async () => "b's rows");
    expect([one, two]).toEqual(["a's rows", "b's rows"]);
  });

  it("keeps two sources apart whatever characters their ids and keys hold", async () => {
    // A source id and a key are both arbitrary strings, so no separator joined
    // between them can be one neither contains.
    const batch = createBatchScope();
    const one = await batch
      .forSource("plugin:a")
      .getOrCompute("b\u0000c", async () => "the first source's");
    const two = await batch
      .forSource("plugin:a\u0000b")
      .getOrCompute("c", async () => "the second source's");
    expect([one, two]).toEqual(["the first source's", "the second source's"]);
  });

  it("keeps two batches apart: nothing one computed reaches the other", async () => {
    const first = createBatchScope().forSource("system:versions");
    const second = createBatchScope().forSource("system:versions");
    await first.getOrCompute(
      "readable-scope",
      async () => "the first caller's"
    );
    const compute = vi.fn(async () => "the second caller's");
    expect(await second.getOrCompute("readable-scope", compute)).toBe(
      "the second caller's"
    );
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failure: the next asker runs the work again", async () => {
    const scope = createBatchScope().forSource("system:versions");
    await expect(
      scope.getOrCompute("k", async () => {
        throw new Error("registry unreachable");
      })
    ).rejects.toThrow("registry unreachable");
    expect(await scope.getOrCompute("k", async () => "recovered")).toBe(
      "recovered"
    );
  });

  it("fails an asker whose work throws before it returns a promise, and keeps nothing", async () => {
    const scope = createBatchScope().forSource("plugin:acme/a");
    await expect(
      scope.getOrCompute("k", () => {
        throw new Error("thrown at once");
      })
    ).rejects.toThrow("thrown at once");
    expect(await scope.getOrCompute("k", async () => "second try")).toBe(
      "second try"
    );
  });
});

/**
 * A post-commit hook failure reaches the caller as a warning.
 *
 * The founder's rule for gap L: the row is durable and a side-effect phase
 * cannot change it, so the operation reports SUCCESS and the failure travels
 * beside it. A side effect that silently did not run is the outcome this has to
 * avoid, so "it is in the logs" is not sufficient -- an integration cannot read
 * the server log.
 *
 * Driven through the Direct API rather than a unit double, because what is
 * under test is that the failure survives the whole distance from the hook
 * registry to the caller's result. A test that called the registry directly
 * would prove the collector works and say nothing about whether anything is
 * connected to it.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../collections/config/define-collection";
import { text } from "../../collections/fields";
import { NextlyError } from "../../errors/nextly-error";
import { createTestNextly, type TestNextly } from "../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(hook: () => never | void): Promise<TestNextly> {
  return createTestNextly({
    collections: [
      defineCollection({
        slug: "notes",
        fields: [text({ name: "body" })],
        hooks: { afterChange: [hook] },
      }),
    ],
  });
}

describe("a post-commit hook failure is reported as a warning", () => {
  it("returns the row AND the warning when an afterChange hook throws", async () => {
    current = await boot(() => {
      throw NextlyError.internal({ logContext: { detail: "secret-detail" } });
    });

    const created = await current.nextly.create({
      collection: "notes",
      data: { title: "kept", body: "kept" },
    });

    // The write stands: reporting failure for a durable row is what invites a
    // retry that writes it twice.
    expect(created.item).toBeDefined();
    expect(created.warnings).toHaveLength(1);
    expect(created.warnings?.[0]).toMatchObject({
      phase: "afterCreate",
      collection: "notes",
      code: "INTERNAL_ERROR",
    });
  });

  it("carries no warnings field when every hook succeeds", async () => {
    current = await boot(() => {});

    const created = await current.nextly.create({
      collection: "notes",
      data: { title: "fine", body: "fine" },
    });

    expect(created.item).toBeDefined();
    // Absent rather than empty, so an ordinary result is byte-for-byte what it
    // was before warnings existed.
    expect(created.warnings).toBeUndefined();
  });

  it("keeps private diagnostics off the warning", async () => {
    current = await boot(() => {
      throw NextlyError.internal({ logContext: { detail: "secret-detail" } });
    });

    const created = await current.nextly.create({
      collection: "notes",
      data: { title: "kept", body: "kept" },
    });

    // `logContext` is where a thrower puts identifier-bearing detail, and the
    // warning is a public shape. The operator gets the full error from the log
    // written at the point it was caught.
    const serialized = JSON.stringify(created.warnings);
    expect(serialized).not.toContain("secret-detail");
    expect(serialized).not.toContain("logContext");
  });
});

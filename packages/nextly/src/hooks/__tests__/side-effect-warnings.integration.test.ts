/**
 * A post-commit hook failure reaches the caller as a warning.
 *
 * A side-effect phase runs after the transaction has committed, so a handler
 * throwing there cannot un-save the row. The operation therefore reports
 * success and the failure travels beside it: reporting failure for a durable
 * write invites a retry that writes it twice, and reporting nothing hides a
 * side effect that did not run.
 *
 * Driven through the Direct API rather than a unit double, because what is
 * under test is that the failure survives the whole distance from the hook
 * registry to the caller's result. A test calling the registry directly would
 * prove the collector works and say nothing about whether anything is
 * connected to it.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection } from "../../collections/config/define-collection";
import { defineSingle } from "../../singles/config/define-single";
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

describe("a single reports its post-commit failures the same way", () => {
  it("returns the envelope AND the warning when a single's hook throws", async () => {
    // Singles run the same post-commit phases as collections and report a
    // failure the same way, through the same mutation envelope.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "site-settings",
          fields: [text({ name: "siteName" })],
          hooks: {
            afterChange: [
              () => {
                throw NextlyError.internal({
                  logContext: { detail: "single-secret" },
                });
              },
            ],
          },
        }),
      ],
    });

    const updated = await current.nextly.updateSingle({
      slug: "site-settings",
      data: { siteName: "Saved anyway" },
    });

    expect(updated.item).toBeDefined();
    expect(updated.warnings).toHaveLength(1);
    // `collection` carries the registry key, which for a single is namespaced.
    // Asserted rather than loosened: a collection and a single may share a
    // slug, so the bare slug would not tell a consumer which one failed.
    expect(updated.warnings?.[0]).toMatchObject({
      phase: "afterUpdate",
      collection: "single:site-settings",
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(updated.warnings)).not.toContain("single-secret");
  });
});

describe("every mutation shape reports its failures, not just the single-item ones", () => {
  it("reports a where-based delete's failures on DeleteResult", async () => {
    // Deleting by query is a different service call from deleting by id, and
    // both run the same `afterDelete` hooks, so both report a failure.
    //
    // The hook is registered on `afterDelete`: `afterChange` maps to the
    // create and update phases and would never run here.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          fields: [text({ name: "body" })],
          hooks: {
            afterDelete: [
              () => {
                throw NextlyError.internal({
                  logContext: { detail: "delete-secret" },
                });
              },
            ],
          },
        }),
      ],
    });

    const created = await current.nextly.create({
      collection: "notes",
      data: { title: "doomed", body: "doomed" },
    });

    const deleted = await current.nextly.delete({
      collection: "notes",
      where: { id: { equals: (created.item as { id: string }).id } },
    });

    expect("ids" in deleted && deleted.ids).toHaveLength(1);
    expect("warnings" in deleted && deleted.warnings).toHaveLength(1);
    expect(JSON.stringify(deleted)).not.toContain("delete-secret");
  });

  it("reports an in-process bulkDelete's failures on BulkOperationResult", async () => {
    // `failures` is per-ITEM and stays empty here: every row really was
    // deleted, and only the side effect failed.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          fields: [text({ name: "body" })],
          hooks: {
            afterDelete: [
              () => {
                throw NextlyError.internal({
                  logContext: { detail: "bulk-secret" },
                });
              },
            ],
          },
        }),
      ],
    });

    const created = await current.nextly.create({
      collection: "notes",
      data: { title: "doomed", body: "doomed" },
    });

    const result = await current.nextly.bulkDelete({
      collection: "notes",
      ids: [(created.item as { id: string }).id],
    });

    expect(result.successes).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    // Bulk items run concurrently, so warning order cannot be matched against
    // the ordered `successes`. The id is what lets a caller remediate the
    // specific durable row rather than all of them.
    expect(result.warnings?.[0]?.entryId).toBe(
      (created.item as { id: string }).id
    );
    expect(JSON.stringify(result)).not.toContain("bulk-secret");
  });
});

describe("a field-level afterChange failure does not fail the write", () => {
  it("saves the row, reports the warning, and does not throw", async () => {
    // A field-level `afterChange` runs once the row is durable, so a throw
    // there must not fail the operation: doing so reports an error for a write
    // that happened, and makes a bulk operation classify a committed row as
    // failed.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          fields: [
            text({
              name: "body",
              hooks: {
                afterChange: [
                  () => {
                    throw NextlyError.internal({
                      logContext: { detail: "field-secret" },
                    });
                  },
                ],
              },
            }),
          ],
        }),
      ],
    });

    const created = await current.nextly.create({
      collection: "notes",
      data: { title: "kept", body: "kept" },
    });

    // The write stands.
    expect(created.item).toBeDefined();
    // And the failure is reported rather than swallowed.
    expect(created.warnings).toHaveLength(1);
    expect(created.warnings?.[0]).toMatchObject({
      phase: "afterCreate",
      collection: "notes",
      // Named by the same row id an entity-level handler's warning carries.
      // Three independent producers build these failures, and a caller cannot
      // tell which produced one, so all three have to name the row or the
      // field is unreliable.
      entryId: (created.item as { id: string }).id,
    });
    expect(JSON.stringify(created.warnings)).not.toContain("field-secret");
  });
});

describe("a single's field-level failure names the same entity as its own hooks", () => {
  it("uses the namespaced registry key, not the bare slug", async () => {
    // A field-level handler and an entity-level handler on the same write must
    // name the entity identically, or a consumer classifies the warning by
    // where the hook happened to be declared. The bare slug would also
    // collide with a collection sharing it.
    current = await createTestNextly({
      singles: [
        defineSingle({
          slug: "site-settings",
          fields: [
            text({
              name: "siteName",
              hooks: {
                afterChange: [
                  () => {
                    throw NextlyError.internal({});
                  },
                ],
              },
            }),
          ],
        }),
      ],
    });

    const updated = await current.nextly.updateSingle({
      slug: "site-settings",
      data: { siteName: "Saved anyway" },
    });

    expect(updated.item).toBeDefined();
    expect(updated.warnings).toHaveLength(1);
    expect(updated.warnings?.[0]).toMatchObject({
      phase: "afterUpdate",
      collection: "single:site-settings",
    });
  });
});

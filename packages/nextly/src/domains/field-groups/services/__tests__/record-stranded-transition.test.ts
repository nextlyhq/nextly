/**
 * The decision taken when a schema transition committed and recording it did not.
 *
 * 🔴 Each ending tells the operator to do something DIFFERENT, so conflating any two is worse than
 * the original failure: "marked" says reconcile and do not retry, "advanced" says reload before
 * touching anything because the change probably landed, and "unrecorded" says the log is the only
 * trace. A test that asserted merely "it throws" would pass on an implementation that always
 * reported the same one.
 *
 * Two callers depend on this — the metadata service's update and the builder's apply — which is why
 * it is tested here rather than through either of them.
 */
import { describe, expect, it, vi } from "vitest";

import type { FieldGroupRegistryService } from "../field-group-registry-service";
import { recordStrandedTransition } from "../record-stranded-transition";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/** A registry whose two consulted methods are supplied per case. */
function registryOf(over: {
  updateComponentIfVersion?: unknown;
  getComponent?: unknown;
}) {
  return {
    updateComponentIfVersion: vi.fn(),
    getComponent: vi.fn(),
    ...over,
  } as unknown as FieldGroupRegistryService;
}

function run(
  registry: FieldGroupRegistryService,
  readBackSettled: () => Promise<unknown>
) {
  return recordStrandedTransition({
    registry,
    logger,
    slug: "hero",
    expectedSchemaVersion: 4,
    tableName: "comp_hero",
    wasLocalized: false,
    cause: new Error("write failed"),
    readBackSettled: readBackSettled as () => Promise<never | null>,
  });
}

describe("recordStrandedTransition", () => {
  it("marks the group diverged at the version the edit started from", async () => {
    const updateComponentIfVersion = vi.fn(async () => ({ matched: true }));
    const registry = registryOf({ updateComponentIfVersion });

    await expect(run(registry, async () => null)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });

    // The predicate is the edit's OWN version. Marking at whatever the row happens to say now
    // would overwrite a concurrent writer's state rather than recording this failure against it.
    expect(updateComponentIfVersion).toHaveBeenCalledWith(
      "hero",
      { migrationStatus: "diverged" },
      4,
      { source: "code" }
    );
    await expect(run(registry, async () => null)).rejects.toThrow(
      /marked as diverged/
    );
  });

  it("returns the row when it turns out to already carry the edit", async () => {
    // The write landed and the raise was in reading it back — routine on MySQL, whose update is an
    // UPDATE followed by a SELECT. This is the ONE path that must not throw: the caller may report
    // success, because the edit really is recorded.
    const settled = { slug: "hero", schemaVersion: 5 };
    const registry = registryOf({
      updateComponentIfVersion: vi.fn(async () => ({ matched: false })),
    });

    await expect(run(registry, async () => settled)).resolves.toEqual({
      record: settled,
    });
  });

  it("re-marks at the version now stored when another writer moved the row", async () => {
    const updateComponentIfVersion = vi
      .fn()
      .mockResolvedValueOnce({ matched: false })
      .mockResolvedValueOnce({ matched: true });
    const registry = registryOf({
      updateComponentIfVersion,
      getComponent: vi.fn(async () => ({ schemaVersion: 9 })),
    });

    await expect(run(registry, async () => null)).rejects.toThrow(
      /marked as diverged/
    );
    // Second attempt uses the version just READ, because the row is past the edit's by definition.
    expect(updateComponentIfVersion).toHaveBeenLastCalledWith(
      "hero",
      { migrationStatus: "diverged" },
      9,
      { source: "code" }
    );
  });

  it("says the row advanced when it moved again before it could be marked", async () => {
    const registry = registryOf({
      updateComponentIfVersion: vi.fn(async () => ({ matched: false })),
      getComponent: vi.fn(async () => ({ schemaVersion: 9 })),
    });

    // Distinct from "marked": this operator must RELOAD, not reconcile, because the change was
    // probably recorded — and the group may equally have been deleted.
    await expect(run(registry, async () => null)).rejects.toThrow(
      /no longer at the version this edit started from/
    );
  });

  it("admits when nothing at all could be recorded", async () => {
    const registry = registryOf({
      updateComponentIfVersion: vi.fn(async () => {
        throw new Error("database unreachable");
      }),
    });

    // The worst ending, and the one that must never be reported as either of the others: the group
    // reads as though nothing happened.
    await expect(run(registry, async () => null)).rejects.toThrow(
      /neither the change nor the failure could be recorded/
    );
  });

  it("never reports the edit as applied, whichever ending it reaches", async () => {
    // The property the builder's apply path was violating: it returned "Schema applied" while the
    // row still described the previous shape. No ending here may resolve except the settled one.
    const endings = [
      registryOf({
        updateComponentIfVersion: vi.fn(async () => ({ matched: true })),
      }),
      registryOf({
        updateComponentIfVersion: vi.fn(async () => ({ matched: false })),
        getComponent: vi.fn(async () => ({ schemaVersion: 9 })),
      }),
      registryOf({
        updateComponentIfVersion: vi.fn(async () => {
          throw new Error("down");
        }),
      }),
    ];

    for (const registry of endings) {
      await expect(run(registry, async () => null)).rejects.toBeInstanceOf(
        Error
      );
    }
  });
});

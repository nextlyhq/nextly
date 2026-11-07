/**
 * A write of the site style that drops a variable or a shared style is
 * judged under the composition graph lock: what it drops is told from the two
 * stored forms in hand, the lock is taken before the stored documents are
 * read, a use found refuses it as in use, and a read that fails or does not
 * answer refuses it too.
 *
 * The lock itself is the database's, which the integration suite
 * (`__tests__/site-style-removal-lock.integration.test.ts`) drives with two
 * writers; here it is recorded, so the order of the lock and the read shows.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GRAPH_SNAPSHOT_RACED,
  isGraphSnapshotRefusal,
} from "./composition-graph-lock";
import type { StoredUse } from "./shared-style-rescan";
import {
  DESIGN_CHANGED,
  REMOVAL_RESCAN_MS,
  refuseRemovalsInUse,
  registerSiteStyleRemovalLock,
  type SiteStyleRemovalLockSetup,
} from "./site-style-removal-lock";

/** What happened, in order: the lock taken, the stored documents read. */
const order = vi.hoisted(() => [] as string[]);

/** What the lock throws next, when a test makes it refuse. */
const lockRefuses = vi.hoisted(() => ({ next: undefined as unknown }));

// The lock is recorded; what tells its refusals apart is the module's own.
vi.mock("./composition-graph-lock", async importOriginal => ({
  ...(await importOriginal<typeof import("./composition-graph-lock")>()),
  holdCompositionGraph: vi.fn(async () => {
    order.push("lock");
    const refusal = lockRefuses.next;
    lockRefuses.next = undefined;
    if (refusal !== undefined) throw refusal;
  }),
}));

afterEach(() => {
  order.length = 0;
  lockRefuses.next = undefined;
  vi.useRealTimers();
});

const variable = (id: string) => ({
  id,
  name: `color.${id}`,
  kind: "color",
  values: { light: "#123456" },
});
const style = (id: string) => ({
  id,
  slug: id,
  orderIndex: 0,
  styles: { base: { base: { color: "#111111" } } },
});

const HOME: StoredUse = { kind: "collection", slug: "pages", id: "p1" };

/** A setup whose stored documents use what `used` names. */
function setupUsing(
  used: { variables?: StoredUse[]; classes?: StoredUse[] } = {},
  supplied: { variables?: string[]; classes?: string[] } = {}
) {
  const variableUses = vi.fn(async (_ids: readonly string[]) => {
    order.push("variable uses");
    return used.variables ?? [];
  });
  const sharedStyleUses = vi.fn(async (_ids: readonly string[]) => {
    order.push("shared style uses");
    return used.classes ?? [];
  });
  const setup: SiteStyleRemovalLockSetup = {
    suppliedVariables: () => new Set(supplied.variables ?? []),
    suppliedClasses: () => new Set(supplied.classes ?? []),
    variableUses,
    sharedStyleUses,
  };
  return { setup, variableUses, sharedStyleUses };
}

/** An update of the Single from `before` to `after`. */
const update = (
  before: Record<string, unknown>,
  after: Record<string, unknown>
) => ({
  operation: "update" as const,
  originalData: before,
  data: after,
  db: {} as never,
});

describe("a site style write dropping a variable or a shared style", () => {
  it("takes the lock, then reads the stored documents, and passes when nothing uses what it drops", async () => {
    const { setup, variableUses } = setupUsing();
    await refuseRemovalsInUse(
      update(
        { tokens: { tokens: [variable("t-accent"), variable("t-brand")] } },
        { tokens: { tokens: [variable("t-brand")] } }
      ),
      setup,
      "postgresql"
    );
    expect(variableUses).toHaveBeenCalledWith(["t-accent"]);
    expect(order).toEqual(["lock", "variable uses"]);
  });

  it("refuses dropping a variable a stored document uses, with the routes' in-use refusal", async () => {
    const { setup } = setupUsing({ variables: [HOME] });
    await expect(
      refuseRemovalsInUse(
        update(
          { tokens: { tokens: [variable("t-accent")] } },
          { tokens: { tokens: [] } }
        ),
        setup,
        "mysql"
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "",
            code: "IN_USE",
            message: "Still used on 1 page. Remove it from that page first.",
          },
        ],
      },
      logContext: { variableIds: ["t-accent"], uses: ["collection:pages:p1"] },
    });
  });

  it("refuses dropping a shared style a stored document applies, read from the section as SQLite stores it", async () => {
    const { setup, sharedStyleUses, variableUses } = setupUsing({
      classes: [HOME],
    });
    await expect(
      refuseRemovalsInUse(
        update(
          { classes: JSON.stringify([style("c-card"), style("c-hero")]) },
          { classes: JSON.stringify([style("c-hero")]) }
        ),
        setup,
        "sqlite"
      )
    ).rejects.toMatchObject({
      publicData: { errors: [{ code: "IN_USE" }] },
      logContext: { classIds: ["c-card"] },
    });
    expect(sharedStyleUses).toHaveBeenCalledWith(["c-card"]);
    // Nothing of the variables was dropped, so nothing of them was read.
    expect(variableUses).not.toHaveBeenCalled();
  });

  it("takes no lock and reads nothing for a write that drops nothing", async () => {
    const { setup, variableUses, sharedStyleUses } = setupUsing({
      variables: [HOME],
      classes: [HOME],
    });
    await refuseRemovalsInUse(
      update(
        {
          tokens: { tokens: [variable("t-accent")] },
          classes: [style("c-card")],
        },
        {
          // Edited and added to, nothing taken out.
          tokens: {
            tokens: [
              { ...variable("t-accent"), label: "Accent 2" },
              variable("t-new"),
            ],
          },
          classes: [{ ...style("c-card"), label: "Card 2" }, style("c-new")],
        }
      ),
      setup,
      "postgresql"
    );
    expect(order).toEqual([]);
    expect(variableUses).not.toHaveBeenCalled();
    expect(sharedStyleUses).not.toHaveBeenCalled();
  });

  it("takes dropping a stored override of what the code supplies for a reset, which removes nothing", async () => {
    const { setup } = setupUsing(
      { variables: [HOME], classes: [HOME] },
      { variables: ["t-code"], classes: ["c-code"] }
    );
    await refuseRemovalsInUse(
      update(
        {
          tokens: { tokens: [variable("t-code")] },
          classes: [style("c-code")],
        },
        { tokens: { tokens: [] }, classes: [] }
      ),
      setup,
      "postgresql"
    );
    expect(order).toEqual([]);
  });

  it("refuses the removal as a conflict to try again when the stored documents cannot be read", async () => {
    const { setup, variableUses } = setupUsing();
    const lost = new Error("a form could not be read");
    variableUses.mockRejectedValueOnce(lost);
    await expect(
      refuseRemovalsInUse(
        update(
          { tokens: { tokens: [variable("t-accent")] } },
          { tokens: { tokens: [] } }
        ),
        setup,
        "postgresql"
      )
    ).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: DESIGN_CHANGED,
      cause: lost,
      logContext: { cause: "removal-rescan-failed" },
    });
  });

  it("refuses the removal, rather than holding the lock, when the stored documents do not answer in time", async () => {
    vi.useFakeTimers();
    const { setup, sharedStyleUses } = setupUsing();
    sharedStyleUses.mockReturnValueOnce(new Promise(() => undefined));
    const judged = refuseRemovalsInUse(
      update({ classes: [style("c-card")] }, { classes: [] }),
      setup,
      "postgresql"
    );
    const settled = expect(judged).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: DESIGN_CHANGED,
      logContext: { cause: "removal-rescan-timed-out" },
    });
    await vi.advanceTimersByTimeAsync(REMOVAL_RESCAN_MS);
    await settled;
  });

  it("says a lock refused for an old snapshot in its own words, keeping the cause the routes retry on", async () => {
    const raced = NextlyError.conflict({
      reason: "state",
      message: "the lock's own words",
      logContext: { cause: GRAPH_SNAPSHOT_RACED },
    });
    lockRefuses.next = raced;
    const { setup, variableUses } = setupUsing();
    const judged = refuseRemovalsInUse(
      update(
        { tokens: { tokens: [variable("t-accent")] } },
        { tokens: { tokens: [] } }
      ),
      setup,
      "mysql"
    );
    await expect(judged).rejects.toMatchObject({
      code: "CONFLICT",
      publicMessage: DESIGN_CHANGED,
      cause: raced,
      logContext: { cause: GRAPH_SNAPSHOT_RACED },
    });
    await expect(
      judged.catch(error => isGraphSnapshotRefusal(error))
    ).resolves.toBe(true);
    // Refused at the lock: nothing was read.
    expect(variableUses).not.toHaveBeenCalled();
  });

  it("passes any other refusal of the lock on as it is", async () => {
    const other = new Error("the connection was lost");
    lockRefuses.next = other;
    const { setup } = setupUsing();
    await expect(
      refuseRemovalsInUse(
        update({ classes: [style("c-card")] }, { classes: [] }),
        setup,
        "postgresql"
      )
    ).rejects.toBe(other);
  });

  it("is registered for the Single as the host renamed it", () => {
    const onInTransaction = vi.fn();
    registerSiteStyleRemovalLock(
      {
        hooks: { onInTransaction } as never,
        dialect: "postgresql",
        self: { singles: { "site-style": "brand-style" } } as never,
      },
      setupUsing().setup
    );
    expect(onInTransaction).toHaveBeenCalledWith(
      "single:brand-style",
      expect.any(Function)
    );
  });
});

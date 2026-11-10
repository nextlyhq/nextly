/**
 * A write of the site style that drops a variable or a shared style is
 * judged under the composition graph lock: what it drops is told from the two
 * stored forms in hand, the lock is taken before the stored documents are
 * read, a use found refuses it as in use, and a read that fails or does not
 * answer refuses it too. A shared style's variables are judged from the
 * Single as the write leaves it, before any lock: one it adds that the site
 * does not define, and one a removal drops while a shared style names it.
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
import type { StoredDocuments, StoredUse } from "./shared-style-rescan";
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

/** The write's transaction, as the in-transaction phase hands it. */
const TRANSACTION = { transaction: "the write's own" } as never;

/** Stored documents holding nothing, each read recorded. */
function emptyDocuments(): StoredDocuments {
  return {
    collections: async () => {
      order.push("collections");
      return [];
    },
    singles: async () => [],
    rowsAfter: async () => ({ items: [], hasNext: false }),
    rowForms: async () => [],
    singleForms: async () => [],
  };
}

/**
 * A setup whose stored documents use what `used` names, and whose Single
 * stores `stored` on the transaction.
 */
function setupUsing(
  used: { variables?: StoredUse[]; classes?: StoredUse[] } = {},
  supplied: { variables?: string[]; classes?: string[] } = {},
  stored: Record<string, unknown> = {}
) {
  const variableUses = vi.fn(
    async (_ids: readonly string[], _documents: StoredDocuments) => {
      order.push("variable uses");
      return used.variables ?? [];
    }
  );
  const sharedStyleUses = vi.fn(
    async (_ids: readonly string[], _documents: StoredDocuments) => {
      order.push("shared style uses");
      return used.classes ?? [];
    }
  );
  const siteStyleOn = vi.fn(async (_transaction: unknown) => {
    order.push("site style");
    return stored;
  });
  const documentsOn = vi.fn((_write: unknown) => emptyDocuments());
  const setup: SiteStyleRemovalLockSetup = {
    suppliedVariables: () => new Set(supplied.variables ?? []),
    suppliedClasses: () => new Set(supplied.classes ?? []),
    defaults: () => undefined,
    siteStyleOn,
    documentsOn,
    variableUses,
    sharedStyleUses,
  };
  return { setup, variableUses, sharedStyleUses, siteStyleOn, documentsOn };
}

/** An update of the Single from `before` to `after`, made as `user`. */
const update = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  user?: { id: string }
) => ({
  operation: "update" as const,
  originalData: before,
  data: after,
  db: {} as never,
  transaction: TRANSACTION,
  readStored: vi.fn(),
  context: {},
  ...(user === undefined ? {} : { user: user as never }),
});

/** An author: a write made as someone, which the variable guards judge. */
const AUTHOR = { id: "author" };

/** `id` changed to colour with the variable `token`. */
const styleUsing = (id: string, token: string) => ({
  ...style(id),
  styles: { base: { base: { color: { $token: token } } } },
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
    expect(variableUses).toHaveBeenCalledWith(["t-accent"], expect.anything());
    // The Single is read first, on the write's own transaction, to judge what
    // the write leaves there: no other document is asked before the lock.
    expect(order).toEqual(["site style", "lock", "variable uses"]);
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
    expect(sharedStyleUses).toHaveBeenCalledWith(["c-card"], expect.anything());
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
    // The walk's answer is no longer wanted, so its next read is refused
    // rather than reaching the database.
    const documents = sharedStyleUses.mock.calls[0]?.[1] as StoredDocuments;
    await expect(documents.collections()).rejects.toMatchObject({
      logContext: { reason: "stored-document-walk-stopped" },
    });
    expect(order).not.toContain("collections");
  });

  it("walks the documents read on the write's own transaction, and lets them read when in time", async () => {
    const { setup, sharedStyleUses, documentsOn } = setupUsing();
    const write = update({ classes: [style("c-card")] }, { classes: [] });
    await refuseRemovalsInUse(write, setup, "postgresql");
    expect(documentsOn).toHaveBeenCalledWith(write);
    const documents = sharedStyleUses.mock.calls[0]?.[1] as StoredDocuments;
    await expect(documents.collections()).resolves.toEqual([]);
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

describe("a site style write's shared styles and the variables they name", () => {
  it("refuses a shared style adding a variable the Single as written does not define, with the guard's code, taking no lock", async () => {
    const { setup, siteStyleOn } = setupUsing();
    await expect(
      refuseRemovalsInUse(
        update(
          {
            tokens: { tokens: [variable("t-accent"), variable("t-spare")] },
            classes: [style("c-card")],
          },
          // The removal of `t-spare` committed first: the document this write
          // leaves holds its shared style naming it, and no `t-spare`.
          {
            tokens: { tokens: [variable("t-accent")] },
            classes: [styleUsing("c-card", "t-spare")],
          },
          AUTHOR
        ),
        setup,
        "postgresql"
      )
    ).rejects.toMatchObject({
      publicData: {
        errors: [{ path: "classes", code: "unknown-token" }],
      },
    });
    expect(order).toEqual([]);
    expect(siteStyleOn).not.toHaveBeenCalled();
  });

  it("reads the variables on the transaction when the written document does not carry them", async () => {
    const { setup, siteStyleOn } = setupUsing(
      {},
      {},
      {
        tokens: { tokens: [variable("t-accent")] },
      }
    );
    await expect(
      refuseRemovalsInUse(
        update(
          { classes: [style("c-card")] },
          { classes: [styleUsing("c-card", "t-spare")] },
          AUTHOR
        ),
        setup,
        "postgresql"
      )
    ).rejects.toMatchObject({
      publicData: { errors: [{ code: "unknown-token" }] },
    });
    expect(siteStyleOn).toHaveBeenCalledWith(TRANSACTION);
    // CONTROL: the same write is let through where the stored tokens define it.
    const defined = setupUsing(
      {},
      {},
      {
        tokens: { tokens: [variable("t-spare")] },
      }
    );
    await refuseRemovalsInUse(
      update(
        { classes: [style("c-card")] },
        { classes: [styleUsing("c-card", "t-spare")] },
        AUTHOR
      ),
      defined.setup,
      "postgresql"
    );
  });

  it("keeps a reference the shared styles held before, and trusts a write made as nobody, as the guard does", async () => {
    const { setup } = setupUsing();
    const held = {
      tokens: { tokens: [variable("t-accent")] },
      classes: [styleUsing("c-card", "t-gone")],
    };
    // Held already: an edit beside it is let through.
    await refuseRemovalsInUse(
      update(
        held,
        {
          ...held,
          classes: [{ ...styleUsing("c-card", "t-gone"), label: "Card" }],
        },
        AUTHOR
      ),
      setup,
      "postgresql"
    );
    // Added, but made as nobody: trusted, as the guard before the
    // transaction trusts it.
    await refuseRemovalsInUse(
      update(
        {
          tokens: { tokens: [variable("t-accent")] },
          classes: [style("c-card")],
        },
        {
          tokens: { tokens: [variable("t-accent")] },
          classes: [styleUsing("c-card", "t-gone")],
        }
      ),
      setup,
      "postgresql"
    );
    expect(order).toEqual([]);
  });

  it("refuses dropping a variable a shared style in the Single as written still names, as in use, before the lock", async () => {
    const { setup, variableUses } = setupUsing();
    await expect(
      refuseRemovalsInUse(
        // A shared style naming `t-spare` committed first; this write, made
        // as nobody, drops `t-spare` and leaves that shared style as stored.
        update(
          {
            tokens: { tokens: [variable("t-accent"), variable("t-spare")] },
            classes: [style("c-card")],
          },
          {
            tokens: { tokens: [variable("t-accent")] },
            classes: [styleUsing("c-card", "t-spare")],
          }
        ),
        setup,
        "mysql"
      )
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "tokens",
            code: "IN_USE",
            message: expect.stringContaining("used by the shared style c-card"),
          },
        ],
      },
      logContext: { variableIds: ["t-spare"] },
    });
    // From the document in hand: no lock, no read of other documents.
    expect(order).toEqual([]);
    expect(variableUses).not.toHaveBeenCalled();
  });

  it("reads the shared styles on the transaction for that check when the written document does not carry them", async () => {
    const { setup, siteStyleOn } = setupUsing(
      {},
      {},
      {
        classes: [styleUsing("c-card", "t-spare")],
      }
    );
    await expect(
      refuseRemovalsInUse(
        update(
          { tokens: { tokens: [variable("t-accent"), variable("t-spare")] } },
          { tokens: { tokens: [variable("t-accent")] } }
        ),
        setup,
        "postgresql"
      )
    ).rejects.toMatchObject({
      publicData: { errors: [{ code: "IN_USE" }] },
    });
    expect(siteStyleOn).toHaveBeenCalledWith(TRANSACTION);
  });
});

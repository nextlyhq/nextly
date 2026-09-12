/**
 * Refusing the write that closes a loop in the component library.
 *
 * The cases that matter most are the two an author never sees: that the walk
 * reads as the SYSTEM, so a chain running through a component this author
 * cannot see still closes; and that a walk which could not finish REFUSES,
 * because a prefix that did not meet the subject is exactly what a library with
 * no loop looks like.
 *
 * @module component-cycle-guard.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import {
  registerComponentCycleGuard,
  type CycleGuardContext,
} from "./component-cycle-guard";

const COMPONENTS = "nx_pb_components";
const FIELD = "content";

/** A hook registry that records what was registered and runs it. */
function context() {
  const registered: { type: string; collection: string }[] = [];
  let handler: ((context: unknown) => unknown) | null = null;
  const ctx: CycleGuardContext = {
    hooks: {
      on: (type, collection, given) => {
        registered.push({ type, collection });
        handler = given;
      },
    },
  };
  const run = async (hookContext: unknown): Promise<unknown> => {
    if (handler === null) throw new Error("nothing was registered");
    return handler(hookContext);
  };
  return { ctx, registered, run };
}

/** A component document placing the ids given. */
const places = (...ids: string[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: ids.map((componentId, i) => ({
    id: `n${String(i)}`,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  })),
});

/**
 * A definition that places `stored` and EXPOSES that node's componentId.
 *
 * The shape a placement-level override needs on the other end: without a
 * declared exposure there is no id for an override to name.
 */
const exposesItsPlacement = (stored: string) => ({
  ...places(stored),
  exposed: [
    {
      id: "swap",
      label: "Which",
      nodeId: "n0",
      propPath: "componentId",
      type: "select",
    },
  ],
});

/** A document placing `target`, with overrides aimed at the target's exposures. */
const placesWithOverrides = (
  target: string,
  overrides: Record<string, unknown>
) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "n0",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId: target, overrides },
    },
  ],
});

/**
 * A store of components, read by id.
 *
 * `stored` and `draft` are separate so a test can put a reference in one form
 * only — which is the case a single read would miss.
 */
function api(rows: {
  stored?: Record<string, string[]>;
  draft?: Record<string, string[]>;
  unreadable?: readonly string[];
  /** Ids the store no longer holds, which the real API answers by throwing. */
  deleted?: readonly string[];
  /** An id whose read answers with a row claiming to be another. */
  redirect?: Record<string, string>;
  /** Ids whose read answers with a row carrying no `id` at all, as an `afterRead` can. */
  stripId?: readonly string[];
  /** Ids answered with a WHOLE document, for shapes `places()` cannot express. */
  documents?: Record<string, unknown>;
}) {
  const asked: {
    id: string;
    draft: boolean;
    depth: unknown;
    override: unknown;
  }[] = [];
  /** The failures the real store raises rather than answering with. */
  const refuseWhereTheStoreWould = (id: string): void => {
    if (rows.unreadable?.includes(id) === true) {
      throw new Error("this row could not be read");
    }
    // What the real Direct API does for a row that is not there: it THROWS
    // NOT_FOUND unless errors are disabled, rather than answering null.
    if (rows.deleted?.includes(id) === true) {
      throw NextlyError.notFound({ message: `no component ${id}` });
    }
  };

  /**
   * The ids one form of one component places.
   *
   * The real overlay "returns the draft (or the live row when none exists)" —
   * core's own words for it — so a draft read FALLS BACK to the live row rather
   * than answering with nothing. Modelling the two forms as independent stores
   * let a test assert a state the API cannot produce: a component with a live
   * document whose preview read finds none.
   */
  const documentFor = (id: string, draft: boolean): string[] | undefined =>
    draft ? (rows.draft?.[id] ?? rows.stored?.[id]) : rows.stored?.[id];

  const nextly = {
    find: async () => ({ items: [], meta: { hasNext: false } }),
    findByID: async (a: {
      id: string;
      draft?: boolean;
      depth?: number;
      overrideAccess?: boolean;
    }) => {
      asked.push({
        id: a.id,
        draft: a.draft === true,
        depth: a.depth,
        override: a.overrideAccess,
      });
      refuseWhereTheStoreWould(a.id);
      // A document supplied WHOLE, for the exposures and node overrides the
      // `places()` shorthand cannot express. Checked before the shorthand, which
      // answers `null` for any id it holds no entry for.
      const whole = rows.documents?.[a.id];
      if (whole !== undefined) return { id: a.id, [FIELD]: whole };
      const ids = documentFor(a.id, a.draft === true);
      if (ids === undefined) return null;
      // A hook may also remove the id entirely, which leaves a response that
      // cannot be confirmed as the subject's document.
      if (rows.stripId?.includes(a.id) === true) {
        return { [FIELD]: places(...ids) };
      }
      // A hook may answer with a row that is not the one asked for.
      const answeredAs = rows.redirect?.[a.id] ?? a.id;
      return { id: answeredAs, [FIELD]: places(...ids) };
    },
    create: async () => ({}),
    delete: async () => ({}),
    group: async () => ({ groups: [], truncated: false }),
  };
  return { nextly, asked };
}

const register = (ctx: CycleGuardContext) =>
  registerComponentCycleGuard({
    ctx,
    componentsCollection: COMPONENTS,
    documentField: FIELD,
    limits: DEFAULT_LIMITS,
  });

/**
 * An UPDATE of `id`, whose incoming document places `ids`.
 *
 * Names NO status, which is the ordinary editor save: core stores it as a
 * working draft and leaves the live row alone, so it changes the preview graph
 * only.
 */
const saving = (id: string, ids: string[], nextly: unknown) => ({
  collection: COMPONENTS,
  operation: "update",
  originalData: { id },
  data: { [FIELD]: places(...ids) },
  req: { nextly },
});

/** The same write with a status, which reaches the live row as well. */
const publishing = (id: string, ids: string[], nextly: unknown) => ({
  ...saving(id, ids, nextly),
  data: { status: "published", [FIELD]: places(...ids) },
});

/** An UNPUBLISH: it names a status, and the status takes the row out of public reach. */
const unpublishing = (id: string, ids: string[], nextly: unknown) => ({
  ...saving(id, ids, nextly),
  data: { status: "draft", [FIELD]: places(...ids) },
});

/** A status-ONLY publish, which carries no document and promotes the draft. */
const publishingPending = (id: string, nextly: unknown) => ({
  collection: COMPONENTS,
  operation: "update",
  originalData: { id },
  data: { status: "published" },
  req: { nextly },
});

/**
 * A document placing `stored` whose VARIANT re-points that node at `swapped`.
 *
 * The exposure targets the instance node's own `componentId`, which is a
 * supported thing to expose — so the id that resolves when the variant is picked
 * is `swapped`, and `stored` is never read.
 */
const placesViaVariant = (stored: string, swapped: string) => ({
  ...places(stored),
  exposed: [
    { id: "swap", nodeId: "n0", propPath: "componentId", type: "select" },
  ],
  variants: { loop: { label: "Loop", overrides: { swap: swapped } } },
});

describe("saving a component that would reference itself", () => {
  it("registers on beforeChange, for the components collection only", () => {
    // Named rather than the wildcard: a wildcard registration would walk the
    // component graph on every write the site performs.
    const c = context();
    register(c.ctx);

    expect(c.registered).toEqual([
      { type: "beforeChange", collection: COMPONENTS },
    ]);
  });

  it("refuses, naming the chain the author has to break", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["cc"], cc: ["a"] } });

    // `cc` is redacted: the author's document places `b`, and `cc` was reached
    // only by a read made as the system. The actionable half survives — the
    // placement to remove is the first hop, which is always their own.
    await expect(c.run(saving("a", ["b"], nextly))).rejects.toThrow(
      /a → b → … → a/
    );
  });

  it("refuses a component placed inside itself", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: {} });

    await expect(c.run(saving("a", ["a"], nextly))).rejects.toThrow(/a → a/);
  });

  it("allows a save that closes nothing", async () => {
    // The control. Without it, a guard that refused everything would satisfy
    // every refusal case here.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["cc"], cc: [] } });

    await expect(c.run(saving("a", ["b"], nextly))).resolves.toBeUndefined();
  });

  it("reads the DRAFT form too, so a loop only an unpublished edit closes is refused", async () => {
    // The collection keeps drafts, so a component has a stored row and may have
    // a pending edit that references something the stored row does not — and
    // the loop renders as soon as that edit is published.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: [] }, draft: { b: ["a"] } });

    await expect(c.run(saving("a", ["b"], nextly))).rejects.toThrow(
      /a → b → a/
    );
  });

  it("reads as the SYSTEM, without expanding what it does not use", async () => {
    // A component this author cannot see still renders on the page, so a chain
    // running through it is a chain that closes; read as the author it would be
    // invisible and the loop permitted. Depth 0 because the document is read
    // off the row and expanding relationships fetches every referenced row.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({ stored: { b: [] } });

    await c.run(saving("a", ["b"], nextly));

    expect(asked.every(a => a.override === true)).toBe(true);
    expect(asked.every(a => a.depth === 0)).toBe(true);
    // The PREVIEW form only. This save names no status, so core stores it as a
    // working draft and the live row keeps the document it has — reading the
    // live graph as well would judge a form this write does not change.
    expect(asked.map(a => a.draft)).toEqual([true]);
  });

  it("reads BOTH forms when the write names a status, because both change", async () => {
    // The counterpart: a publish writes the live row and consumes the pending
    // draft, so the document lands in both forms and both are judged.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({ stored: { b: [] } });

    await c.run(publishing("a", ["b"], nextly));

    expect(asked.map(a => a.draft).sort()).toEqual([false, true]);
  });

  it("refuses when a component on the way could not be read", async () => {
    // An unread definition names nothing as far as the reader can see, which is
    // what a definition with no loop looks like too. Refusing fails towards not
    // saving, which the author can retry; the other direction admits the loop.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["cc"] }, unreadable: ["cc"] });

    await expect(c.run(saving("a", ["b"], nextly))).rejects.toThrow(
      /could not all be read/
    );
  });

  it("allows a placement of a component nobody supplied", async () => {
    // Absent from both forms is a missing component, which the resolver draws
    // as a placeholder. That is not a loop, and refusing the save would make a
    // deleted component un-saveable-around.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: {} });

    await expect(c.run(saving("a", ["gone"], nextly))).resolves.toBeUndefined();
  });

  it("treats a component the store no longer holds as absent, not as unreadable", async () => {
    /*
     * The Direct API THROWS `NOT_FOUND` for a missing row rather than answering
     * null. Caught as a failure, a saved reference to a component somebody
     * deleted made the graph unknown — so every subsequent save of that
     * component was refused until the reference was taken out by hand, for a
     * state the renderer draws as a missing-component placeholder.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["gone"] }, deleted: ["gone"] });

    await expect(c.run(saving("a", ["b"], nextly))).resolves.toBeUndefined();
  });

  it("judges each lifecycle form on its own, so two forms cannot invent a chain", async () => {
    /*
     * A component's published and draft documents are alternatives: only one is
     * what a reader receives. Unioned, published `b` naming `cc` and DRAFT `cc`
     * naming `a` yield a → b → cc → a out of two references never live
     * together, and a save that closes nothing is refused.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      stored: { b: ["cc"], cc: [] },
      draft: { b: [], cc: ["a"] },
    });

    await expect(c.run(saving("a", ["b"], nextly))).resolves.toBeUndefined();
  });

  it("still refuses a chain that closes WITHIN one form", async () => {
    // The control for the case above: separating the forms must not stop it
    // seeing a loop that is entirely inside one of them. Published here, so the
    // write reaches the live form the loop is in.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      stored: { b: ["cc"], cc: ["a"] },
      draft: { b: [], cc: [] },
    });

    await expect(c.run(publishing("a", ["b"], nextly))).rejects.toThrow(
      /a → b → … → a/
    );
  });

  it("allows a draft edit whose loop exists only in the LIVE form", async () => {
    /*
     * The write core will make is a working draft; the live row keeps the
     * document it has. So live `b` naming `a` closes nothing: the public graph
     * is unchanged, and the preview graph has `b`'s own empty draft in it. The
     * incoming placements applied to the live graph invent a → live b → a and
     * refuse an edit an author is entitled to make.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["a"] }, draft: { b: [] } });

    await expect(c.run(saving("a", ["b"], nextly))).resolves.toBeUndefined();
  });

  it("refuses that same edit once it is PUBLISHED, which is when it goes live", async () => {
    // The other half, and what makes the case above a lifecycle rule rather
    // than a hole: the very same document is refused by the write that puts it
    // in front of readers.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["a"] }, draft: { b: [] } });

    await expect(c.run(publishing("a", ["b"], nextly))).rejects.toThrow(
      /a → b → a/
    );
  });

  it("does NOT judge the published graph when the write UNPUBLISHES", async () => {
    /*
     * `status: "draft"` names a status, so the live row is written and any
     * pending draft is consumed — but the row stops being publicly resolvable,
     * so the component LEAVES the public graph rather than joining it with new
     * edges. A reader following a chain into it gets a missing-component
     * placeholder, not a loop.
     *
     * Judging the published graph here refuses an unpublish that closes
     * nothing: published `b` names `a`, `b`'s own draft is empty, so the only
     * cycle is assembled out of a document no public read can reach.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["a"] }, draft: { b: [] } });

    await expect(
      c.run(unpublishing("a", ["b"], nextly))
    ).resolves.toBeUndefined();
  });

  it("still refuses an unpublish whose loop is in the PREVIEW graph", async () => {
    // The control. Without it, skipping a form for every unpublish would
    // satisfy the case above and let an unpublish close a preview loop.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: [] }, draft: { b: ["a"] } });

    await expect(c.run(unpublishing("a", ["b"], nextly))).rejects.toThrow(
      /a → b → a/
    );
  });

  it("refuses a by-id read whose answer carries no id at all", async () => {
    /*
     * An `afterRead` hook can strip `id`. Accepted, a lookup for `b` retargeted
     * to an acyclic row would stand in for `b`'s placements and the chain
     * through the real `b` would be approved. `recordOf` in
     * `class-usage-runtime.ts` already refuses every response whose id is not
     * the subject's, for the same reason.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: [] }, stripId: ["b"] });

    await expect(c.run(saving("a", ["b"], nextly))).rejects.toThrow(
      /could not all be read/
    );
  });

  it("does not name a component the author's own document never placed", async () => {
    // The walk reads as the system, so a path can run through a component this
    // caller is denied. Printing it would hand them an identifier for the price
    // of a save they already know fails.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["secret"], secret: ["a"] } });

    const refused = await c
      .run(saving("a", ["b"], nextly))
      .then(() => null)
      .catch((error: Error) => error.message);

    expect(refused).toContain("a → b → … → a");
    expect(refused).not.toContain("secret");
  });

  it("collapses a run of private components into ONE gap", async () => {
    // Otherwise the number of ellipses counts them out, which reports the shape
    // of the part of the graph being withheld.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      stored: { b: ["p1"], p1: ["p2"], p2: ["p3"], p3: ["a"] },
    });

    const refused = await c
      .run(saving("a", ["b"], nextly))
      .then(() => null)
      .catch((error: Error) => error.message);

    expect(refused).toContain("a → b → … → a");
  });

  it("refuses an override the PLACEMENT installs on the component it places", async () => {
    /*
     * The edge neither document names. A's node places B and carries overrides
     * aimed at B's exposures; B exposes one of its own nested instances'
     * `componentId`, so the override re-points it at A. A scans as referencing
     * B, B scans as referencing C, and the loop is in neither scan — while the
     * resolver applies the placement's overrides before expanding B and reaches
     * A → B → A.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({ documents: { b: exposesItsPlacement("cc") } });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "update",
        originalData: { id: "a" },
        data: { [FIELD]: placesWithOverrides("b", { swap: "a" }) },
        req: { nextly },
      })
    ).rejects.toThrow(/a → a/);
  });

  it("allows a placement whose override names something harmless", async () => {
    // The control: it is the override's TARGET that decides, not the presence of
    // overrides on a placement. Otherwise every instance the inspector has ever
    // edited would be unsavable.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      documents: { b: exposesItsPlacement("cc") },
      stored: { cc: [] },
    });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "update",
        originalData: { id: "a" },
        data: { [FIELD]: placesWithOverrides("b", { swap: "cc" }) },
        req: { nextly },
      })
    ).resolves.toBeUndefined();
  });

  it("judges the document a status-only publish PROMOTES", async () => {
    /*
     * A publish carrying only `{ status }` is not graph-neutral: core promotes
     * the whole pending working draft into the live row. Read as "no document,
     * nothing to check", a cycle written into a draft before this guard existed
     * — or by a write that skipped it — reaches the live library unexamined.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      stored: { a: [], b: ["a"] },
      draft: { a: ["b"] },
    });

    await expect(c.run(publishingPending("a", nextly))).rejects.toThrow(
      /a → b → a/
    );
  });

  it("allows a status-only publish whose pending draft closes nothing", async () => {
    // The control. Without it a guard that refused every publish would satisfy
    // the case above.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      stored: { a: [], b: [] },
      draft: { a: ["b"] },
    });

    await expect(
      c.run(publishingPending("a", nextly))
    ).resolves.toBeUndefined();
  });

  it("refuses when a by-id read answers with a row claiming another identity", async () => {
    // A `beforeOperation` hook can rewrite the id the query uses and an
    // `afterRead` hook can replace the response, so a lookup for `b` may answer
    // with an unrelated acyclic row — and the loop through the real `b` would be
    // approved on the strength of it.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      stored: { b: [], cc: [] },
      redirect: { b: "cc" },
    });

    await expect(c.run(saving("a", ["b"], nextly))).rejects.toThrow(
      /could not all be read/
    );
  });

  it("allows a bulk write that cannot change the reference graph", async () => {
    // The transaction refusal is about needing a graph READ. A bulk rename or
    // status change carries no document, so there is nothing to read and
    // nothing to refuse.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: {} });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "update",
        originalData: { id: "a" },
        data: { title: "Renamed in bulk" },
        req: { nextly },
        executor: {},
      })
    ).resolves.toBeUndefined();
  });

  it("allows a bulk create the store has not named yet", async () => {
    // Nothing can reference a row that does not exist, so the ordinary create
    // path allows it — and being inside a transaction does not change that.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: {} });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "create",
        data: { [FIELD]: places("b") },
        req: { nextly },
        executor: {},
      })
    ).resolves.toBeUndefined();
  });

  it("refuses inside a caller-owned transaction rather than skipping the check", async () => {
    // The Direct API takes no executor, so a read here waits on the connection
    // the open transaction holds while that transaction waits on this hook.
    // Skipping would let exactly the writes this exists for through, on the
    // path that writes many at once.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: {} });

    await expect(
      c.run({ ...saving("a", ["a"], nextly), executor: {} })
    ).rejects.toThrow(/bulk operation/);
  });

  it("leaves a create alone when the store has not named the row yet", async () => {
    // Nothing can already reference a row that does not exist, so no chain can
    // lead back to it — and there is no id to compare against in any case.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({ stored: { b: ["cc"], cc: [] } });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "create",
        data: { [FIELD]: places("b") },
        req: { nextly },
      })
    ).resolves.toBeUndefined();
    // And it does not pay for a walk it cannot use.
    expect(asked).toEqual([]);
  });

  it("leaves a create alone, even when the caller supplied an id", async () => {
    /*
     * The supplied id is NOT the identity the row gets: every write path spreads
     * `stripImmutableSystemFields` over a freshly generated `id`, and `id` is
     * declared `writableByClient: false`. So a component referencing the
     * supplied value closes no loop through the row being created — it gets a
     * different id, which nothing references — and refusing here reports a chain
     * through a component the author never placed.
     */
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({ stored: { b: ["mine"] } });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "create",
        data: { id: "mine", [FIELD]: places("b") },
        req: { nextly },
      })
    ).resolves.toBeUndefined();
    // And it costs no reads at all: nothing can reference an id the write is
    // about to mint, so there is no graph to walk.
    expect(asked).toEqual([]);
  });

  it("refuses a document whose VARIANT re-points a node at the component itself", async () => {
    /*
     * The raw ids in the document name `b`, and the guard reading only those
     * approves the save. The resolver applies the variant's override BEFORE
     * expanding the nested instance, so what resolves is `a` and the loop is
     * real for every reader who selects that variant.
     */
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: [] } });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "update",
        originalData: { id: "a" },
        data: { [FIELD]: placesViaVariant("b", "a") },
        req: { nextly },
      })
    ).rejects.toThrow(/a → a/);
  });

  it("allows a variant that re-points a node at something harmless", async () => {
    // The control: it is the variant's TARGET that decides, not the presence of
    // a variant. Otherwise any component offering one would be unsavable.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: [], other: [] } });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "update",
        originalData: { id: "a" },
        data: { [FIELD]: placesViaVariant("b", "other") },
        req: { nextly },
      })
    ).resolves.toBeUndefined();
  });

  it("leaves a write carrying no document alone", async () => {
    // A patch that does not touch the blocks field changes no reference, and
    // whether a value is a legal document is the field's own validation to say.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({ stored: {} });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "update",
        originalData: { id: "a" },
        data: { title: "Renamed" },
        req: { nextly },
      })
    ).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("leaves the write alone when the request carries no Direct API", async () => {
    // There is nothing to ask with, and a guard that refused every write it
    // could not evaluate would make the collection unwritable on any path that
    // shapes its context differently.
    const c = context();
    register(c.ctx);

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "update",
        originalData: { id: "a" },
        data: { [FIELD]: places("a") },
        req: {},
      })
    ).resolves.toBeUndefined();
  });

  it("refuses rather than stopping quietly when the graph outruns its read budget", async () => {
    // The bound exists because a library is sized at three thousand entries and
    // nothing stops one component reaching a large share of them. A prefix that
    // did not meet the subject is what a library with no loop looks like, so
    // the budget being spent has to refuse.
    const chain: Record<string, string[]> = {};
    for (let i = 0; i < 400; i += 1)
      chain[`c${String(i)}`] = [`c${String(i + 1)}`];
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: chain });

    await expect(c.run(saving("a", ["c0"], nextly))).rejects.toThrow(
      /could not all be read/
    );
  });

  it("reads each component once however many placements point at it", async () => {
    // The walk is over DISTINCT components. Without that, a library where two
    // components both place a third pays for it twice, and a loop among other
    // components never ends.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({
      stored: { b: ["shared"], cc: ["shared"], shared: [] },
    });

    await c.run(saving("a", ["b", "cc"], nextly));

    // The preview form, which is the one a status-less save changes.
    const ids = asked
      .filter(a => a.draft)
      .map(a => a.id)
      .sort();
    expect(ids).toEqual(["b", "cc", "shared"]);
  });
});

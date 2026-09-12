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
 * A store of components, read by id.
 *
 * `stored` and `draft` are separate so a test can put a reference in one form
 * only — which is the case a single read would miss.
 */
function api(rows: {
  stored?: Record<string, string[]>;
  draft?: Record<string, string[]>;
  unreadable?: readonly string[];
}) {
  const asked: {
    id: string;
    draft: boolean;
    depth: unknown;
    override: unknown;
  }[] = [];
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
      if (rows.unreadable?.includes(a.id) === true) {
        throw new Error("this row could not be read");
      }
      const from = a.draft === true ? rows.draft : rows.stored;
      const ids = from?.[a.id];
      return ids === undefined ? null : { id: a.id, [FIELD]: places(...ids) };
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

/** An UPDATE of `id`, whose incoming document places `ids`. */
const saving = (id: string, ids: string[], nextly: unknown) => ({
  collection: COMPONENTS,
  operation: "update",
  originalData: { id },
  data: { [FIELD]: places(...ids) },
  req: { nextly },
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

    await expect(c.run(saving("a", ["b"], nextly))).rejects.toThrow(
      /a → b → cc → a/
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
    // Both forms of the one component it had to look at.
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

  it("judges a create by the id the caller supplied", async () => {
    // A caller may supply the id, and a component already referencing that id
    // makes the create the write that closes the loop.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ stored: { b: ["mine"] } });

    await expect(
      c.run({
        collection: COMPONENTS,
        operation: "create",
        data: { id: "mine", [FIELD]: places("b") },
        req: { nextly },
      })
    ).rejects.toThrow(/mine → b → mine/);
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

    const ids = asked
      .filter(a => !a.draft)
      .map(a => a.id)
      .sort();
    expect(ids).toEqual(["b", "cc", "shared"]);
  });
});

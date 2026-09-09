import { describe, expect, it } from "vitest";

import {
  registerLayoutComponentGuard,
  type LayoutGuardDirectApi,
} from "./layout-component-guard";

/** A plugin context that captures the handler, and the phase it was given. */
function context() {
  const registered: { type: string; collection: string }[] = [];
  let handler: ((context: unknown) => unknown) | undefined;
  const ctx = {
    hooks: {
      on(type: string, collection: string, h: (context: unknown) => unknown) {
        registered.push({ type, collection });
        handler = h;
      },
    },
  };
  return { ctx, registered, run: (c: unknown) => handler?.(c) };
}

/**
 * A Direct API answering fixed pages, and recording what it was asked.
 *
 * TYPED as the surface the guard consumes, so the fake cannot drift from it.
 * An untyped fake proves only that the guard agrees with the fake: both can
 * state a shape the real API does not have, and the suite then certifies the
 * agreement rather than the behaviour — going green over a scan that finds
 * nothing and allows every delete the guard exists to refuse.
 */
function api(pages: {
  /**
   * Every Layout the enumeration answers, each carrying its OWN `status`.
   *
   * ONE list, not a list per lifecycle state, because one list is what the
   * store holds: `status` is a column on the row, not a separate table. A fake
   * keyed on the requested state can withhold a published Layout from a
   * published read — something no database does — and a scan that never
   * inspects a published Layout at all then looks as though it had.
   */
  layouts?: unknown[];
  /** Working-draft overlays, by Layout id, as `findByID({ draft: true })` answers. */
  pending?: Record<string, unknown>;
}) {
  const asked: {
    collection: string;
    status?: string;
    sort?: string;
    depth?: number;
    override?: boolean;
  }[] = [];
  const overlaid: {
    id: string;
    draft?: boolean;
    depth?: number;
    override?: boolean;
  }[] = [];
  const nextly: LayoutGuardDirectApi = {
    find: async a => {
      asked.push({
        collection: a.collection,
        status: a.status,
        sort: a.sort,
        depth: a.depth,
        override: a.overrideAccess,
      });
      return { items: pages.layouts ?? [], meta: { hasNext: false } };
    },
    findByID: async a => {
      overlaid.push({
        id: a.id,
        draft: a.draft,
        depth: a.depth,
        override: a.overrideAccess,
      });
      return (pages.pending ?? {})[a.id] ?? null;
    },
    create: async () => ({}),
    delete: async () => ({}),
  };
  return { asked, overlaid, nextly };
}

const deleting = (id: string, nextly: unknown) => ({
  data: { id },
  req: { nextly },
});

const layout = (
  id: string,
  title: string,
  componentId: string,
  status: "published" | "draft" = "published"
) => ({
  id,
  title,
  status,
  areas: [{ area: "header", component: componentId }],
});

const register = (ctx: ReturnType<typeof context>["ctx"]) =>
  registerLayoutComponentGuard({
    ctx,
    componentsCollection: "nx_pb_components",
    layoutsCollection: "nx_pb_layouts",
  });

describe("deleting a component a Layout still uses", () => {
  it("registers on beforeDelete, for the components collection only", () => {
    // Named rather than the wildcard: a wildcard registration would run a
    // Layout scan on every delete the site performs.
    const c = context();
    register(c.ctx);

    expect(c.registered).toEqual([
      { type: "beforeDelete", collection: "nx_pb_components" },
    ]);
  });

  it("refuses, naming the Layout the author has to go and edit", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({ layouts: [layout("l1", "Marketing", "cmp")] });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /the Layout "Marketing" uses it/
    );
  });

  it("allows the delete when no Layout names it", async () => {
    // The control. Without it, a guard that refused everything would satisfy
    // every refusal case here.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ layouts: [layout("l1", "Marketing", "other")] });

    await expect(c.run(deleting("cmp", nextly))).resolves.toBeUndefined();
  });

  it("counts a DRAFT Layout, and says which it is", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      layouts: [layout("l2", "Next season", "cmp", "draft")],
    });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /"Next season \(draft\)"/
    );
  });

  it("enumerates every lifecycle state in ONE read, and in a stable order", async () => {
    // `status: "all"` because a published Layout holding unpublished changes
    // keeps its main row published — a draft-scoped read excludes exactly the
    // Layout whose pending edit has to be inspected.
    //
    // `sort` because without one the query service issues no `ORDER BY`, and
    // paging by limit and offset over an unordered result may answer
    // overlapping or disjoint pages: a Layout can fall in the gap and never be
    // seen while the scan still reports that it finished.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({ layouts: [] });

    await c.run(deleting("cmp", nextly));

    expect(asked.map(a => `${a.status}/${a.sort}`)).toEqual(["all/id"]);
  });

  it("reads as the system, or a Layout the user cannot see is invisible", async () => {
    // If the scan ran as the deleting user, a Layout they cannot read would
    // not appear, the delete would be permitted, and every page carrying that
    // Layout would break.
    const c = context();
    register(c.ctx);
    const { nextly, asked, overlaid } = api({
      layouts: [layout("l1", "Marketing", "other")],
    });

    await c.run(deleting("cmp", nextly));

    // BOTH reads, not only the enumeration: the overlay read is what surfaces
    // a pending edit, so one running as the user hides the same Layout.
    expect({
      enumerations: asked.map(a => a.override),
      overlays: overlaid.map(o => o.override),
    }).toEqual({ enumerations: [true], overlays: [true] });
  });

  it("names one Layout once, however many of its areas use the component", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      layouts: [
        {
          id: "l1",
          title: "Marketing",
          status: "published",
          areas: [
            { area: "header", component: "cmp" },
            { area: "footer", component: "cmp" },
          ],
        },
      ],
    });

    // One place to go and edit. Listing it twice reads as two problems.
    //
    // BOTH halves of the sentence, because they are what can disagree: naming
    // the Layouts from the deduplicated set while counting the raw references
    // for the plural produces `the Layout "Marketing" uses it ... Remove it
    // from those Layouts first`.
    const refused = await c.run(deleting("cmp", nextly)).then(
      () => null,
      (error: unknown) => (error as Error).message
    );

    expect(refused).toMatch(
      /the Layout "Marketing" uses it.*Remove it from that Layout first/s
    );
  });

  it("agrees with itself when two Layouts use it", async () => {
    // The other side of the plural, so the assertion above cannot be satisfied
    // by a message that says "that Layout" whatever it found.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      layouts: [
        layout("l1", "Marketing", "cmp"),
        layout("l2", "Careers", "cmp"),
      ],
    });

    const refused = await c.run(deleting("cmp", nextly)).then(
      () => null,
      (error: unknown) => (error as Error).message
    );

    expect(refused).toMatch(
      /2 Layouts use it: "Marketing", "Careers".*Remove it from those Layouts first/s
    );
  });

  it("sees a component named only by a PUBLISHED Layout's pending edit", async () => {
    // The state the whole overlay pass exists for, and the one a per-state
    // scan cannot reach: the Layout is PUBLISHED, so a draft-scoped read
    // excludes it, and its main row still names the old component. Only the
    // sidecar names the one being deleted — and deleting it breaks the Layout
    // the moment somebody publishes those changes.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      layouts: [layout("l1", "Marketing", "old-cmp", "published")],
      // `_isWorkingDraft` is what marks an OVERLAY. Without it the by-id read
      // answered the live row, which the next test covers.
      pending: {
        l1: { ...layout("l1", "Marketing", "cmp"), _isWorkingDraft: true },
      },
    });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /the Layout "Marketing \(draft\)" uses it/
    );
  });

  it("still sees a component the pending edit REMOVED but the live row keeps", async () => {
    // The pair is kept rather than the edit substituted. This Layout serves
    // the component on every page today; that an unpublished edit drops it
    // does not make deleting it safe, and replacing the row with the overlay
    // would lose exactly that reference.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      layouts: [layout("l1", "Marketing", "cmp", "published")],
      pending: {
        l1: { ...layout("l1", "Marketing", "other"), _isWorkingDraft: true },
      },
    });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /the Layout "Marketing" uses it/
    );
  });

  it("ignores a by-id read that answered the LIVE row, not an overlay", async () => {
    // The read falls back to the live row when there is no sidecar. Taking
    // that as a pending edit would report the stored references twice — and
    // here it would invent a reference the enumeration does not have.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      layouts: [layout("l1", "Marketing", "other")],
      // No `_isWorkingDraft` marker: this is the live row coming back.
      pending: { l1: layout("l1", "Marketing", "cmp") },
    });

    await expect(c.run(deleting("cmp", nextly))).resolves.toBeUndefined();
  });

  it("refuses inside a caller's transaction rather than reading from it", async () => {
    // The bulk paths run this hook inside a transaction they own. The Direct
    // API takes no executor, so a read here checks out a SECOND connection and
    // can wait on one the open transaction holds. Refused rather than skipped:
    // skipping lets exactly these deletes through, on the path that deletes
    // many at once.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({ layouts: [layout("l1", "M", "cmp")] });

    await expect(
      c.run({ ...deleting("cmp", nextly), executor: {} })
    ).rejects.toThrow(/bulk operation/);
    // And it did not read at all, which is the point.
    expect(asked).toEqual([]);
  });

  it("refuses with a typed conflict, so the message survives the envelope", async () => {
    // A bare `Error` is caught as a code-less failure and reconstructed as an
    // internal error, so the author sees the generic unexpected-error message
    // and none of the Layout names assembled here.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ layouts: [layout("l1", "Marketing", "cmp")] });

    await expect(c.run(deleting("cmp", nextly))).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("asks for the ids only, not the components behind them", async () => {
    // The relationship is compared as an ID. Left to the default depth the
    // read expands it per repeater row and fetches every named component's
    // whole document — hundreds of extra reads before a delete, for a value
    // this discards.
    const c = context();
    register(c.ctx);
    const { nextly, asked, overlaid } = api({
      layouts: [layout("l1", "Marketing", "other")],
    });

    await c.run(deleting("cmp", nextly));

    expect({
      enumerations: asked.map(a => a.depth),
      overlays: overlaid.map(o => o.depth),
    }).toEqual({ enumerations: [0], overlays: [0] });
  });

  it("does not refuse a delete it could not evaluate at all", async () => {
    // No Direct API on the request, so there is nothing to ask. Left alone
    // rather than refused: this is a data-integrity guard, and one that blocked
    // every delete it could not evaluate would make the collection undeletable
    // on any path shaping its context differently.
    const c = context();
    register(c.ctx);

    await expect(c.run({ data: { id: "cmp" } })).resolves.toBeUndefined();
  });
});

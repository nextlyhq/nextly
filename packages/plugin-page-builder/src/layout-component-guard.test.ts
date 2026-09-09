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
 * An untyped fake is how this file previously agreed with a mistake: the guard
 * declared the service's inner `{ docs, hasNextPage }`, the fake returned the
 * same, and the scan reported that nothing referenced the component — allowing
 * the very delete the guard exists to refuse, with every test green.
 */
function api(pages: {
  published?: unknown[];
  draft?: unknown[];
  /** Working-draft overlays, by Layout id, as `findByID({ draft: true })` answers. */
  pending?: Record<string, unknown>;
}) {
  const asked: {
    collection: string;
    status?: string;
    depth?: number;
    override?: boolean;
  }[] = [];
  const nextly: LayoutGuardDirectApi = {
    find: async a => {
      asked.push({
        collection: a.collection,
        status: a.status,
        depth: a.depth,
        override: a.overrideAccess,
      });
      const items =
        (a.status === "draft" ? pages.draft : pages.published) ?? [];
      return { items, meta: { hasNext: false } };
    },
    findByID: async a => (pages.pending ?? {})[a.id] ?? null,
    create: async () => ({}),
    delete: async () => ({}),
  };
  return { asked, nextly };
}

const deleting = (id: string, nextly: unknown) => ({
  data: { id },
  req: { nextly },
});

const layout = (id: string, title: string, componentId: string) => ({
  id,
  title,
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
    const { nextly } = api({ published: [layout("l1", "Marketing", "cmp")] });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /the Layout "Marketing" uses it/
    );
  });

  it("allows the delete when no Layout names it", async () => {
    // The control. Without it, a guard that refused everything would satisfy
    // every refusal case here.
    const c = context();
    register(c.ctx);
    const { nextly } = api({ published: [layout("l1", "Marketing", "other")] });

    await expect(c.run(deleting("cmp", nextly))).resolves.toBeUndefined();
  });

  it("counts a DRAFT Layout, and says which it is", async () => {
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({
      draft: [layout("l2", "Next season", "cmp")],
    });

    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /"Next season \(draft\)"/
    );
    // Both stored forms asked for, as separate reads.
    expect(asked.map(a => a.status)).toEqual(["published", "draft"]);
  });

  it("reads as the system, or a Layout the user cannot see is invisible", async () => {
    // If the scan ran as the deleting user, a Layout they cannot read would
    // not appear, the delete would be permitted, and every page carrying that
    // Layout would break.
    const c = context();
    register(c.ctx);
    const { nextly, asked } = api({});

    await c.run(deleting("cmp", nextly));

    expect(asked.every(a => a.override)).toBe(true);
  });

  it("names one Layout once, however many of its areas use the component", async () => {
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      published: [
        {
          id: "l1",
          title: "Marketing",
          areas: [
            { area: "header", component: "cmp" },
            { area: "footer", component: "cmp" },
          ],
        },
      ],
    });

    // One place to go and edit. Listing it twice reads as two problems.
    await expect(c.run(deleting("cmp", nextly))).rejects.toThrow(
      /the Layout "Marketing" uses it/
    );
  });

  it("sees a component named only by a Layout's PENDING edit", async () => {
    // A published Layout edited since keeps its main row published and its
    // changes in a sidecar. A list read never surfaces that, so a component
    // named only by the unsaved-to-live edit would be invisible — and deleting
    // it breaks the Layout the moment somebody publishes.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      draft: [layout("l1", "Marketing", "old-cmp")],
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

  it("ignores a by-id read that answered the LIVE row, not an overlay", async () => {
    // The read falls back to the live row when there is no sidecar. Taking
    // that as a pending edit would report the published references twice — and
    // here it would invent a reference the draft pass does not have.
    const c = context();
    register(c.ctx);
    const { nextly } = api({
      draft: [layout("l1", "Marketing", "other")],
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
    const { nextly, asked } = api({ published: [layout("l1", "M", "cmp")] });

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
    const { nextly } = api({ published: [layout("l1", "Marketing", "cmp")] });

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
    const { nextly, asked } = api({ published: [] });

    await c.run(deleting("cmp", nextly));

    expect(asked.map(a => a.depth)).toEqual([0, 0]);
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

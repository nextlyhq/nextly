/**
 * A preview grant that NAMES an entry resolves by that id, not by slug.
 *
 * The route used to resolve the path by slug and then compare the result's id
 * against the grant. That comparison sits downstream of a lookup that can find
 * the wrong document: a slug is not unique, and duplicates are settled by
 * sorting on `id`, so a grant for one entry could land on another sharing its
 * slug. The mismatch was then rejected and the path fell back to published,
 * showing an editor LIVE content at a link they were given for a draft.
 *
 * Resolving by the granted id removes the comparison instead of hardening it.
 * What has to stay is the confirmation in the other direction: the entry a
 * grant names must still LIVE at the path being requested, or a preview cookie
 * would turn every URL on the site into the previewed page.
 *
 * The reader here holds a row SET rather than a single row, because that is the
 * only shape in which resolving by id and resolving by slug can disagree.
 */
import { describe, expect, it } from "vitest";

import type {
  FindArgs,
  FindByIDArgs,
} from "../../../direct-api/types/collections";
import type { ListResult } from "../../../direct-api/types/shared";
import { createContentRoute } from "../content-route";
import type { ContentEntry, NextlyContentReader } from "../resolve-content";

interface Row extends Record<string, unknown> {
  id: string;
  slug: string;
  status: string;
}

function stubReader(rows: Row[]): {
  reader: NextlyContentReader;
  calls: FindArgs[];
  byIdCalls: FindByIDArgs[];
} {
  const calls: FindArgs[] = [];
  const byIdCalls: FindByIDArgs[] = [];

  const reader: NextlyContentReader = {
    find: async (args): Promise<ListResult<Record<string, unknown>>> => {
      calls.push(args);
      const slug = (args.where as { slug?: { equals?: unknown } } | undefined)
        ?.slug?.equals;
      // The lifecycle scope the query service applies, plus the deterministic
      // `sort: "id"` the resolver relies on to settle duplicate slugs. Both
      // matter: without the sort the shadowing case would be arbitrary rather
      // than reproducible.
      const items = rows
        .filter(row => row.slug === slug)
        .filter(row => args.status === "all" || row.status === "published")
        .sort((left, right) => left.id.localeCompare(right.id))
        .slice(0, 1);
      return {
        items,
        meta: {
          total: items.length,
          page: 1,
          limit: 1,
          totalPages: 1,
          hasNext: false,
          hasPrev: false,
        },
      };
    },
    findByID: async (args): Promise<Record<string, unknown> | null> => {
      byIdCalls.push(args);
      const row = rows.find(candidate => candidate.id === args.id);
      return row ? { ...row, _isWorkingDraft: true } : null;
    },
  };

  return { reader, calls, byIdCalls };
}

function routeFor(reader: NextlyContentReader, entryId?: string) {
  return createContentRoute({
    collections: ["pages"],
    nextly: reader,
    render: (entry: ContentEntry) => entry,
    buildMetadata: (entry: ContentEntry) => ({ title: String(entry.id) }),
    draft: () => (entryId === undefined ? false : { entryId }),
  });
}

const params = { params: { slug: ["a"] } };

describe("a preview grant that names an entry", () => {
  it("opens the entry it names, not the one that shadows its slug", async () => {
    // `draft-first` sorts before `published-second` and has never been
    // published, so the ordinary slug lookup under a widened status finds IT.
    // The grant names the other one.
    const { reader } = stubReader([
      { id: "draft-first", slug: "a", status: "draft" },
      { id: "published-second", slug: "a", status: "published" },
    ]);

    const entry = (await routeFor(reader, "published-second").ContentPage(
      params
    )) as ContentEntry;

    expect(entry.id).toBe("published-second");
    // And it is the DRAFT of that entry, not its live row: resolving by id is
    // pointless if it drops the pending edits the link exists to show.
    expect(entry._isWorkingDraft).toBe(true);
  });

  // Both fall-through cases carry `aaa-shadow`: a never-published row sharing
  // the requested slug and sorting AHEAD of the published one under `sort: "id"`.
  //
  // It is the only shape where the two lifecycle scopes disagree, so it is what
  // makes these tests capable of failing at all. Without it the fixture returns
  // the same row whether the fall-through reads `published` or `all`, and the
  // guarantee the fall-through exists for — that a grant which did not answer
  // this path cannot surface a row it never named — is asserted in prose and
  // nowhere in code.
  const SHADOW: Row = { id: "aaa-shadow", slug: "a", status: "draft" };

  it("does not serve the granted entry at a path it does not live at", async () => {
    // The trap this design exists to avoid. Resolving by the granted id alone
    // would render that entry at EVERY url for the life of the session, which
    // is worse than the duplicate-slug bug it fixes.
    const { reader } = stubReader([
      { id: "elsewhere", slug: "somewhere-else", status: "draft" },
      SHADOW,
      { id: "here", slug: "a", status: "published" },
    ]);

    const entry = (await routeFor(reader, "elsewhere").ContentPage(
      params
    )) as ContentEntry;

    expect(entry.id).toBe("here");
    expect(entry._isWorkingDraft).toBeUndefined();
  });

  it("falls back to published when the grant names a deleted entry", async () => {
    // A preview link outlives what it points at. Failing here would make a
    // stale-but-valid link distinguishable from a forged one.
    const { reader } = stubReader([
      SHADOW,
      { id: "here", slug: "a", status: "published" },
    ]);

    const entry = (await routeFor(reader, "gone").ContentPage(
      params
    )) as ContentEntry;

    expect(entry.id).toBe("here");
    expect(entry._isWorkingDraft).toBeUndefined();
  });

  it("reads the fall-through with the published scope, not the widened one", async () => {
    // Stated directly rather than only inferred from which row came back, so
    // the guarantee survives a future fixture change that stops distinguishing
    // the two scopes.
    const { reader, calls } = stubReader([
      SHADOW,
      { id: "here", slug: "a", status: "published" },
    ]);

    await routeFor(reader, "gone").ContentPage(params);

    expect(calls.at(-1)?.status).toBe("published");
  });

  it("still opens the draft when a hook rewrites the entry's id", async () => {
    // An `afterRead` hook's return REPLACES the document, so the old
    // compare-the-id approach rejected a valid grant whenever a collection
    // reshaped its public read. Nothing compares ids any more, so the read
    // succeeds on its own terms.
    const rows: Row[] = [{ id: "real", slug: "a", status: "published" }];
    const { reader } = stubReader(rows);
    const reshaping: NextlyContentReader = {
      find: reader.find,
      findByID: async args => {
        const row = await reader.findByID(args);
        return row === null ? null : { ...row, id: "reshaped-by-a-hook" };
      },
    };

    const entry = (await routeFor(reshaping, "real").ContentPage(
      params
    )) as ContentEntry;

    expect(entry._isWorkingDraft).toBe(true);
    expect(entry.id).toBe("reshaped-by-a-hook");
  });

  it("reads by id before it reads by slug", async () => {
    // The mechanism, not the symptom: a named grant must not spend a slug
    // lookup first, because that lookup is the thing that can find the wrong
    // document.
    const { reader, calls, byIdCalls } = stubReader([
      { id: "here", slug: "a", status: "published" },
    ]);

    await routeFor(reader, "here").ContentPage(params);

    expect(byIdCalls).toHaveLength(1);
    expect(byIdCalls[0]?.id).toBe("here");
    expect(calls).toHaveLength(0);
  });
});

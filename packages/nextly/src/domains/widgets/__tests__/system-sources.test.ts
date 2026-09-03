/**
 * A source whose rows are not a collection's: how it is reached, and what
 * happens when nothing answers it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const find = vi.fn();
const count = vi.fn();

// The collection path's collaborator, stubbed so the control below exercises a
// real dispatch rather than falling over on a missing Direct API.
vi.mock("../../../direct-api/nextly", () => ({
  getNextly: () => ({ find, count }),
}));

import { executeWidgetQuery } from "../execute";
import { clearSources, registerSource } from "../sources";
import {
  clearSystemResolvers,
  registerSystemSource,
  systemResolver,
} from "../system-sources";

const caller = { user: { id: "user-1", roles: ["editor"] } };

const releasesSource = {
  id: "system:releases",
  label: "Releases",
  kind: "system" as const,
  supports: ["count", "list"] as const,
  fields: [{ name: "title", type: "string" as const }],
};

beforeEach(() => {
  vi.clearAllMocks();
  find.mockResolvedValue({ items: [] });
  count.mockResolvedValue({ total: 0 });
  // Both stores, because they are two halves of one registration: clearing one
  // leaves a resolver addressable under an id no source claims, or a source
  // nothing can answer.
  clearSources();
  clearSystemResolvers();
});

describe("a registered system source", () => {
  it("hands the query and the CALLER to its resolver", async () => {
    // 🔴 The caller has to travel, because the resolver's whole job is to put
    // the question to a service that authorizes it. A resolver called without
    // one could only answer by deciding access itself, which is the second
    // implementation this shape exists to prevent.
    const resolve = vi.fn().mockResolvedValue({ op: "count", total: 3 });
    registerSystemSource(releasesSource, resolve);

    const result = await executeWidgetQuery(
      { source: "system:releases", op: "count" },
      caller
    );

    expect(result).toEqual({ op: "count", total: 3 });
    expect(resolve).toHaveBeenCalledWith(
      { source: "system:releases", op: "count" },
      caller
    );
  });

  it("does NOT reach the collection query path", async () => {
    // The control that the dispatch actually branched. A system source whose
    // id happened to compile to a collection name would answer from the Direct
    // API and look entirely correct, having consulted the wrong rows under the
    // wrong rules.
    registerSystemSource(
      releasesSource,
      vi.fn().mockResolvedValue({ op: "count", total: 3 })
    );

    await executeWidgetQuery(
      { source: "system:releases", op: "count" },
      caller
    );

    expect(count).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it("still runs a COLLECTION source through the query path", async () => {
    // The other control: a dispatch that sent everything to a resolver would
    // satisfy both cases above and break every collection card.
    registerSource({
      id: "collection:posts",
      label: "Posts",
      kind: "collection",
      supports: ["count", "list"],
      fields: [{ name: "title", type: "string" }],
    });

    await executeWidgetQuery(
      { source: "collection:posts", op: "count" },
      caller
    );

    expect(count).toHaveBeenCalled();
  });
});

describe("a system source nothing answers", () => {
  it("is REFUSED rather than executed", async () => {
    // Reachable only through a registration that published a source without a
    // resolver. `registerSystemSource` takes both together so that state
    // cannot be written, and this is the guard for the path that bypasses it.
    registerSource(releasesSource);

    await expect(
      executeWidgetQuery({ source: "system:releases", op: "count" }, caller)
    ).rejects.toThrow();
  });

  it("is refused the SAME WAY as a source that does not exist", async () => {
    // 🔴 The two must be indistinguishable to the caller. A distinct message
    // for "registered but unanswerable" confirms the source is real, which is
    // exactly what the unknown-source refusal is careful not to say.
    registerSource(releasesSource);

    const unanswerable = await executeWidgetQuery(
      { source: "system:releases", op: "count" },
      caller
    ).catch((error: Error) => error);
    const unknown = await executeWidgetQuery(
      { source: "system:nothing-here", op: "count" },
      caller
    ).catch((error: Error) => error);

    expect((unanswerable as Error).message).toBe((unknown as Error).message);
  });
});

describe("registering the two halves together", () => {
  it("publishes the source AND its resolver in one call", async () => {
    const resolve = vi.fn();
    registerSystemSource(releasesSource, resolve);

    expect(systemResolver("system:releases")).toBe(resolve);
  });

  it("refuses a duplicate id, as the source registry does", () => {
    registerSystemSource(releasesSource, vi.fn());

    expect(() => registerSystemSource(releasesSource, vi.fn())).toThrow();
  });
});

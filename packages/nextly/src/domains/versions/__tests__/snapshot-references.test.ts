/**
 * A stored snapshot holds bare ids for relationship and upload fields. The read
 * path resolves them so a history view shows names rather than identifiers,
 * and resolving must not become a way to read a document the caller is denied.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import type { FieldConfig } from "../../../collections/fields/types";

const getEntrySpy = vi.fn();
const findMediaSpy = vi.fn();

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) =>
    name === "mediaService"
      ? { findById: findMediaSpy }
      : { getEntry: getEntrySpy }
  ),
}));

import { hydrateSnapshotReferences } from "../snapshot-references";

const user = { id: "u1" };

function relField(name: string): FieldConfig {
  return { name, type: "relationship", relationTo: "authors" } as FieldConfig;
}

const fields: FieldConfig[] = [
  relField("author"),
  { name: "title", type: "text" } as FieldConfig,
];

function ok(data: Record<string, unknown>) {
  return { success: true, statusCode: 200, data };
}

describe("hydrateSnapshotReferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEntrySpy.mockResolvedValue(ok({ id: "a1", name: "Ada" }));
  });

  it("resolves a relationship id to an id and label pair", async () => {
    const snapshot: Record<string, unknown> = { author: "a1", title: "Hello" };

    await hydrateSnapshotReferences(snapshot, user, fields);

    expect(snapshot.author).toEqual({ id: "a1", label: "Ada" });
    expect(snapshot.title).toBe("Hello");
  });

  it("reads the target through the access-checked path", async () => {
    await hydrateSnapshotReferences({ author: "a1" }, user, fields);

    // overrideAccess false and routeAuthorized false together: the caller was
    // authorized for the PARENT document, never for this target.
    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionName: "authors",
        entryId: "a1",
        overrideAccess: false,
        routeAuthorized: false,
      })
    );
  });

  it("degrades an unreadable reference to a null label, keeping the id", async () => {
    getEntrySpy.mockResolvedValue({ success: false, statusCode: 403 });
    const snapshot: Record<string, unknown> = { author: "secret" };

    await hydrateSnapshotReferences(snapshot, user, fields);

    // Not dropped, which would misrepresent the historical value as empty, and
    // not an error, which would confirm the target exists.
    expect(snapshot.author).toEqual({ id: "secret", label: null });
  });

  it("degrades when the read throws rather than failing the version read", async () => {
    getEntrySpy.mockRejectedValue(new Error("boom"));
    const snapshot: Record<string, unknown> = { author: "a1" };

    await hydrateSnapshotReferences(snapshot, user, fields);

    expect(snapshot.author).toEqual({ id: "a1", label: null });
  });

  it("resolves each distinct id once across repeated references", async () => {
    const two = [relField("a"), relField("b")];

    await hydrateSnapshotReferences({ a: "x1", b: "x1" }, user, two);

    expect(getEntrySpy).toHaveBeenCalledTimes(1);
  });

  it("resolves every element of a hasMany relationship", async () => {
    const many = [{ ...relField("authors"), hasMany: true } as FieldConfig];
    getEntrySpy.mockImplementation((args: { entryId: string }) =>
      Promise.resolve(ok({ id: args.entryId, name: `N-${args.entryId}` }))
    );
    const snapshot: Record<string, unknown> = { authors: ["a1", "a2"] };

    await hydrateSnapshotReferences(snapshot, user, many);

    expect(snapshot.authors).toEqual([
      { id: "a1", label: "N-a1" },
      { id: "a2", label: "N-a2" },
    ]);
  });

  it("leaves a snapshot that is not an object alone", async () => {
    await expect(
      hydrateSnapshotReferences("not-an-object", user, fields)
    ).resolves.toBeUndefined();

    expect(getEntrySpy).not.toHaveBeenCalled();
  });

  it("descends into a repeater stored as a JSON string", async () => {
    // Snapshots are captured from the persisted row, so JSON-backed containers
    // can arrive as strings depending on the dialect.
    const nested = [
      {
        name: "rows",
        type: "repeater",
        fields: [relField("author")],
      } as FieldConfig,
    ];
    const snapshot: Record<string, unknown> = {
      rows: JSON.stringify([{ author: "a1" }]),
    };

    await hydrateSnapshotReferences(snapshot, user, nested);

    expect(snapshot.rows).toEqual([{ author: { id: "a1", label: "Ada" } }]);
  });

  it("resolves an upload through the media service", async () => {
    findMediaSpy.mockResolvedValue({
      id: "m1",
      filename: "hero.jpg",
      url: "/u/hero.jpg",
      thumbnailUrl: "/u/hero-t.jpg",
      mimeType: "image/jpeg",
    });
    const uploads = [{ name: "hero", type: "upload" } as FieldConfig];
    const snapshot: Record<string, unknown> = { hero: "m1" };

    await hydrateSnapshotReferences(snapshot, user, uploads);

    expect(snapshot.hero).toEqual({
      id: "m1",
      filename: "hero.jpg",
      url: "/u/hero.jpg",
      thumbnailUrl: "/u/hero-t.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("stops resolving past the reference cap and leaves the rest as ids", async () => {
    // A pathological snapshot must not fan out into unbounded reads.
    const wide = Array.from(
      { length: 60 },
      (_, i) => relField(`r${i}`) as FieldConfig
    );
    const snapshot: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) snapshot[`r${i}`] = `id-${i}`;

    await hydrateSnapshotReferences(snapshot, user, wide);

    expect(getEntrySpy.mock.calls.length).toBeLessThanOrEqual(50);
    expect(snapshot.r59).toBe("id-59");
  });
});

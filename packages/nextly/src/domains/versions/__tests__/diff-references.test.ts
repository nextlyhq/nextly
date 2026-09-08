/**
 * The diff hydrator walks a computed diff tree and, through the access-checked
 * resolver, rewrites each relationship/upload value node to the value kit's
 * display shape and labels each many-relationship target. These tests drive it
 * with a mocked read so the walk, the in-place rewrite, and the access fallback
 * are pinned without a database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getEntrySpy, mayReadSpy } = vi.hoisted(() => ({
  getEntrySpy: vi.fn(),
  mayReadSpy: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: vi.fn((name: string) => {
    if (name === "collectionsHandler") return { getEntry: getEntrySpy };
    return {};
  }),
}));

/*
 * The system-resource gate, watched because it is the ONE observable every
 * resolution passes through before anything can swallow it.
 *
 * A reference the walker decides to resolve takes one of two routes: a dynamic
 * collection through `getEntry`, or a system resource — the built-in `media`
 * library, `users` — through its own reader. That second route is wrapped in a
 * try/catch that answers "unresolved" on any failure, so watching the reader
 * itself would miss a resolution that was attempted and quietly failed. The
 * gate is asked first, and asked whatever the outcome.
 */
vi.mock("../../../auth/resource-readable", () => ({
  canReadSystemResource: mayReadSpy,
}));

import type { FieldDiff } from "../diff/types";
import { hydrateDiffReferences } from "../diff-references";
import type { UserContext } from "../../singles/types";

const user = { id: "u1", roles: ["editor"] } as unknown as UserContext;

beforeEach(() => {
  vi.clearAllMocks();
  // Permissive, so a resolution that IS attempted proceeds rather than being
  // refused — a denied gate and an unattempted one look the same downstream.
  mayReadSpy.mockResolvedValue(true);
  // Each read echoes the id back as a title, so a resolved value is recognisable.
  getEntrySpy.mockImplementation(({ entryId }: { entryId: string }) =>
    Promise.resolve({ success: true, data: { title: `T-${entryId}` } })
  );
});

describe("hydrateDiffReferences", () => {
  it("rewrites a single-relationship value node's before/after to { id, label }", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "author",
        label: "Author",
        type: "relationship",
        status: "changed",
        before: "a1",
        after: "a2",
        display: { relationTo: "authors" },
      },
    ];

    await hydrateDiffReferences(fields, user);

    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.before).toEqual({ id: "a1", label: "T-a1" });
    expect(node.after).toEqual({ id: "a2", label: "T-a2" });
  });

  it("labels each target of a many-relationship set node", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "set",
        name: "tags",
        label: "Tags",
        type: "relationship",
        status: "changed",
        added: [{ id: "t2" }],
        removed: [{ id: "t1" }],
        display: { relationTo: "tags", hasMany: true },
      },
    ];

    await hydrateDiffReferences(fields, user);

    const node = fields[0] as Extract<FieldDiff, { kind: "set" }>;
    expect(node.added[0]?.label).toBe("T-t2");
    expect(node.removed[0]?.label).toBe("T-t1");
  });

  it("resolves a polymorphic target against its own collection", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "subject",
        label: "Subject",
        type: "relationship",
        status: "added",
        before: null,
        after: { relationTo: "posts", value: "p9" },
        display: { relationTo: ["posts", "pages"] },
      },
    ];

    await hydrateDiffReferences(fields, user);

    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ collectionName: "posts", entryId: "p9" })
    );
    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.after).toEqual({
      relationTo: "posts",
      value: "p9",
      label: "T-p9",
    });
  });

  it("keeps the id when the target read is denied", async () => {
    getEntrySpy.mockResolvedValue({ success: false });
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "author",
        label: "Author",
        type: "relationship",
        status: "unchanged",
        before: "a1",
        after: "a1",
        display: { relationTo: "authors" },
      },
    ];

    await hydrateDiffReferences(fields, user);

    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.after).toEqual({ id: "a1", label: null });
  });

  it("descends into groups and list items", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "group",
        name: "meta",
        label: "Meta",
        type: "group",
        status: "changed",
        fields: [
          {
            kind: "value",
            name: "owner",
            label: "Owner",
            type: "relationship",
            status: "added",
            before: null,
            after: "o1",
            display: { relationTo: "people" },
          },
        ],
      },
      {
        kind: "list",
        name: "blocks",
        label: "Blocks",
        type: "repeater",
        status: "changed",
        items: [
          {
            id: "row-1",
            status: "changed",
            fields: [
              {
                kind: "value",
                name: "link",
                label: "Link",
                type: "relationship",
                status: "added",
                before: null,
                after: "l1",
                display: { relationTo: "pages" },
              },
            ],
          },
        ],
      },
    ];

    await hydrateDiffReferences(fields, user);

    const group = fields[0] as Extract<FieldDiff, { kind: "group" }>;
    const owner = group.fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(owner.after).toEqual({ id: "o1", label: "T-o1" });

    const list = fields[1] as Extract<FieldDiff, { kind: "list" }>;
    const link = list.items[0]?.fields[0] as Extract<
      FieldDiff,
      { kind: "value" }
    >;
    expect(link.after).toEqual({ id: "l1", label: "T-l1" });
  });

  it("reads nothing for rich text, whose media identity is an attribute", async () => {
    // The walker resolves a FIELD whose type declares what it points at. A
    // decorator inside rich text has its identity in its own properties, which
    // the projection reports as `attrChanges` on the block that holds it —
    // there is no id to exchange for a filename, and asking the collections
    // handler for one would be a read against a value that is not an entry id.
    const richText: FieldDiff = {
      kind: "richText",
      name: "body",
      label: "Body",
      type: "richText",
      status: "changed",
      blocks: [
        {
          blockType: "image",
          status: "changed",
          attrChanges: [
            // Deliberately REF-SHAPED, not a URL string. A path could never
            // reach the resolver whatever the walker did, so a fixture using
            // one cannot tell "rich text is skipped" from "this value was
            // unresolvable anyway" — it would be satisfied by a walker that
            // tried and failed.
            {
              name: "src",
              before: { id: "m1", relationTo: "media" },
              after: { id: "m2", relationTo: "media" },
            },
          ],
        },
      ],
    };
    const untouched = structuredClone(richText);
    const fields: FieldDiff[] = [
      richText,
      // The control, and this assertion needs one: a walk that never ran would
      // also read nothing, and "the handler was not called" would pass for a
      // hydrator that skipped the whole tree.
      {
        kind: "value",
        name: "author",
        label: "Author",
        type: "relationship",
        status: "changed",
        before: "a1",
        after: "a1",
        display: { relationTo: "authors" },
      },
    ];

    await hydrateDiffReferences(fields, user);

    // The walk DID run, and resolved the field that names what it points at.
    expect(getEntrySpy).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: "a1" })
    );
    // And it asked nothing about the image, whose `src` is a value rather than
    // a reference. Both routes are checked: an upload against the built-in
    // library resolves through the media service, so watching only the entry
    // read would miss exactly the implementation most likely to be written.
    for (const call of getEntrySpy.mock.calls) {
      expect(call[0].entryId).not.toBe("m1");
      expect(call[0].entryId).not.toBe("m2");
    }
    // Nothing was even ASKED about on the system-resource route, which is where
    // an upload against the built-in library would go.
    expect(mayReadSpy).not.toHaveBeenCalled();
    // The rich-text node is returned exactly as it arrived: nothing was
    // rewritten in place, so a consumer still reads the attribute change.
    expect(fields[0]).toEqual(untouched);
  });

  it("does not read anything for a diff with no references", async () => {
    const fields: FieldDiff[] = [
      {
        kind: "value",
        name: "views",
        label: "Views",
        type: "number",
        status: "changed",
        before: 1,
        after: 2,
      },
    ];

    await hydrateDiffReferences(fields, user);

    expect(getEntrySpy).not.toHaveBeenCalled();
    const node = fields[0] as Extract<FieldDiff, { kind: "value" }>;
    expect(node.before).toBe(1);
    expect(node.after).toBe(2);
  });
});

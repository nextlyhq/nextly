/**
 * The boundary between what storage holds and what the canvas may walk.
 *
 * Asserted here rather than through a rendered editor because the failure this
 * guards is a throw inside the render: the canvas reads `nodes`, and a value
 * without one takes the whole editor down at the moment an author opens it,
 * leaving them no way to repair the field.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { canEditBlocks, documentFrom } from "./BlocksField";

describe("documentFrom", () => {
  it("keeps a document that already has nodes", () => {
    const stored = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [{ id: "a", type: "core/heading" }],
    };
    // Returned as-is rather than rebuilt: copying would drop any field this
    // function does not know about, which is every field added after it.
    expect(documentFrom(stored)).toBe(stored);
  });

  it("replaces a value that is absent", () => {
    expect(documentFrom(undefined).nodes).toEqual([]);
    expect(documentFrom(null).nodes).toEqual([]);
  });

  it("replaces a value that is not an object", () => {
    // A field storing JSON as TEXT hands back a string. Walking it would find
    // no `nodes` and throw, so it is treated as absent.
    expect(documentFrom('{"nodes":[]}').nodes).toEqual([]);
    expect(documentFrom(42).nodes).toEqual([]);
  });

  it("replaces the previous document shape, which had no nodes array", () => {
    // The retired `{version, root}` form. An object, so an object check alone
    // would pass it through to a canvas that reads `nodes` and finds nothing.
    expect(documentFrom({ version: 1, root: { id: "r" } }).nodes).toEqual([]);
  });

  it("replaces an object whose nodes is present but not an array", () => {
    expect(documentFrom({ nodes: {} }).nodes).toEqual([]);
    expect(documentFrom({ nodes: null }).nodes).toEqual([]);
  });

  it("gives every replacement a document the validator accepts", () => {
    // Seeded from `emptyBlockDocument` rather than written here, so the shape
    // cannot drift from the one the field stores and the validator expects.
    const fresh = documentFrom(null);
    expect(fresh.formatVersion).toBe(DOCUMENT_FORMAT_VERSION);
    expect(typeof fresh.kind).toBe("string");
  });
});

describe("canEditBlocks", () => {
  /*
   * The rule that decides whether a way INTO the editor is offered at all.
   *
   * Not cosmetic. Before this, `readOnly` arrived from the admin's shared
   * `commonProps` and was dropped on the floor — so a version-history view,
   * which renders the whole document read-only, still showed an enabled "Edit
   * blocks" button. Opening it mounted a full-screen editor bound to whichever
   * form was nearest, which there is the SNAPSHOT'S: committing wrote into a
   * past version of the document. `VersionSnapshotForm`'s own docblock states
   * that as impossible.
   */
  it("allows editing when neither flag is set", () => {
    // The control. Without it, "always false" would satisfy every case below
    // and no author could ever open the editor.
    expect(canEditBlocks({})).toBe(true);
    expect(canEditBlocks({ readOnly: false, disabled: false })).toBe(true);
  });

  it("refuses when the document is being READ", () => {
    expect(canEditBlocks({ readOnly: true })).toBe(false);
  });

  it("refuses when the field is DISABLED", () => {
    // Independently of `readOnly`: the admin sets the two for different
    // reasons, and honouring one of them is being wrong half the time.
    expect(canEditBlocks({ disabled: true })).toBe(false);
  });

  it("refuses when both are set", () => {
    expect(canEditBlocks({ readOnly: true, disabled: true })).toBe(false);
  });
});

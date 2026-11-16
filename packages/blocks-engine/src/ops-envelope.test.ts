/**
 * The `envelope` op: what a component offers its placements, written as one
 * undoable edit.
 *
 * The properties a plausible implementation gets wrong: an inverse that does
 * not restore a field the component never had (so undoing the first exposure
 * leaves `exposed: []` behind), an op accepted on a page, a field outside the
 * envelope written through it, and a no-op recorded as an edit.
 */
import { describe, expect, it } from "vitest";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type ComponentDocument,
  type ExposedProperty,
} from "./document";
import { applyOp, applyOps, OpError, type BuilderOp } from "./ops";

const title: ExposedProperty = {
  id: "title",
  label: "Title",
  nodeId: "h1",
  propPath: "text",
  type: "text",
};

function component(
  envelope: Partial<ComponentDocument> = {}
): ComponentDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "component",
    nodes: [{ id: "h1", type: "core/heading", version: 1, props: {} }],
    ...envelope,
  };
}

describe("the envelope op", () => {
  it("writes a field the component did not have, and its undo removes it again", () => {
    const before = component();
    const applied = applyOp(before, {
      kind: "envelope",
      patch: { exposed: [title] },
    });
    expect((applied.document as ComponentDocument).exposed).toEqual([title]);
    expect(applied.inverse).toEqual({
      kind: "envelope",
      patch: {},
      unset: ["exposed"],
    });

    const undone = applyOp(applied.document, applied.inverse);
    expect(undone.document).toEqual(before);
    expect(Object.hasOwn(undone.document, "exposed")).toBe(false);
  });

  it("restores the fields it replaced, together, in one step", () => {
    const before = component({
      exposed: [title],
      variants: { dark: { label: "Dark", overrides: { title: "Night" } } },
    });
    const applied = applyOp(before, {
      kind: "envelope",
      patch: {
        exposed: [],
        variants: { dark: { label: "Dark", overrides: {} } },
      },
    });
    const undone = applyOp(applied.document, applied.inverse);
    expect(undone.document).toEqual(before);
  });

  it("records the replaced field as it stood, whatever later touches the old copy", () => {
    const before = component({ exposed: [title] });
    const applied = applyOp(before, {
      kind: "envelope",
      patch: { exposed: [] },
    });
    before.exposed?.push({ ...title, id: "late" });
    const undone = applyOp(applied.document, applied.inverse);
    expect((undone.document as ComponentDocument).exposed).toEqual([title]);
  });

  it("removes a field named in unset, and its undo puts it back", () => {
    const before = component({ exposed: [title] });
    const applied = applyOp(before, {
      kind: "envelope",
      patch: {},
      unset: ["exposed"],
    });
    expect(Object.hasOwn(applied.document, "exposed")).toBe(false);
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  it("leaves the caller's patch and the old document as they were", () => {
    const exposed = [title];
    const before = component();
    const applied = applyOp(before, { kind: "envelope", patch: { exposed } });
    exposed.push({ ...title, id: "other" });
    expect((applied.document as ComponentDocument).exposed).toHaveLength(1);
    expect(Object.hasOwn(before, "exposed")).toBe(false);
  });

  it("is refused on a page, which has no placements to offer anything to", () => {
    const page: BlockDocument = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [],
    };
    expect(() =>
      applyOp(page, { kind: "envelope", patch: { exposed: [title] } })
    ).toThrow(/only a component/);
  });

  it("writes nothing outside the component's envelope", () => {
    const op = {
      kind: "envelope",
      patch: { settings: { customCss: "x" } },
    } as unknown as BuilderOp;
    expect(() => applyOp(component(), op)).toThrow(/not a field this op/);
    const unset = {
      kind: "envelope",
      patch: {},
      unset: ["nodes"],
    } as unknown as BuilderOp;
    expect(() => applyOp(component(), unset)).toThrow(/not a field this op/);
  });

  it("refuses an unset list holding an accessor without running it", () => {
    let ran = false;
    const unset: string[] = [];
    Object.defineProperty(unset, 0, {
      enumerable: true,
      get() {
        ran = true;
        return "exposed";
      },
    });
    const op = { kind: "envelope", patch: {}, unset } as unknown as BuilderOp;
    expect(() => applyOp(component({ exposed: [title] }), op)).toThrow(OpError);
    expect(ran).toBe(false);
  });

  it("refuses a field both written and removed", () => {
    expect(() =>
      applyOp(component(), {
        kind: "envelope",
        patch: { exposed: [title] },
        unset: ["exposed"],
      })
    ).toThrow(/both written and removed/);
  });

  it("refuses a value JSON would not carry, so the stored op replays as applied", () => {
    const op = {
      kind: "envelope",
      patch: { exposed: [{ ...title, label: 1n }] },
    } as unknown as BuilderOp;
    expect(() => applyOp(component(), op)).toThrow(OpError);
  });

  it("refuses an edit that changes nothing, so no undo step does nothing", () => {
    expect(() =>
      applyOp(component({ exposed: [title] }), {
        kind: "envelope",
        patch: { exposed: [{ ...title }] },
      })
    ).toThrow(/changes nothing/);
    expect(() =>
      applyOp(component(), { kind: "envelope", patch: {}, unset: ["slots"] })
    ).toThrow(/changes nothing/);
  });

  it("is held to the document's byte cap", () => {
    const op: BuilderOp = {
      kind: "envelope",
      patch: { exposed: [{ ...title, label: "x".repeat(4096) }] },
    };
    expect(() =>
      applyOps(component(), [op], {
        maxNodes: 100,
        maxDepth: 10,
        maxBytes: 1024,
      })
    ).toThrow(OpError);
  });
});

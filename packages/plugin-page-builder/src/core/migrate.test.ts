import { describe, it, expect } from "vitest";

import { migrateDocument } from "./migrate";
import { createBlockRegistry } from "./registry";
import { makeNode } from "./tree";
import type { BlockDocument, BlockNode } from "./types";

const reg = createBlockRegistry();
// heading v2: renames prop `size` (old) → `level`.
reg.register({
  type: "core/heading",
  version: 2,
  label: "H",
  icon: "",
  category: "basic",
  defaultProps: { level: "h2" },
  render: () => null,
  migrate: (old, from) => {
    const o = old as { size?: string };
    return from < 2 ? { props: { level: o.size ?? "h2" } } : { props: o };
  },
});
reg.register({
  type: "core/container",
  version: 1,
  label: "C",
  icon: "",
  category: "layout",
  isContainer: true,
  defaultProps: {},
  render: () => null,
});

describe("migrateDocument", () => {
  it("upgrades a stale block via its migrate() and stamps definitionVersion", () => {
    const stale: BlockNode = {
      ...makeNode("core/heading", { size: "h1" }),
      definitionVersion: 1,
    };
    const root = makeNode("core/container", {}, undefined, {
      default: [stale],
    });
    const out = migrateDocument({ version: 1, root }, reg);
    const h = out.root.slots!.default![0];
    expect(h.props.level).toBe("h1");
    expect(h.props.size).toBeUndefined();
    expect(h.definitionVersion).toBe(2);
  });

  it("preserves (does not drop) unknown block types", () => {
    const unknown = { id: "u", type: "acme/mystery", props: { a: 1 } };
    const root = makeNode("core/container", {}, undefined, {
      default: [unknown as unknown as BlockNode],
    });
    const out = migrateDocument({ version: 1, root }, reg);
    expect(out.root.slots!.default![0]).toMatchObject({
      type: "acme/mystery",
      props: { a: 1 },
    });
  });

  it("leaves current-version blocks untouched", () => {
    const cur: BlockNode = {
      ...makeNode("core/heading", { level: "h3" }),
      definitionVersion: 2,
    };
    const root = makeNode("core/container", {}, undefined, { default: [cur] });
    const out = migrateDocument({ version: 1, root }, reg);
    expect(out.root.slots!.default![0].props.level).toBe("h3");
  });
});

describe("telling an upgraded document from an untouched one", () => {
  /**
   * Identity, not deep equality — the editor's field mount reads it that way. It has to push a
   * migrated document to the host form and must NOT push an unmigrated one, because a push on
   * every mount loops through the form's own onChange. Deep-comparing whole trees on every mount
   * is the alternative, and it is the expensive answer to a question identity already settles.
   */
  const versionedRegistry = () => {
    const r = createBlockRegistry();
    r.register({
      type: "t/box",
      version: 2,
      label: "Box",
      icon: "Square",
      category: "basic",
      isContainer: true,
      slots: [{ name: "default" }],
      defaultProps: {},
      migrate: () => ({ props: { upgraded: true } }),
      render: () => null,
    });
    return r;
  };

  it("returns the SAME document when nothing needed upgrading", () => {
    const doc: BlockDocument = {
      version: 1,
      root: {
        id: "r",
        type: "t/box",
        definitionVersion: 2,
        props: {},
        slots: { default: [] },
      },
    };
    expect(migrateDocument(doc, versionedRegistry())).toBe(doc);
  });

  it("returns a NEW document when a nested block was upgraded", () => {
    // Nested, because the interesting case is a root that needed nothing while a descendant did:
    // an implementation that only checked the root would report no change and drop the upgrade.
    const stale: BlockNode = {
      id: "c",
      type: "t/box",
      definitionVersion: 1,
      props: {},
    };
    const doc: BlockDocument = {
      version: 1,
      root: {
        id: "r",
        type: "t/box",
        definitionVersion: 2,
        props: {},
        slots: { default: [stale] },
      },
    };
    const out = migrateDocument(doc, versionedRegistry());
    expect(out).not.toBe(doc);
    expect(out.root.slots?.default?.[0]?.props).toEqual({ upgraded: true });
  });
});

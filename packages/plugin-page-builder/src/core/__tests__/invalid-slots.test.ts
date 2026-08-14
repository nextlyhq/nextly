/**
 * The finder behind the repair banner, checked against the thing it has to agree with.
 *
 * The banner offers to remove exactly the blocks that stop a page saving. That agreement is the
 * property worth testing, and it cannot be tested by comparing the finder against a hand-written
 * list of expected entries: that list and the finder would be two things maintained by the same
 * person, agreeing with each other while both drift away from the validator. So the central test
 * here runs the REAL validator, removes what the finder reports, and runs it again.
 *
 * 🔴 Like `validate-without-renderer.test.ts`, this file must not import `render/blocks`. The
 * finder has to work where the registry is empty, which is the state the config and server paths
 * are in, and a side-effect import would supply a precondition production does not have.
 */
import { describe, expect, it } from "vitest";

import {
  declaredSlotNames,
  findInvalidSlotEntries,
  repairInvalidSlot,
} from "../invalid-slots";
import { createBlockRegistry, defaultBlockRegistry } from "../registry";
import {
  dropSlots,
  makeNode,
  removeFromSlot,
  removeNode,
  removeSlot,
} from "../tree";
import { validateDocument } from "../validate";

import type { BlockNode } from "../types";

const doc = (root: BlockNode) => ({ version: 1, root }) as never;

const withSlots = (
  type: string,
  slots: Record<string, BlockNode[]>
): BlockNode => ({ ...makeNode(type, {}), slots });

const heading = (text: string) =>
  makeNode("core/heading", { text, level: "h2" });

describe("finding blocks in a slot nothing declares", () => {
  it("has an EMPTY registry, which is the condition the finder has to work in", () => {
    // The same precondition the validator's own test asserts. If an import ever populates the
    // registry, this fails first and says why, instead of the assertions below passing because
    // definitions arrived rather than because structure answered.
    expect(defaultBlockRegistry.all()).toHaveLength(0);
  });

  it("reports nothing for a document that saves", () => {
    // Positive control. Every assertion below is about a non-empty result, and a finder that
    // reported everything would satisfy all of them.
    const root = withSlots("core/container", { default: [heading("Fine")] });

    expect(
      validateDocument(doc(root), defaultBlockRegistry, { allowUnknown: true })
    ).toBe(true);
    expect(findInvalidSlotEntries(root, defaultBlockRegistry)).toEqual([]);
  });

  it("removing everything it reports is what makes the document save", () => {
    // The agreement, end to end, with no expected-entry list in the middle of it. A document the
    // validator refuses becomes one it accepts, and nothing but the reported nodes was removed.
    const root = withSlots("core/container", {
      default: [
        heading("Visible"),
        withSlots("core/row", {
          default: [heading("Also visible")],
          removed: [heading("Orphan inside a row")],
        }),
      ],
      legacy: [heading("Orphan at the top")],
    });

    const before = validateDocument(doc(root), defaultBlockRegistry, {
      allowUnknown: true,
    });
    expect(before).toContain("has no slot");

    const entries = findInvalidSlotEntries(root, defaultBlockRegistry);
    expect(entries.length).toBeGreaterThan(0);

    const repaired = entries.reduce(
      (tree, entry) => repairInvalidSlot(tree, entry, defaultBlockRegistry),
      root
    );

    expect(
      validateDocument(doc(repaired), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
  });

  it("reports a child a DECLARED slot refuses, which is also unsaveable", () => {
    // The finder's claim is what the write path refuses, and an allowlist refusal is refused
    // exactly as an undeclared slot name is. Run with the empty registry the config and server
    // paths have, so it is structure answering rather than a loaded renderer.
    const root = withSlots("core/container", {
      default: [
        withSlots("core/columns", {
          default: [heading("Left"), heading("Right")],
        }),
      ],
    });

    expect(
      validateDocument(doc(root), defaultBlockRegistry, { allowUnknown: true })
    ).toContain("is not allowed in slot");

    const entries = findInvalidSlotEntries(root, defaultBlockRegistry);
    expect(entries.map(e => e.kind)).toEqual(["not-allowed", "not-allowed"]);

    const repaired = entries.reduce(
      (tree, entry) => repairInvalidSlot(tree, entry, defaultBlockRegistry),
      root
    );

    expect(
      validateDocument(doc(repaired), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);

    // The repair KEPT both blocks. Every other entry kind removes, so a repair that quietly
    // deleted here would still satisfy the validator above and lose the author's content.
    // What the wrapper is BUILT from is not assertable here and deliberately is not asserted: this
    // file runs with an empty registry, so a definition-backed construction and an empty one look
    // identical. `InvalidSlotBanner.test.tsx` makes that claim, where the registry is populated.
    const row = repaired.slots?.default?.[0];
    expect(row?.slots?.default).toHaveLength(2);
    expect(
      row?.slots?.default?.map(c => c.slots?.default?.[0]?.props?.text)
    ).toEqual(["Left", "Right"]);
  });

  it("does not offer a wrapper the inner slot would refuse in turn", () => {
    // Wrapping is only correct when it produces a SAVEABLE document. A permitted container whose
    // own default slot excludes the child would move the refusal one level down and leave the
    // page exactly as unsaveable, while the banner reported the repair as done.
    const own = createBlockRegistry();
    own.register({
      type: "test/row",
      version: 1,
      label: "Row",
      icon: "Square",
      category: "layout",
      defaultProps: {},
      isContainer: true,
      slots: [{ name: "default", allowedBlocks: ["test/cell"] }],
      render: () => null,
    });
    own.register({
      type: "test/cell",
      version: 1,
      label: "Cell",
      icon: "Square",
      category: "layout",
      defaultProps: {},
      isContainer: true,
      slots: [{ name: "default", allowedBlocks: ["test/only"] }],
      render: () => null,
    });

    const root = withSlots("test/row", { default: [heading("Refused")] });
    const [entry] = findInvalidSlotEntries(root, own);
    expect(entry.kind).toBe("not-allowed");
    expect(entry.kind === "not-allowed" && entry.wrapWith).toBeUndefined();

    // The control that makes that absence mean something. `undefined` is what every other way of
    // failing this lookup returns too — an unregistered wrapper, a non-container, a missing
    // default slot — so the SAME shape with only the inner allowlist widened has to offer it.
    const permissive = createBlockRegistry();
    for (const d of own.all()) {
      permissive.register(
        d.type === "test/cell" ? { ...d, slots: [{ name: "default" }] } : d
      );
    }
    const [offered] = findInvalidSlotEntries(root, permissive);
    expect(offered.kind === "not-allowed" && offered.wrapWith).toBe(
      "test/cell"
    );

    // And the repair it does prescribe still makes the document save.
    expect(
      validateDocument(doc(repairInvalidSlot(root, entry, own)), own, {
        allowUnknown: true,
      })
    ).toBe(true);
  });

  it("drops the emptied slot, because the NAME is what validation refuses", () => {
    // The repair has to remove the slot and not just its contents. Taking the last child out with
    // an ordinary delete leaves the key behind, and the key alone is refused — so an author who
    // removed every block the banner listed would be refused again with nothing left to remove.
    const only = heading("Last one out");
    const root = withSlots("core/container", { gone: [only] });

    const byNode = removeNode(root, only.id);
    expect(byNode.slots).toEqual({ gone: [] });
    expect(
      validateDocument(doc(byNode), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toContain("has no slot");

    const bySlot = removeFromSlot(
      root,
      root.id,
      "gone",
      only.id,
      declaredSlotNames(root, root.id, defaultBlockRegistry)
    );
    // The stale key goes and the DECLARED one stays. The canvas builds a drop zone per stored key,
    // so a container left holding none would render no drop target and stop accepting blocks —
    // worst on the page root, whose declared slot is the whole page.
    expect(bySlot.slots).toEqual({ default: [] });
    expect(
      validateDocument(doc(bySlot), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
  });

  it("keeps a slot that still has children in it", () => {
    // The other direction of the same rule: dropping the key on every removal would delete a
    // sibling's home while it is still occupied.
    const first = heading("First");
    const second = heading("Second");
    const root = withSlots("core/container", { legacy: [first, second] });

    const after = removeFromSlot(
      root,
      root.id,
      "legacy",
      first.id,
      declaredSlotNames(root, root.id, defaultBlockRegistry)
    );
    expect(after.slots?.legacy?.map(n => n.id)).toEqual([second.id]);
  });

  it("descends through declared slots to reach an undeclared one further down", () => {
    // The case that makes descent necessary: the offending slot belongs to a container nested
    // inside perfectly valid ones, so a finder that only looked at the root would report nothing
    // while the page stayed unsaveable.
    const buried = heading("Buried");
    const root = withSlots("core/container", {
      default: [
        withSlots("core/row", {
          default: [withSlots("core/columns", { ghost: [buried] })],
        }),
      ],
    });

    const entries = findInvalidSlotEntries(root, defaultBlockRegistry);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.node.id).toBe(buried.id);
    expect(entries[0]?.slotName).toBe("ghost");
    expect(entries[0]?.parentType).toBe("core/columns");
    expect(entries[0]?.path).toBe("core/container → core/row → core/columns");
  });

  it("reports only the outermost block of a branch, and counts what goes with it", () => {
    // Entries are removal targets. A block already inside a reported block needs no separate
    // decision, and offering one would mean a second Remove with nothing left to act on.
    const inner = withSlots("core/row", { stale: [heading("Deeper orphan")] });
    const outer = withSlots("core/container", { default: [inner] });
    const root = withSlots("core/container", { gone: [outer] });

    const entries = findInvalidSlotEntries(root, defaultBlockRegistry);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.node.id).toBe(outer.id);
    // outer holds inner, which holds one heading.
    expect(entries[0]?.descendantCount).toBe(2);

    // And the claim that made it safe to stop there: removing the one entry leaves a document
    // the validator accepts, nested undeclared slot and all.
    const repaired = removeFromSlot(
      root,
      root.id,
      "gone",
      outer.id,
      declaredSlotNames(root, root.id, defaultBlockRegistry)
    );
    expect(
      validateDocument(doc(repaired), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
  });

  it("lists siblings in document order", () => {
    const first = heading("First");
    const second = heading("Second");
    const root = withSlots("core/container", { legacy: [first, second] });

    expect(
      findInvalidSlotEntries(root, defaultBlockRegistry).map(e => e.node.id)
    ).toEqual([first.id, second.id]);
  });

  it("reports a stale slot that is ALREADY empty, which nothing else would offer", () => {
    // `{ legacy: [] }` is refused by name, and there is no child to hang an entry on. A finder
    // that only walked children would report nothing while the page stayed unsaveable, which is
    // the precise state this whole surface exists to get an author out of.
    const root = withSlots("core/container", { legacy: [] });

    expect(
      validateDocument(doc(root), defaultBlockRegistry, { allowUnknown: true })
    ).toContain('has no slot "legacy"');

    const entries = findInvalidSlotEntries(root, defaultBlockRegistry);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("empty-slot");

    const repaired = removeSlot(
      root,
      root.id,
      "legacy",
      declaredSlotNames(root, root.id, defaultBlockRegistry)
    );
    expect(
      validateDocument(doc(repaired), defaultBlockRegistry, {
        allowUnknown: true,
      })
    ).toBe(true);
  });

  it("reports a leftover slots map on a block that may hold none", () => {
    // A registered non-container is refused for holding a slots object at all, before any key is
    // read. With no keys there is nothing narrower to remove, so the map itself is the repair.
    const own = createBlockRegistry();
    own.register({
      type: "core/heading",
      version: 1,
      label: "H",
      isContainer: false,
      defaultProps: {},
      render: () => null,
    } as never);

    const root: BlockNode = { ...heading("Leaf"), slots: {} };

    expect(validateDocument(doc(root), own, { allowUnknown: true })).toContain(
      "cannot have slots"
    );

    const entries = findInvalidSlotEntries(root, own);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe("stray-slots");

    expect(
      validateDocument(doc(dropSlots(root, root.id)), own, {
        allowUnknown: true,
      })
    ).toBe(true);
  });

  it("leaves an UNREGISTERED block's empty slots map alone, because it saves", () => {
    // The neighbouring case, and the one direction that must not become a report: without a
    // registered definition the validator never reaches the container check, so an empty map on
    // an unknown block is fine and offering to strip it would be destroying valid data.
    const root: BlockNode = { ...makeNode("acme/not-loaded", {}), slots: {} };

    expect(
      validateDocument(doc(root), defaultBlockRegistry, { allowUnknown: true })
    ).toBe(true);
    expect(findInvalidSlotEntries(root, defaultBlockRegistry)).toEqual([]);
  });

  it("says nothing about a type this build has no structure for", () => {
    // The validator leaves these to `allowUnknown`, so a page saved while a plugin is unloaded is
    // not broken. If the finder disagreed, the banner would offer to delete blocks that save.
    const root = withSlots("acme/not-loaded", {
      whatever: [heading("Foreign")],
    });

    expect(
      validateDocument(doc(root), defaultBlockRegistry, { allowUnknown: true })
    ).toBe(true);
    expect(findInvalidSlotEntries(root, defaultBlockRegistry)).toEqual([]);
  });

  it("reports children of a block whose structure declares no slots at all", () => {
    // `slots: []` is a statement, not an omission: children are junk on a leaf. This is the
    // neighbouring case to the one above and the two look identical at the lookup.
    const junk = makeNode("core/paragraph", { text: "junk" });
    const root: BlockNode = { ...heading("Leaf"), slots: { anything: [junk] } };

    expect(findInvalidSlotEntries(root, defaultBlockRegistry)).toHaveLength(1);
    expect(findInvalidSlotEntries(root, defaultBlockRegistry)[0]?.node.id).toBe(
      junk.id
    );
  });

  it("lets a registered definition's own slot list be the whole answer", () => {
    // A definition that declares no slots is stating what its renderer exposes. Falling back to
    // the built-in structure would clear a block the definition's own renderer never draws, so the
    // finder branches on which source answered rather than coalescing them.
    const own = createBlockRegistry();
    own.register({
      type: "core/container",
      version: 1,
      label: "Mine",
      isContainer: true,
      defaultProps: {},
      render: () => null,
    } as never);

    const child = heading("Drawn by nobody");
    const root = withSlots("core/container", { default: [child] });

    // Positive control: against structure alone `default` is declared, so a fallback would report
    // nothing here and the assertion below would be vacuous.
    expect(findInvalidSlotEntries(root, defaultBlockRegistry)).toEqual([]);

    const entries = findInvalidSlotEntries(root, own);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.node.id).toBe(child.id);
    expect(entries[0]?.slotName).toBe("default");
  });
});

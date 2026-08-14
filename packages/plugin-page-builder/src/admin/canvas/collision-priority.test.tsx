/**
 * Every drop target the canvas registers ranks on ONE scale: its depth in the tree.
 *
 * dnd-kit sorts collisions by priority before collision type and before overlap value, so
 * priority decides the winner outright wherever two targets collide at once. A droppable that
 * omits `collisionPriority` does not get a neutral default — it keeps whatever the detector
 * assigned, which is `High` (3) when the pointer is inside the element and `Normal` (2)
 * otherwise. Those are constants, and the depth scale is not: a target left unset therefore
 * outranks every zone shallower than that constant no matter how the rectangles lie, and loses
 * to nothing above it however deeply it is nested.
 *
 * That is why this reads the priorities off the ACTUAL `useDroppable` calls rather than checking
 * the three call sites by eye. The values have to be comparable with each other, and a test that
 * restated them would agree with a call site that had drifted.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeNode } from "../../core/tree";
import type { BlockNode } from "../../core/types";
import { EditorProvider } from "../store/EditorProvider";

import { CanvasNode } from "./CanvasNode";

import "../../render/blocks/index";

interface Registered {
  id: string;
  disabled: boolean;
  collisionPriority: unknown;
}

const registered: Registered[] = [];

// The real hooks reach for a DragDropProvider and a live DOM, neither of which exists under
// `renderToStaticMarkup`. Only the shape each caller destructures is stood in for; the inputs are
// recorded exactly as passed, so what is asserted below is what the component really sent.
vi.mock("@dnd-kit/react", () => ({
  useDraggable: () => ({ ref: () => {}, isDragging: false }),
  useDroppable: (input: {
    id: string;
    disabled?: boolean;
    collisionPriority?: number;
  }) => {
    registered.push({
      id: input.id,
      disabled: input.disabled ?? false,
      collisionPriority: input.collisionPriority,
    });
    return { ref: () => {}, isDropTarget: false };
  },
  useDragDropMonitor: () => {},
}));

/**
 * A container nested deeply enough that the depth scale and the detector's constant DISAGREE.
 *
 * Depth matters to the fixture rather than being incidental. The unset priority is 2 or 3, so at
 * depths 0-2 an unset target happens to rank about where the tree would put it anyway and the
 * defect is invisible. The grid below sits at depth 3, where its own append target belongs at 4
 * and an unset one arrives at 2 or 3 — at or below the zones of the container holding it, which
 * is the inversion.
 */
function deepTree(): BlockNode {
  const leaf = makeNode("core/heading");
  const grid = makeNode("core/grid");
  grid.slots = { default: [leaf] };
  const inner = makeNode("core/container");
  inner.slots = { default: [grid] };
  const outer = makeNode("core/container");
  outer.slots = { default: [inner] };
  const root = makeNode("core/container");
  root.slots = { default: [outer] };
  return root;
}

/**
 * A root that declares a formatted slot, which is the only shape reaching the ROOT append target.
 *
 * `deepTree` cannot: its root is a plain container, whose append target is disabled because it
 * declares no formatted slot. A container renders its slot content one level deeper, so the root's
 * own append competes with the insert-before targets of the children it holds — the same slot,
 * therefore the same rank.
 */
function formattedRoot(): BlockNode {
  const root = makeNode("core/grid");
  root.slots = {
    default: [makeNode("core/heading"), makeNode("core/heading")],
  };
  return root;
}

function render(root: BlockNode): void {
  renderToStaticMarkup(
    <EditorProvider
      document={{ version: 1, root }}
      draftKey="nx-pb-test:collision-priority"
    >
      <CanvasNode node={root} />
    </EditorProvider>
  );
}

/** The priority of the one enabled droppable with this id, or `undefined` if it never registered. */
function priorityOf(id: string): unknown {
  const hit = registered.filter(r => r.id === id && !r.disabled);
  return hit.length === 1 ? hit[0].collisionPriority : undefined;
}

describe("canvas drop targets rank on one scale", () => {
  beforeEach(() => {
    registered.length = 0;
  });

  it("registers the targets this tree is built to exercise", () => {
    const root = deepTree();
    render(root);

    const grid = root.slots!.default[0].slots!.default[0].slots!.default[0];
    expect(grid.type).toBe("core/grid");

    // The population assertion, by MEMBERSHIP rather than by count. Every claim below is about
    // these targets, and each of them is silently satisfied by a target that never registered:
    // `priorityOf` answers `undefined` for "absent" exactly as it does for "unset", so without
    // this the whole file would pass against a render that produced no droppables at all.
    const enabled = registered.filter(r => !r.disabled).map(r => r.id);
    expect(enabled).toContain(`append:${grid.id}`);
    expect(enabled).toContain(`dz:${root.slots!.default[0].id}:default:0`);
  });

  // Both fixtures, because between them they enable all three call sites and neither does alone:
  // a plain-container root disables the root append, and a formatted root produces no zones.
  it.each([
    ["a deeply nested tree", deepTree],
    ["a root that appends into its own slot", formattedRoot],
  ])("gives every enabled target in %s a numeric priority", (_label, build) => {
    render(build());

    // An unset priority is the defect itself, so this is the direct statement of it. It is not a
    // stand-in for the ordering assertions below — a scale can be fully populated and still be
    // ordered wrongly — but a single unset target is enough to make every ordering meaningless,
    // because it silently ranks by a constant the others are not measured against.
    const unset = registered
      .filter(r => !r.disabled)
      .filter(r => typeof r.collisionPriority !== "number")
      .map(r => r.id);
    expect(unset).toEqual([]);

    // Asserted here rather than left implicit: an empty enabled set has no unset members either,
    // so the check above is satisfied perfectly by a render that registered nothing at all.
    expect(registered.filter(r => !r.disabled).length).toBeGreaterThan(0);
  });

  it("ranks a container's own append target above the zones holding it", () => {
    const root = deepTree();
    render(root);

    const inner = root.slots!.default[0].slots!.default[0];
    const grid = inner.slots!.default[0];

    // The grid appends into its OWN slot, so it competes with what is inside it, not with its
    // siblings — one level below the zones of the slot the grid itself sits in.
    const append = priorityOf(`append:${grid.id}`);
    const siblingZone = priorityOf(`dz:${inner.id}:default:0`);

    expect(typeof append).toBe("number");
    expect(typeof siblingZone).toBe("number");
    expect(append as number).toBeGreaterThan(siblingZone as number);
  });

  it("ranks the root's own append target with the slot it appends to", () => {
    const root = formattedRoot();
    render(root);

    const [first] = root.slots!.default;

    // Both target the root's default slot — one at the end, one before the first child — so they
    // are peers and must tie, leaving geometry to separate them. This is the third call site, and
    // `deepTree` cannot reach it: without a fixture whose root declares a formatted slot, the
    // root append is disabled and every assertion about it passes by never having been made.
    const rootAppend = priorityOf(`append:${root.id}`);
    const childBefore = priorityOf(`before:${first.id}`);

    expect(typeof rootAppend).toBe("number");
    expect(typeof childBefore).toBe("number");
    expect(rootAppend).toBe(childBefore);
  });

  it("ranks a deeper zone above a shallower one", () => {
    const root = deepTree();
    render(root);

    const outer = root.slots!.default[0];
    const inner = outer.slots!.default[0];

    // The two zones a drag between these levels has to choose between. Out of flow they can
    // occupy the same y, which leaves a geometric detector nothing to separate them by — the
    // whole reason the scale exists.
    const shallow = priorityOf(`dz:${root.id}:default:0`);
    const deep = priorityOf(`dz:${inner.id}:default:0`);

    expect(typeof shallow).toBe("number");
    expect(typeof deep).toBe("number");
    expect(deep as number).toBeGreaterThan(shallow as number);
  });
});

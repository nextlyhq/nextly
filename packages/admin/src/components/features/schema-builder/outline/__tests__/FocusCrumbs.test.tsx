/**
 * The breadcrumb's crumbs as places to drop: which level each one names, the focused one
 * included, and a container Focus cannot show named without being a way back or a place.
 */
import type { ClientRect, DroppableContainer } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { focusView } from "@admin/lib/builder/outline/focus-view";
import {
  buildOutline,
  flattenOutline,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import {
  nestedFixtureBlockCatalogs,
  nestedFixtureFieldGroups,
  nestedFixtureFields,
} from "../../__fixtures__/nested-fixture";
import { crumbsByPointer, crumbTargetOf, FocusCrumbs } from "../FocusCrumbs";

/** Each drop place the crumbs register, by what a drag over it is called aloud. */
const registered = vi.hoisted(() => new Map<string, string>());

vi.mock("@dnd-kit/core", async importOriginal => {
  const original = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...original,
    useDroppable: ({
      id,
      data,
    }: {
      id: string;
      data?: { spoken?: string };
    }) => {
      registered.set(data?.spoken ?? "", id);
      return { setNodeRef: () => undefined, isOver: false };
    },
  };
});

function outline(): OutlineNode[] {
  return buildOutline(nestedFixtureFields(), {
    entityReadOnly: false,
    fieldGroups: nestedFixtureFieldGroups(),
    blockCatalogs: nestedFixtureBlockCatalogs(),
  });
}

function node(nodes: readonly OutlineNode[], id: string): OutlineNode {
  const found = flattenOutline(nodes).find(each => each.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

/** Where a drop on the crumb called `label` puts a field. */
const dropOn = (label: string) =>
  crumbTargetOf(registered.get(`${label}, in the breadcrumb`) ?? "");

describe("the breadcrumb's drop places", () => {
  it("puts a field at the end of the level each crumb names, the focused one included", () => {
    registered.clear();
    const view = focusView(outline(), "f-items-cta");
    render(
      <FocusCrumbs crumbs={view.crumbs} onGo={vi.fn()} onExit={vi.fn()} />
    );
    expect(dropOn("All fields")).toEqual({});
    expect(dropOn("Sections")).toEqual({ parentFieldId: "f-sections" });
    expect(dropOn("Items")).toEqual({ parentFieldId: "f-sections-items" });
    expect(dropOn("Call to action")).toEqual({ parentFieldId: "f-items-cta" });
  });

  it("names a container Focus cannot show, without making it a way back or a place", () => {
    registered.clear();
    const nodes = outline();
    // A field group above the focused container: changed in its own editor, never focused.
    const crumbs = [node(nodes, "f-seo"), node(nodes, "f-meta")];
    render(<FocusCrumbs crumbs={crumbs} onGo={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText("SEO").closest("button")).toBeNull();
    expect(screen.getByRole("button", { name: "All fields" })).toBeTruthy();
    expect(registered.has("SEO, in the breadcrumb")).toBe(false);
  });
});

/** A rectangle at `left`, `top`, `width` wide and `height` high. */
function rect(
  left: number,
  top: number,
  width: number,
  height: number
): ClientRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

/** What a drag over these places, with the dragged row at `dragged` and the pointer at `x`, `y`, is over. */
function overAt(
  places: Record<string, ClientRect>,
  dragged: ClientRect,
  x: number,
  y: number
): string[] {
  const ids = Object.keys(places);
  const containers = ids.map(
    id => ({ id, key: id, data: { current: undefined } }) as unknown as DroppableContainer
  );
  return crumbsByPointer({
    active: { id: "f-label" } as never,
    collisionRect: dragged,
    droppableRects: new Map(ids.map(id => [id, places[id]])),
    droppableContainers: containers,
    pointerCoordinates: { x, y },
  }).map(each => String(each.id));
}

describe("crumbsByPointer", () => {
  // Two crumbs side by side, the focused one wider, and a row below them.
  const places = {
    "focus-crumb:f-sections-items": rect(100, 0, 50, 20),
    "focus-crumb:f-items-cta": rect(155, 0, 105, 20),
    "f-kind": rect(0, 40, 800, 40),
  };
  // A dragged row is far wider than a crumb: level with the crumbs, it overlaps the focused one
  // more than the one under the pointer, and no row.
  const dragged = rect(110, 0, 700, 20);

  it("is over the crumb under the pointer, whatever the dragged row overlaps most", () => {
    expect(overAt(places, dragged, 125, 10)).toEqual([
      "focus-crumb:f-sections-items",
    ]);
  });

  it("is never over a crumb the pointer is not on", () => {
    // The pointer in the gap between the two crumbs: overlap alone would pick the focused one.
    expect(overAt(places, dragged, 152, 10)).toEqual([]);
    // The pointer on the row below, the dragged row over it: the row, as by overlap.
    expect(overAt(places, rect(110, 30, 700, 40), 500, 50)).toEqual([
      "f-kind",
    ]);
  });
});

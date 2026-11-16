/**
 * The breadcrumb's crumbs as places to drop: which level each one names, the focused one
 * included, and a container Focus cannot show named without being a way back or a place.
 */
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
import { crumbTargetOf, FocusCrumbs } from "../FocusCrumbs";

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

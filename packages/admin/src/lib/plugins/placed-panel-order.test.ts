/**
 * The document panel's order on either edit page, from the page's place by
 * the one rule every place part follows: nothing contributed before the page
 * knows who is looking, a replacement it cannot draw giving its built-in back,
 * and a Single's page ordered from its own place.
 */
import type { AdminContributionsMeta } from "nextly/config";
import { describe, expect, it } from "vitest";

import {
  panelOrderFor,
  placedPanelOrder,
  type PanelOrderEntry,
} from "./document-surfaces";

function section(id: string, extra: object = {}) {
  return {
    plugin: "@acme/a",
    id,
    kind: "sidebarSection",
    label: id,
    component: "@acme/a/admin#Section",
    ...extra,
  };
}

/** The order as names: a built-in's, or a section's id. */
function names(order: PanelOrderEntry[] | undefined): string[] | undefined {
  return order?.map(part => (part.kind === "builtIn" ? part.name : part.id));
}

const POSTS = { userId: "u1", collection: "posts", entryId: "e1" };

describe("the document panel's order from the page's place", () => {
  it("holds every declared section before the page knows who is looking, giving a replaced built-in back", () => {
    const contributions = {
      "collection.edit": {
        sidebarSection: [
          section("acme-a.status", { replaces: "status" }),
          section("acme-a.notes", { after: "publishing" }),
          { builtIn: "publishing" },
        ],
      },
    } as AdminContributionsMeta;

    expect(
      names(
        placedPanelOrder(contributions, "collection.edit", { context: null })
      )
    ).toEqual(["status", "publishing"]);
    expect(
      names(
        placedPanelOrder(contributions, "collection.edit", { context: POSTS })
      )
    ).toEqual(["acme-a.status", "acme-a.notes", "publishing"]);
  });

  it("orders a Single's page from its own place, not a collection entry's", () => {
    const contributions = {
      "collection.edit": { sidebarSection: [section("acme-a.posts-only")] },
      "single.edit": {
        sidebarSection: [{ builtIn: "status" }, section("acme-a.single")],
      },
    } as AdminContributionsMeta;

    expect(
      names(
        placedPanelOrder(contributions, "single.edit", {
          context: { userId: "u1", single: "homepage" },
        })
      )
    ).toEqual(["status", "acme-a.single"]);
  });

  it("reads a collection entry's order by slug as a page that knows who is looking", () => {
    const contributions = {
      "collection.edit": {
        sidebarSection: [
          section("acme-a.tickets", { collections: ["tickets"] }),
          { builtIn: "details" },
        ],
      },
    } as AdminContributionsMeta;

    expect(
      names(panelOrderFor(contributions, "tickets", { id: "e1" }))
    ).toEqual(
      names(
        placedPanelOrder(contributions, "collection.edit", {
          context: { ...POSTS, collection: "tickets" },
          entry: { id: "e1" },
        })
      )
    );
    expect(names(panelOrderFor(contributions, "posts", { id: "e1" }))).toEqual([
      "details",
    ]);
  });
});

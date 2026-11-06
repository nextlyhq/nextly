/**
 * Which of a place's delivered entries a page draws. The server sends each
 * place's lists once per reader, so a contribution scoped to some
 * collections, or ruled by `visibleWhen`, arrives on every page of its place,
 * and only the page can tell whether it belongs there. One that does not, and
 * replaces a built-in part, gives that part back where it stood; nor is
 * anything contributed drawn before the page knows who is looking.
 */
import { renderHook } from "@testing-library/react";
import type {
  AdminContributionsMeta,
  DeliveredAdminEntry,
} from "nextly/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  usePlaceContributions,
  type PlaceView,
} from "../usePlaceContributions";

const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));
vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ contributions: meta.contributions }),
}));

afterEach(() => {
  meta.contributions = undefined;
});

const ON = (collection: string) => ({
  userId: "u1",
  collection,
  entryId: "e1",
});

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

function block(id: string, extra: object = {}) {
  return {
    plugin: "@acme/a",
    id,
    kind: "block",
    component: "@acme/a/admin#Block",
    ...extra,
  };
}

/** The entries drawn, as names: a built-in's, or a contribution's id. */
function drawn(
  kind: "block" | "sidebarSection",
  entries: object[],
  view: PlaceView
): string[] {
  meta.contributions = {
    "collection.edit": { [kind]: entries },
  } as AdminContributionsMeta;
  const { result } = renderHook(() =>
    usePlaceContributions("collection.edit", kind, view)
  );
  return result.current.map((item: DeliveredAdminEntry) =>
    "builtIn" in item ? item.builtIn : item.id
  );
}

describe("the entries a page draws of its place", () => {
  it("draws a contribution scoped to collections only on a page of one of them", () => {
    const entries = [
      { builtIn: "status" },
      section("acme-a.sla", { collections: ["tickets"] }),
      { builtIn: "publishing" },
    ];

    expect(
      drawn("sidebarSection", entries, { context: ON("tickets") })
    ).toEqual(["status", "acme-a.sla", "publishing"]);
    expect(drawn("sidebarSection", entries, { context: ON("posts") })).toEqual([
      "status",
      "publishing",
    ]);
  });

  it("gives a built-in back on a page a replacement scoped elsewhere does not belong on", () => {
    // As the server sends it: the replacement where the built-in was, and the
    // built-in no more.
    const entries = [
      section("acme-a.status", {
        replaces: "status",
        collections: ["tickets"],
      }),
      { builtIn: "publishing" },
    ];

    expect(drawn("sidebarSection", entries, { context: ON("posts") })).toEqual([
      "status",
      "publishing",
    ]);
    expect(
      drawn("sidebarSection", entries, { context: ON("tickets") })
    ).toEqual(["acme-a.status", "publishing"]);
  });

  it("gives a built-in back where a replacement's rule does not match the entry", () => {
    const entries = [
      { builtIn: "document-bar" },
      block("acme-a.editor", {
        replaces: "editor",
        visibleWhen: { field: "status", equals: "draft" },
        collections: ["posts"],
      }),
    ];

    expect(
      drawn("block", entries, {
        context: ON("posts"),
        entry: { id: "e1", status: "published" },
      })
    ).toEqual(["document-bar", "editor"]);
    expect(
      drawn("block", entries, {
        context: ON("posts"),
        entry: { id: "e1", status: "draft" },
      })
    ).toEqual(["document-bar", "acme-a.editor"]);
  });

  it("gives a built-in back, and draws nothing contributed, while the viewer is not known", () => {
    const entries = [
      { builtIn: "document-bar" },
      block("acme-a.notice"),
      block("acme-a.editor", { replaces: "editor" }),
    ];

    expect(drawn("block", entries, { context: null })).toEqual([
      "document-bar",
      "editor",
    ]);
    expect(drawn("block", entries, { context: ON("posts") })).toEqual([
      "document-bar",
      "acme-a.notice",
      "acme-a.editor",
    ]);
  });

  it("draws no contribution scoped to collections on a page that names none", () => {
    expect(
      drawn(
        "sidebarSection",
        [section("acme-a.sla", { collections: ["posts"] })],
        {
          context: { userId: "u1" },
        }
      )
    ).toEqual([]);
  });
});

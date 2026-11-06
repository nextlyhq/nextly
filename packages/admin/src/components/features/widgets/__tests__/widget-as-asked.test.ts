/**
 * A placed widget as its reader's settings ask it: the settings its component
 * is handed, the title it is drawn under, and whether a card set to a
 * collection reads anything there, as its widget's `load` would.
 */
import type { PublishedContentSource } from "nextly/config";
import { describe, expect, it } from "vitest";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import {
  askableQuery,
  askableWith,
  settingsAsAsked,
  titleAsAsked,
} from "../widget-as-asked";
import { gridBounds } from "./grid-bounds";

describe("a card set to a collection", () => {
  const posts: PublishedContentSource = {
    collection: "posts",
    label: "Posts",
    lifecycle: true,
    fields: [{ name: "title", label: "Title", type: "string" }],
  };
  const count: DashboardWidget = {
    id: "core/count",
    title: "Count",
    archetype: "custom",
    size: gridBounds(3),
    settings: [
      { name: "collection", label: "Collection", type: "collection" },
      { name: "filter", label: "Filter", type: "filter", of: "collection" },
    ],
  } as DashboardWidget;

  it("hands the card the Filter it is read with, not a stored one set aside", () => {
    const stored = { collection: "posts", filter: { salary: { gt: 1 } } };
    expect(settingsAsAsked(count, stored, [posts]).filter).toBeUndefined();
    const kept = { collection: "posts", filter: { title: { equals: "a" } } };
    expect(settingsAsAsked(count, kept, [posts]).filter).toEqual({
      title: { equals: "a" },
    });
  });

  it("is titled by its subject, the collection it is set to, with its widget's name beneath", () => {
    expect(titleAsAsked(count, { collection: "posts" }, [posts])).toEqual({
      title: "Posts",
      subtitle: "Count",
    });
    // A collection with no published label is named as stored.
    expect(titleAsAsked(count, { collection: "drafts" }, [posts])).toEqual({
      title: "drafts",
      subtitle: "Count",
    });
  });

  it("is titled as its widget, with no subtitle, when set to no collection", () => {
    expect(titleAsAsked(count, {}, [posts])).toEqual({ title: "Count" });
  });

  it("names its quick select's choice in its automatic title, with its widget's name beneath", () => {
    const overTime: DashboardWidget = {
      ...count,
      id: "core/over-time",
      title: "Over time",
      settings: [
        { name: "collection", label: "Collection", type: "collection" },
        {
          name: "dateRange",
          label: "Date range",
          type: "select",
          quick: true,
          defaultValue: "30d",
          options: [
            { label: "Last 30 days", value: "30d" },
            { label: "Last 90 days", value: "90d" },
          ],
        },
      ],
    } as DashboardWidget;
    // Untouched, a new card's title is its subject and its 30-day range.
    expect(titleAsAsked(overTime, { collection: "posts" }, [posts])).toEqual({
      title: "Posts · last 30 days",
      subtitle: "Over time",
    });
    expect(
      titleAsAsked(overTime, { collection: "posts", dateRange: "90d" }, [posts])
    ).toEqual({ title: "Posts · last 90 days", subtitle: "Over time" });
  });

  it("takes the title its reader gave it in place of the automatic one, keeping its widget's name beneath", () => {
    expect(
      titleAsAsked(count, { collection: "posts" }, [posts], "  Our posts ")
    ).toEqual({ title: "Our posts", subtitle: "Count" });
    // A card set to no collection keeps the widget's name beneath its own title too.
    expect(titleAsAsked(count, {}, [posts], "Everything")).toEqual({
      title: "Everything",
      subtitle: "Count",
    });
    // A title of only spaces is no title: the automatic one stands.
    expect(titleAsAsked(count, { collection: "posts" }, [posts], "  ")).toEqual(
      { title: "Posts", subtitle: "Count" }
    );
    // The widget's own name as the title draws it once, never twice.
    expect(titleAsAsked(count, {}, [posts], "Count")).toEqual({
      title: "Count",
    });
  });

  it("names no quick toggle's On or Off, which says nothing on its own", () => {
    const toggled: DashboardWidget = {
      ...count,
      settings: [
        { name: "collection", label: "Collection", type: "collection" },
        { name: "mine", label: "Mine only", type: "checkbox", quick: true },
      ],
    } as DashboardWidget;
    expect(titleAsAsked(toggled, { collection: "posts" }, [posts])).toEqual({
      title: "Posts",
      subtitle: "Count",
    });
  });
});

describe("whether a card can be asked", () => {
  const choices = [{ value: "a", label: "A" }];
  const sources: PublishedContentSource[] = [
    {
      collection: "posts",
      label: "Posts",
      lifecycle: true,
      fields: [{ name: "status", type: "string", choices }],
    },
    {
      collection: "notes",
      label: "Notes",
      lifecycle: false,
      fields: [{ name: "title", type: "string" }],
    },
  ];
  // Core's declared Breakdown and Recent entries, as the registry publishes them: no query, their
  // data answered on the server, so each is judged by what its `load` would read.
  const declaredBreakdown = {
    id: "core/breakdown",
    title: "Breakdown",
    archetype: "custom",
    settings: [
      { name: "collection", type: "collection" },
      {
        name: "groupBy",
        type: "groupBy",
        of: "collection",
        defaultFrom: "collection",
      },
    ],
  } as unknown as DashboardWidget;
  const declaredRecent = {
    id: "core/recent-entries",
    title: "Recent entries",
    archetype: "custom",
    settings: [{ name: "collection", type: "collection", rows: "titled" }],
  } as unknown as DashboardWidget;
  const titled: PublishedContentSource[] = [
    {
      collection: "posts",
      label: "Posts",
      lifecycle: true,
      titleField: "title",
      fields: [
        { name: "title", type: "string" },
        { name: "updatedAt", type: "date" },
      ],
    },
    ...sources.slice(1),
  ];

  it("offers a card core answers only where its load would read: something to divide by", () => {
    expect(
      askableWith(declaredBreakdown, { collection: "posts" }, sources)
    ).toBe(true);
    // 🔴 With no query to judge, a test of the query alone read every card as
    // askable, and a Breakdown was offered on a collection it divides by nothing.
    expect(
      askableWith(declaredBreakdown, { collection: "notes" }, sources)
    ).toBe(false);
  });

  it("offers a titled list core answers only on a collection that titles its rows", () => {
    expect(askableWith(declaredRecent, { collection: "posts" }, titled)).toBe(
      true
    );
    // Notes publishes no title field to name its rows by.
    expect(askableWith(declaredRecent, { collection: "notes" }, titled)).toBe(
      false
    );
  });

  it("offers a card core answers with no such setting wherever it is asked", () => {
    const note = {
      id: "core/note",
      title: "Note",
      archetype: "custom",
      settings: [{ name: "text", type: "textarea" }],
    } as unknown as DashboardWidget;
    expect(askableWith(note, {}, sources)).toBe(true);
  });

  it("asks a query with a source and, where grouped, a group key", () => {
    expect(askableQuery({ source: "collection:posts", op: "list" })).toBe(true);
    expect(askableQuery({ op: "list" })).toBe(false);
    expect(askableQuery({ source: "collection:posts", op: "groupBy" })).toBe(
      false
    );
  });
});

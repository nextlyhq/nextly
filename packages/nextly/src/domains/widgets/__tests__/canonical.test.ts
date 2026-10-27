/**
 * One answer to "which widgets exist", across two channels that do not share a
 * shape.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  allWidgets,
  canonicalWidgets,
  declaredWidgets,
  placedByDefault,
  sizeFacts,
  type CanonicalWidget,
} from "../canonical";
import { setGeneratedWidgets } from "../collection-widgets";
import type { WidgetDefinition } from "../definition";
import { sizeBounds } from "../grid-size";
import { clearWidgets, registerWidget } from "../registry";
import { UNSTATED_WIDGET_SIZE } from "../unstated-size";

function registered(patch: Partial<WidgetDefinition>): WidgetDefinition {
  const definition = {
    id: "core/a",
    title: "A",
    archetype: "custom",
    size: { default: { w: 12, h: 4 } },
    component: "core#A",
    ...patch,
  };
  // A key set to `undefined` is one JSON drops, and a registration carrying
  // one is not one the admin may receive -- so a patch that unsets the base
  // fixture's `component` removes the key rather than voiding it.
  return withoutUndefined(definition) as WidgetDefinition;
}

/** `value` less every key set to `undefined`. */
function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}

beforeEach(() => clearWidgets());

describe("the canonical widget set", () => {
  it("includes a widget that only CONTRIBUTED", () => {
    // 🔴 The defect. `listWidgets()` answers the imperative registry alone, so
    // a plugin using the documented `contributes.admin.widgets` surface was
    // absent from the default arrangement and from `available`, and every write
    // naming it was refused as unavailable — a card that renders and can never
    // be arranged.
    const contributed: CanonicalWidget[] = [{ id: "forms/latest" }];
    expect(canonicalWidgets(contributed).map(w => w.id)).toEqual([
      "forms/latest",
    ]);
  });

  it("includes widgets from both channels", () => {
    registerWidget(registered({ id: "core/team" }));
    expect(
      canonicalWidgets([{ id: "forms/latest" }])
        .map(w => w.id)
        .sort()
    ).toEqual(["core/team", "forms/latest"]);
  });

  it("lets a REGISTRATION win a collision, matching the admin's resolver", () => {
    // The two must agree. If the server ordered a card by the contribution
    // while the admin drew it from the registration, the arrangement would
    // order one declaration and render another, and nothing would look wrong.
    registerWidget(registered({ id: "dup/one", defaultOrder: 5 }));
    const merged = canonicalWidgets([{ id: "dup/one", defaultOrder: 99 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(5);
  });

  it("keeps a CONTRIBUTED order the registration did not state", () => {
    // 🔴 A collision was resolved by wholesale replacement, which the admin
    // does not do: `resolve-widgets.ts` reads
    // `registration.defaultOrder ?? contribution.defaultOrder`. So a
    // registration that stated no order dropped the contributed one here and
    // kept it there -- the server building the default arrangement from one
    // declaration while the grid drew it from another, with a card sorted into
    // a position the reader never sees.
    registerWidget(registered({ id: "dup/one" }));
    const merged = canonicalWidgets([{ id: "dup/one", defaultOrder: 99 }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(99);
  });

  it("keeps a CONTRIBUTED dismissible the registration did not state", () => {
    // 🔴 The same field-by-field rebuild one field along, and the admin's own
    // `mergeCollision` already falls back to the contribution here. Dropped on
    // this side, the browser draws a card its reader can send away while the
    // server's canonical copy of the same declaration says nothing about it --
    // and the two implementations of one merge have come apart, which is the
    // divergence this whole path exists to prevent.
    registerWidget(registered({ id: "dup/one" }));
    expect(
      canonicalWidgets([{ id: "dup/one", dismissible: true }])[0]
    ).toHaveProperty("dismissible", true);
  });

  it("keeps a CONTRIBUTED plugin, description and category the registration did not state", () => {
    // 🔴 The same rebuild again: dropped here, a registration overriding a plugin's widget moved
    // it out of that plugin's group in the add panel and lost the words a search finds it by.
    registerWidget(registered({ id: "dup/one" }));
    expect(
      canonicalWidgets([
        {
          id: "dup/one",
          plugin: "@acme/forms",
          description: "The newest submissions.",
          category: "Forms",
        },
      ])[0]
    ).toMatchObject({
      plugin: "@acme/forms",
      description: "The newest submissions.",
      category: "Forms",
    });
  });

  it("lets a REGISTRATION state its own description and category over a contribution's", () => {
    // The control: the fallback is a fallback, not a merge that always prefers the plugin.
    registerWidget(
      registered({
        id: "dup/one",
        description: "Mine.",
        category: "Ours",
      })
    );
    expect(
      canonicalWidgets([
        {
          id: "dup/one",
          plugin: "@acme/forms",
          description: "The newest submissions.",
          category: "Forms",
        },
      ])[0]
    ).toMatchObject({
      plugin: "@acme/forms",
      description: "Mine.",
      category: "Ours",
    });
  });

  it("lets a REGISTRATION state dismissible over a contribution's", () => {
    // The control: the fallback must not become a merge that always prefers the
    // contribution. A registration IS the override channel, so where it states
    // the field its answer stands -- and without this, a merge hard-coded to
    // the contribution's value would satisfy the case above.
    registerWidget(registered({ id: "dup/one", dismissible: false }));
    expect(
      canonicalWidgets([{ id: "dup/one", dismissible: true }])[0]
    ).toHaveProperty("dismissible", false);
  });

  it("keeps a CONTRIBUTED lifecycle the registration did not state", () => {
    // 🔴 The collision path dropped it. A registration that says nothing about
    // the lifecycle contributes no such fields, and the merge then returned the
    // registration's summary alone -- so a contributed conditional card became
    // permanent here and was offered forever, which is the one behaviour the
    // lifecycle exists to remove.
    registerWidget(registered({ id: "dup/one" }));
    const merged = canonicalWidgets([
      {
        id: "dup/one",
        lifecycle: "conditional",
        visibleWhen: "content:empty",
      },
    ]);
    expect(merged[0]).toHaveProperty("lifecycle", "conditional");
    expect(merged[0]).toHaveProperty("visibleWhen", "content:empty");
  });

  it("lets a registration OVERRIDE a contributed lifecycle, condition and all", () => {
    // The pair moves together. A registration stating `"always"` has decided
    // the question, and keeping the contributed condition beside it would leave
    // a `visibleWhen` on a permanent card -- a field nothing reads, describing
    // a rule that no longer applies.
    registerWidget(registered({ id: "dup/one", lifecycle: "always" }));
    const merged = canonicalWidgets([
      {
        id: "dup/one",
        lifecycle: "conditional",
        visibleWhen: "content:empty",
      },
    ]);
    expect(merged[0]).toHaveProperty("lifecycle", "always");
    expect(merged[0]).not.toHaveProperty("visibleWhen");
  });

  it("takes a Collection setting only from the declaration whose settings win", () => {
    // 🔴 The admin draws the registration's whole settings list wherever it
    // states one, so a registration stating settings without a Collection
    // setting draws a widget with none -- and its cards must not be judged by
    // the contribution's.
    const contributed: CanonicalWidget = {
      id: "dup/one",
      textBounds: [],
      collectionSetting: { name: "source", type: "collection" },
    };
    registerWidget(
      registered({
        id: "dup/one",
        settings: [{ name: "limit", type: "number", defaultValue: 5 }],
      })
    );
    const merged = canonicalWidgets([contributed])[0];
    expect(merged.collectionSetting).toBeUndefined();
    expect(merged.textBounds).toEqual([]);

    // The must-differ half: a registration stating no settings keeps the
    // contribution's, as the admin draws them.
    clearWidgets();
    registerWidget(registered({ id: "dup/one" }));
    expect(canonicalWidgets([contributed])[0].collectionSetting?.name).toBe(
      "source"
    );
  });

  it("takes the registration's queries on a collision, as the admin draws its query", () => {
    registerWidget(
      registered({
        id: "dup/one",
        archetype: "metric",
        component: undefined,
        query: { source: "single:homepage", op: "count" },
      })
    );
    const merged = canonicalWidgets([
      {
        id: "dup/one",
        knobQueries: [{ source: "collection:posts", op: "count" }],
      },
    ])[0];
    expect(merged.knobQueries).toEqual([
      { source: "single:homepage", op: "count" },
    ]);
  });

  it("asks nothing on a collision whose registration declares no query, as the admin draws it", () => {
    // 🔴 The admin's merge takes the registration's query, here none: the
    // contribution's query is not asked, so its Collection setting names no
    // collection the card reads.
    registerWidget(registered({ id: "dup/one" }));
    const merged = canonicalWidgets([
      {
        id: "dup/one",
        knobQueries: [{ source: "collection:posts", op: "count" }],
      },
    ])[0];
    expect(merged.knobQueries).toEqual([]);
  });

  it("does NOT inherit a contributed permission, matching the admin", () => {
    // The asymmetry is deliberate. The registry is the override channel, so a
    // registration that states no permission has stated that, and
    // `mergeCollision` reads it exactly that way. Falling back here would gate
    // a card the admin renders ungated -- the reader sees it and every write
    // naming it is refused, which is the same disagreement inverted.
    registerWidget(registered({ id: "dup/one" }));
    const merged = canonicalWidgets([
      { id: "dup/one", requiredPermission: "read-forms" },
    ]);
    expect(merged[0]).not.toHaveProperty("requiredPermission");
  });

  it("takes a registration only as the admin may RECEIVE it", () => {
    // 🔴 A registration JSON cannot carry never reaches the browser -- the
    // workspace payload skips it -- so it must not win a collision here
    // either. Taken from the raw registry, an ungated registration the admin
    // would never see merged over a gated contribution, the verdict became
    // the registration's, and the contribution's declaration shipped to every
    // reader under a clearance nothing the reader could see had granted.
    registerWidget(
      registered({
        id: "dup/one",
        archetype: "metric",
        component: undefined,
        query: {
          source: "collection:posts",
          op: "count",
          where: { views: { greater_than: 10n } },
        },
      } as Partial<WidgetDefinition>)
    );
    const merged = canonicalWidgets([
      { id: "dup/one", requiredPermission: "read-forms" },
    ]);
    expect(merged).toHaveLength(1);
    // The contribution stands alone, gated as it declared.
    expect(merged[0].requiredPermission).toBe("read-forms");
  });

  it("has no entry at all for a lone registration the admin cannot receive", () => {
    // The control for the collision above, and a property of its own: a
    // card the grid can never draw is not one the layout may place.
    registerWidget(
      registered({
        id: "core/heavy",
        archetype: "metric",
        component: undefined,
        query: {
          source: "collection:posts",
          op: "count",
          where: { views: { greater_than: 10n } },
        },
      } as Partial<WidgetDefinition>)
    );
    registerWidget(registered({ id: "core/light" }));
    expect(canonicalWidgets([]).map(widget => widget.id)).toEqual([
      "core/light",
    ]);
  });

  it("keeps the FIRST of two contributions sharing an id", () => {
    // 🔴 Widget ids are plugin-local, so two enabled plugins can ship the same
    // one. `resolveDashboardWidgets` walks declarations in order and keeps the
    // first renderable; this kept the LAST, so the layout endpoint placed one
    // plugin's widget while the grid drew the other's -- a card wearing another
    // plugin's geometry, or filtered away by a permission it never declared.
    const merged = canonicalWidgets([
      { id: "dup/two", defaultOrder: 1, requiredPermission: "read-a" },
      { id: "dup/two", defaultOrder: 99, requiredPermission: "read-b" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(1);
    expect(merged[0].requiredPermission).toBe("read-a");
  });

  it("carries the fields placement reads, from a registration", () => {
    registerWidget(
      registered({
        id: "core/team",
        requiredPermission: "read-users",
        size: { default: { w: 4, h: 4 }, max: { w: 6, h: 4 } },
        defaultOrder: 20,
      })
    );
    expect(canonicalWidgets([])[0]).toEqual({
      id: "core/team",
      requiredPermission: "read-users",
      size: { default: { w: 4, h: 4 }, max: { w: 6, h: 4 } },
      defaultOrder: 20,
      // As the registration states it: the add panel draws its sketch from it.
      archetype: "custom",
      // Always stated, as the empty list for a widget with no actions: the
      // reader gate flattens it, and an absent list would be a second way to
      // spell "no gates" beside the empty one.
      actionGates: [],
    });
  });

  it("carries the gate of every action, from both channels of a colliding id", () => {
    // 🔴 An `actions` widget's shortcuts each carry a gate of their own, and
    // the workspace payload withholds a shortcut on it before the declaration
    // ships. Both copies of a colliding id ship, so both copies' gates are
    // carried -- verbatim, including the absent ones, so the count matches
    // the actions.
    registerWidget(
      registered({
        id: "acme/links",
        archetype: "actions",
        component: undefined,
        actions: [
          { label: "Open", href: "/open" },
          { label: "Purge", href: "/purge", requiredPermission: "purge-notes" },
        ],
      })
    );
    const [widget] = canonicalWidgets([
      { id: "acme/links", actionGates: ["export-notes"] },
    ]);
    expect(widget.actionGates).toEqual([
      "export-notes",
      undefined,
      "purge-notes",
    ]);
  });

  it("omits what a declaration did not state", () => {
    registerWidget(registered({ id: "core/team" }));
    const [widget] = canonicalWidgets([]);
    expect(widget).not.toHaveProperty("requiredPermission");
    expect(widget).not.toHaveProperty("defaultOrder");
  });

  it("carries a contributed size as the contribution states it", () => {
    const size = { default: { w: 6, h: 3 } };
    expect(canonicalWidgets([{ id: "p/w", size }])[0]).toEqual({
      id: "p/w",
      size,
    });
  });

  it("drops a contribution with no usable id", () => {
    expect(canonicalWidgets([{ id: "" }])).toEqual([]);
  });

  it("is empty when neither channel has anything", () => {
    expect(canonicalWidgets([])).toEqual([]);
  });
});

describe("generated cards in the canonical set", () => {
  const generated = {
    id: "collection/posts-count",
    title: "posts",
    archetype: "metric",
    size: { default: { w: 3, h: 2 } },
    requiredPermission: "read-posts",
    query: { source: "collection:posts", op: "count" },
  } as unknown as Parameters<typeof setGeneratedWidgets>[0][number];

  afterEach(() => setGeneratedWidgets([]));

  it("places and offers a card nobody declared", () => {
    // 🔴 The whole point of generating them. Without this the layout endpoint
    // answers "unavailable widget" for every id the picker offers, so the card
    // is visible and unaddable -- which is the state a contributed widget was
    // in before `canonicalWidgets` learned about that channel.
    setGeneratedWidgets([generated]);
    expect(canonicalWidgets([]).map(w => w.id)).toEqual([
      "collection/posts-count",
    ]);
  });

  it("carries the permission that gates the collection", () => {
    setGeneratedWidgets([generated]);
    expect(canonicalWidgets([])[0].requiredPermission).toBe("read-posts");
  });

  it("LOSES the id to a contribution that already claimed it", () => {
    // A plugin that declared this widget meant it; core's derived guess must
    // not displace it. The reader sees the plugin's card, and the server places
    // the plugin's declaration -- one answer, not two.
    setGeneratedWidgets([generated]);
    const merged = canonicalWidgets([
      { id: "collection/posts-count", defaultOrder: 3 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(3);
  });

  it("is NOT part of the set a default arrangement is built from", () => {
    // 🔴 The whole "offered, never placed" claim rests on this. `defaultPlacements`
    // is materialized from `declaredWidgets`, so a generated card appearing there
    // would be auto-placed for every reader with no stored layout -- forty
    // collections opening onto eighty cards nobody chose, and past the cap a
    // dashboard they cannot add to. It still EXISTS, so it can be offered and a
    // write naming it is accepted.
    setGeneratedWidgets([generated]);
    expect(allWidgets().map(w => w.id)).toEqual(["collection/posts-count"]);
    expect(declaredWidgets()).toEqual([]);
  });

  it("IS placed once a declaration claims its id", () => {
    // The control, and the reason the flag describes the surviving declaration
    // rather than which ids core can generate: an author who declared this
    // widget gets it placed like any other.
    setGeneratedWidgets([generated]);
    registerWidget(registered({ id: "collection/posts-count" }));
    expect(declaredWidgets().map(w => w.id)).toEqual([
      "collection/posts-count",
    ]);
  });

  it("LOSES the id to an explicit registration too", () => {
    setGeneratedWidgets([generated]);
    registerWidget(
      registered({ id: "collection/posts-count", defaultOrder: 7 })
    );
    const merged = canonicalWidgets([]);
    expect(merged).toHaveLength(1);
    expect(merged[0].defaultOrder).toBe(7);
  });
});

describe("a widget's size", () => {
  it("is the declared size with every end filled in", () => {
    expect(
      sizeFacts({
        id: "w/a",
        size: {
          default: { w: 6, h: 4 },
          min: { w: 4, h: 3 },
          max: { w: 8, h: 6 },
        },
      })
    ).toEqual({
      size: {
        default: { w: 6, h: 4 },
        min: { w: 4, h: 3 },
        max: { w: 8, h: 6 },
      },
      allowsSeveral: false,
    });
  });

  it("fills an unstated minimum with the default and an unstated maximum with the full row at its height", () => {
    expect(
      sizeFacts({ id: "w/a", size: { default: { w: 4, h: 3 } } }).size
    ).toEqual({
      default: { w: 4, h: 3 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 3 },
    });
  });

  it("reads a widget that states no size as the unstated size, as the admin does", () => {
    // 🔴 One answer for a contribution with no size: the same constant the
    // admin reads through `nextly/config`, so the server's default placement
    // and the grid cannot start the card at two sizes.
    expect(sizeFacts({ id: "w/a" }).size).toEqual(
      sizeBounds(UNSTATED_WIDGET_SIZE)
    );
  });

  it("carries a registration's size into the canonical summary", () => {
    const size = { default: { w: 6, h: 4 }, min: { w: 4, h: 3 } };
    registerWidget(registered({ id: "core/a", size }));
    const [summary] = allWidgets();
    expect(summary?.size).toEqual(size);
    expect(sizeFacts(summary as CanonicalWidget).size.min).toEqual({
      w: 4,
      h: 3,
    });
  });

  it("takes a colliding id's size from the registration whole, never mixing in a contributed bound", () => {
    registerWidget(
      registered({ id: "dup/one", size: { default: { w: 6, h: 4 } } })
    );
    const [merged] = canonicalWidgets([
      {
        id: "dup/one",
        size: { default: { w: 3, h: 2 }, min: { w: 3, h: 2 } },
        allowsSeveral: true,
      },
    ]);
    expect(merged?.size).toEqual({ default: { w: 6, h: 4 } });
    // The contribution's `allowsSeveral` still stands where the registration
    // states none.
    expect(merged?.allowsSeveral).toBe(true);
  });
});

describe("a widget offered per collection", () => {
  const perCollection = {
    id: "core/count",
    offered: "per-collection" as const,
  };

  it("stays off the default dashboard, where every other widget is placed", () => {
    expect(placedByDefault(perCollection)).toBe(false);
    expect(placedByDefault({ id: "core/team" })).toBe(true);
  });

  it("allows several cards, one per collection, unless it says otherwise", () => {
    expect(sizeFacts(perCollection).allowsSeveral).toBe(true);
    expect(sizeFacts({ id: "core/team" }).allowsSeveral).toBe(false);
    expect(
      sizeFacts({ ...perCollection, allowsSeveral: false }).allowsSeveral
    ).toBe(false);
  });
});

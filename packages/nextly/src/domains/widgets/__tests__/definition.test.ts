import { describe, expect, it } from "vitest";

import {
  rangedLimitSettingProblem,
  validateWidgetDefinition,
  widgetValueProblem,
  MAX_TEXT_CONTENT,
} from "../definition";
import { applyWidgetSettings } from "../settings";

const valid = {
  id: "core/recent-entries",
  title: "Recently edited",
  archetype: "list" as const,
  defaultSize: "lg" as const,
  query: { source: "collection:posts", op: "list" as const, limit: 5 },
};

describe("validateWidgetDefinition", () => {
  it("accepts a well-formed definition", () => {
    expect(() => validateWidgetDefinition(valid)).not.toThrow();
  });

  it("refuses an id that is not namespace/name", () => {
    // Namespacing is what lets two plugins ship a widget with the same short
    // name, and what makes a collision message able to say who owns which.
    expect(() => validateWidgetDefinition({ ...valid, id: "recent" })).toThrow(
      /namespace\/name/
    );
  });

  it("refuses a size outside the enum", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultSize: "gigantic" })
    ).toThrow(/defaultSize/);
  });

  it("refuses a minSize larger than maxSize", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, minSize: "xl", maxSize: "sm" })
    ).toThrow(/minSize/);
  });

  it("refuses a defaultSize below minSize", () => {
    // The bounds are what a user may resize BETWEEN, and the default is what
    // they start at. A default under the floor means the widget renders at a
    // size no resize can return it to -- accepted at registration and
    // unreachable for the rest of its life.
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultSize: "sm", minSize: "lg" })
    ).toThrow(/defaultSize/);
  });

  it("refuses a defaultSize above maxSize", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultSize: "full", maxSize: "md" })
    ).toThrow(/defaultSize/);
  });

  it("accepts a defaultSize sitting on either bound", () => {
    // The bounds are INCLUSIVE: `minSize` is a size the user may resize to, so
    // a default equal to it is inside the range, not outside it.
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        defaultSize: "sm",
        minSize: "sm",
        maxSize: "lg",
      })
    ).not.toThrow();
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        defaultSize: "lg",
        minSize: "sm",
        maxSize: "lg",
      })
    ).not.toThrow();
  });

  it("requires a component for the custom archetype and forbids one otherwise", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, archetype: "custom" })
    ).toThrow(/component/);
    expect(() =>
      validateWidgetDefinition({ ...valid, component: "pkg#Widget" })
    ).toThrow(/component/);
  });

  it("requires a query for every archetype that reads data", () => {
    const { query: _omitted, ...noQuery } = valid;
    expect(() => validateWidgetDefinition(noQuery)).toThrow(/query/);
  });

  it("allows text and actions archetypes to carry no query", () => {
    expect(() =>
      validateWidgetDefinition({
        id: "core/notes",
        title: "Notes",
        archetype: "text",
        defaultSize: "md",
        content: "Some notes.",
      })
    ).not.toThrow();
  });

  it("requires a text widget to carry its prose, and bounds it", () => {
    // A `text` widget IS its prose, the way an `actions` widget is its
    // shortcuts: without content it describes an empty card. The bound is
    // REFUSED rather than cut -- the content rides in every layout response.
    const notes = {
      id: "core/notes",
      title: "Notes",
      archetype: "text" as const,
      defaultSize: "md" as const,
    };
    expect(() => validateWidgetDefinition(notes)).toThrow(
      /requires non-empty content/
    );
    expect(() =>
      validateWidgetDefinition({ ...notes, content: "   \n  " })
    ).toThrow(/requires non-empty content/);
    expect(() =>
      validateWidgetDefinition({
        ...notes,
        content: "x".repeat(MAX_TEXT_CONTENT + 1),
      })
    ).toThrow(/the most a text widget may carry/);
    expect(() =>
      validateWidgetDefinition({
        ...notes,
        content: "x".repeat(MAX_TEXT_CONTENT),
      })
    ).not.toThrow();
  });

  it("refuses content on any other archetype, the way actions is refused", () => {
    // Both directions, like every field an archetype owns: prose on a metric
    // is a field nothing will draw, accepted at every layer and reporting
    // nothing.
    expect(() =>
      validateWidgetDefinition({
        id: "core/n",
        title: "N",
        archetype: "metric",
        defaultSize: "sm",
        query: { source: "collection:posts", op: "count" },
        content: "Prose nobody draws.",
      })
    ).toThrow(/content is only valid for archetype "text"/);
  });

  it("FORBIDS a query on text and actions, both directions like component", () => {
    // The interface says "Required for every data archetype; forbidden for
    // `text` and `actions`", and only the first half was enforced. A `text`
    // widget carrying a query is a declaration whose author expected data and
    // whose renderer will never ask for any -- accepted at registration,
    // silently inert afterwards. `validateComponent` beside it already checks
    // both directions; this now matches.
    expect(() =>
      validateWidgetDefinition({
        id: "core/notes",
        title: "Notes",
        archetype: "text",
        defaultSize: "md",
        // Carries its prose, so it reaches the QUERY rule rather than being
        // refused earlier for describing an empty card.
        content: "Some notes.",
        query: { source: "collection:posts", op: "list", limit: 5 },
      })
    ).toThrow(/query is only valid for/);

    // Carries its shortcuts, so it reaches the QUERY rule rather than being
    // refused earlier for describing an empty card. Isolating the rule under
    // test is the point: without them this asserts the actions rule instead and
    // the query rule goes unexercised.
    expect(() =>
      validateWidgetDefinition({
        id: "core/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        defaultSize: "md",
        actions: [{ label: "New post", href: "/admin/posts/new" }],
        query: { source: "collection:posts", op: "count", limit: 5 },
      })
    ).toThrow(/query is only valid for/);
  });

  it("requires an actions widget to carry its shortcuts", () => {
    // An `actions` widget IS its list, so an empty one describes an empty card.
    expect(() =>
      validateWidgetDefinition({
        id: "core/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        defaultSize: "md",
      })
    ).toThrow(/requires a non-empty actions array/);
  });

  it("forbids actions on an archetype that cannot draw them", () => {
    // The other direction, the same reading `component` takes: shortcuts on a
    // metric describe something nothing will draw -- accepted at every layer,
    // rendering nothing, reporting nothing.
    expect(() =>
      validateWidgetDefinition({
        id: "core/posts",
        title: "Posts",
        archetype: "metric",
        defaultSize: "sm",
        query: { source: "collection:posts", op: "count" },
        actions: [{ label: "New post", href: "/admin/posts/new" }],
      })
    ).toThrow(/only valid for archetype "actions"/);
  });

  it("requires each shortcut to carry a label and an href", () => {
    // Neither has a sensible default, and a blank one is a shortcut that looks
    // broken rather than absent.
    expect(() =>
      validateWidgetDefinition({
        id: "core/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        defaultSize: "md",
        actions: [{ label: "   ", href: "/admin/posts/new" }],
      })
    ).toThrow(/requires a non-empty label/);

    expect(() =>
      validateWidgetDefinition({
        id: "core/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        defaultSize: "md",
        actions: [{ label: "New post", href: "" }],
      })
    ).toThrow(/requires a non-empty href/);
  });

  it("accepts a well-formed actions widget", () => {
    // The positive control. A validator that refused every actions widget would
    // satisfy all three assertions above.
    expect(() =>
      validateWidgetDefinition({
        id: "core/shortcuts",
        title: "Shortcuts",
        archetype: "actions",
        defaultSize: "md",
        actions: [
          { label: "New post", href: "/admin/posts/new" },
          {
            label: "Docs",
            href: "https://nextly.dev/docs",
            external: true,
            requiredPermission: "read-docs",
          },
        ],
      })
    ).not.toThrow();
  });

  it("still allows a query on the custom archetype", () => {
    // The negative control, and the reason the forbidden set is named rather
    // than inferred as "everything that is not a data archetype": `custom`
    // draws itself and may legitimately want core to run its query.
    expect(() =>
      validateWidgetDefinition({
        id: "core/chart",
        title: "Chart",
        archetype: "custom",
        defaultSize: "md",
        component: "pkg#Chart",
        query: { source: "collection:posts", op: "count", limit: 5 },
      })
    ).not.toThrow();
  });
});

describe("defaultHeight is checked against the height vocabulary", () => {
  // `WIDGET_HEIGHTS` has two values and nothing compared `defaultHeight`
  // against them, so the field was enforced by the TYPE alone -- which reaches
  // a TypeScript caller and nothing else. A plugin authored in JavaScript, or
  // one whose definition arrives as parsed JSON, registered `"medium"` at boot
  // and the grid resolved a height that does not exist.
  it("accepts each declared height", () => {
    for (const defaultHeight of ["short", "tall"]) {
      expect(() =>
        validateWidgetDefinition({ ...valid, defaultHeight })
      ).not.toThrow();
    }
  });

  it("accepts a definition that declares no height", () => {
    expect(() => validateWidgetDefinition(valid)).not.toThrow();
  });

  it("refuses a height outside the vocabulary", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultHeight: "medium" })
    ).toThrow(/defaultHeight must be one of short, tall/);
  });

  it("refuses a non-string height, on SHAPE rather than vocabulary", () => {
    // The shape rule is shared by both declaration channels — a height is a
    // string in every version — so it is checked before the closed vocabulary,
    // which is the registry's alone. The message says which of the two refused.
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultHeight: 2 })
    ).toThrow(/defaultHeight, when given, must be a string/);
  });

  it("refuses a BLANK height", () => {
    // Blank names no height in any version, so it is shape rather than
    // vocabulary — and it is refused rather than read as absent, because the
    // two channels disagreed about which it was.
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultHeight: "" })
    ).toThrow(/defaultHeight, when given, must not be empty/);
  });

  it("refuses a BLANK size for the same reason", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultSize: "" })
    ).toThrow(/defaultSize, when given, must not be empty/);
  });
});

describe("a custom widget's component must be able to resolve", () => {
  const custom = {
    id: "acme/chart",
    title: "Chart",
    archetype: "custom" as const,
    defaultSize: "lg" as const,
  };

  it("accepts a real component path", () => {
    expect(() =>
      validateWidgetDefinition({ ...custom, component: "pkg#Chart" })
    ).not.toThrow();
  });

  it("refuses an empty component", () => {
    // `typeof d.component !== "string"` passes for `""`, so the archetype that
    // REQUIRES a component registered without a usable one -- the same broken
    // card requiring the field exists to prevent, reached through the check
    // meant to prevent it.
    expect(() =>
      validateWidgetDefinition({ ...custom, component: "" })
    ).toThrow(/requires a component path/);
  });

  it("refuses a whitespace-only component", () => {
    expect(() =>
      validateWidgetDefinition({ ...custom, component: "   " })
    ).toThrow(/requires a component path/);
  });
});

describe("defaultOrder places a widget without depending on which channel it came through", () => {
  const base = {
    id: "core/notes",
    title: "Notes",
    archetype: "text" as const,
    defaultSize: "md" as const,
    content: "Some notes.",
  };

  it("accepts a definition that omits it", () => {
    // The control, and the compatibility bound: every widget that exists today
    // declares none, so an absent value must stay valid.
    expect(() => validateWidgetDefinition(base)).not.toThrow();
  });

  it("accepts any finite number, negative and fractional included", () => {
    // Not an index. A caller inserting between two neighbours should not have
    // to renumber them, which is the whole reason this is a number and not a
    // position.
    for (const defaultOrder of [0, 3, -1, 1.5]) {
      expect(() =>
        validateWidgetDefinition({ ...base, defaultOrder })
      ).not.toThrow();
    }
  });

  it("refuses a non-finite number", () => {
    // `1e400` is valid JSON and parses to Infinity, so this is reachable from a
    // decoded manifest rather than only from a test double. An Infinity sort
    // key is not a diagnosable position -- it silently pins the card to one end
    // and compares equal to every other Infinity.
    for (const defaultOrder of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        validateWidgetDefinition({ ...base, defaultOrder })
      ).toThrow();
    }
  });

  it("refuses a value that is not a number at all", () => {
    expect(() =>
      validateWidgetDefinition({ ...base, defaultOrder: "1" })
    ).toThrow();
  });
});

describe("every widget is framed", () => {
  const custom = {
    id: "core/team",
    title: "Team",
    archetype: "custom" as const,
    defaultSize: "lg" as const,
    component: "core#TeamSummary",
  };

  it("accepts a widget that says nothing about its frame", () => {
    expect(() => validateWidgetDefinition(custom)).not.toThrow();
  });

  it("refuses a widget that names chrome, whatever its value", () => {
    // The frame draws every card's header and every state, so no widget may
    // decline it; a plain-JavaScript declaration that still names the field
    // learns so at startup. Cast, because the field is no longer typed.
    for (const chrome of ["none", "card", 42]) {
      expect(() =>
        validateWidgetDefinition({ ...custom, chrome } as never)
      ).toThrow(/chrome is not a widget field/);
    }
  });
});

describe("hidesWhenEmpty", () => {
  const custom = {
    id: "core/team",
    title: "Team",
    archetype: "custom" as const,
    defaultSize: "lg" as const,
    component: "core#TeamSummary",
  };

  it("accepts true and false", () => {
    expect(() =>
      validateWidgetDefinition({ ...custom, hidesWhenEmpty: true })
    ).not.toThrow();
    expect(() =>
      validateWidgetDefinition({ ...custom, hidesWhenEmpty: false })
    ).not.toThrow();
  });

  it("refuses anything that is not a boolean", () => {
    // A truthy "false" would take a card off every reader's dashboard that
    // its author meant to keep.
    expect(() =>
      validateWidgetDefinition({ ...custom, hidesWhenEmpty: "false" } as never)
    ).toThrow(/hidesWhenEmpty, when given, must be a boolean/);
  });
});

describe("a declared permission", () => {
  it("is refused when it is not a slug or a list of them", () => {
    // The field was declared and never checked, and the gap failed OPEN: the
    // dashboard's server filter reads "not a string" as "no permission
    // declared", so a widget whose author wrote `requiredPermission: { read:
    // true }` was gated for nobody and returned to every authenticated caller.
    // Refusing the declaration is the only place the mistake is still visible
    // to the person who made it.
    expect(widgetValueProblem({ requiredPermission: { read: true } })).toMatch(
      /requiredPermission, when given, must be a permission slug/
    );
    expect(widgetValueProblem({ requiredPermission: 42 })).toMatch(
      /requiredPermission/
    );
  });

  it("accepts a slug this core has never minted", () => {
    // Shape, not vocabulary. A newer core may mint new slugs; it cannot make a
    // slug stop being a string, and refusing an unknown one here would abort a
    // whole plugin install over a permission this core has not learned yet.
    expect(
      widgetValueProblem({ requiredPermission: "invent-something" })
    ).toBeUndefined();
    expect(widgetValueProblem({})).toBeUndefined();
  });

  it("accepts an any-of list", () => {
    expect(
      widgetValueProblem({
        requiredPermission: [
          "read-content-releases",
          "create-content-releases",
        ],
      })
    ).toBeUndefined();
  });

  /*
   * 🔴 The forms the array introduced, each refused for the same reason the
   * object above is: they are PRESENT and unusable, and the gate reads an
   * unusable declaration as a refusal. Admitting them here while the gate
   * refuses them would hide a card with no error anywhere -- and admitting an
   * empty array is worse than that, because "any of nothing" is satisfied by
   * nobody, so `requiredPermission: []` would silently mean the opposite of
   * what its author plainly wrote.
   */
  it.each([
    ["an empty array", []],
    ["an array with an empty member", ["read-posts", ""]],
    ["an array with a non-slug member", ["read-posts", 7]],
    ["an empty string", ""],
  ])("refuses %s", (_label, requiredPermission) => {
    expect(widgetValueProblem({ requiredPermission })).toMatch(
      /requiredPermission/
    );
  });
});

describe("a stats widget draws from cells, not from one query", () => {
  const statsBase = {
    id: "core/content-health",
    title: "Content health",
    archetype: "stats" as const,
    defaultSize: "md" as const,
  };
  const cell = (key: string) => ({
    key,
    label: key,
    query: { source: "collection:posts", op: "count" as const },
  });

  it("accepts a well-formed stats widget", () => {
    expect(() =>
      validateWidgetDefinition({ ...statsBase, cells: [cell("a")] })
    ).not.toThrow();
  });

  it("refuses a stats widget with no cells", () => {
    // Every other archetype's "requires its body" rule, for the field that IS
    // this one's body: a stats card without cells is a title over blank space.
    expect(() => validateWidgetDefinition(statsBase)).toThrow(
      /requires a non-empty cells/
    );
    expect(() => validateWidgetDefinition({ ...statsBase, cells: [] })).toThrow(
      /requires a non-empty cells/
    );
  });

  it("refuses cells on any OTHER archetype", () => {
    // The direction that would otherwise pass silently: a `metric` carrying
    // cells is an author who meant `stats`, and nothing would draw them.
    expect(() =>
      validateWidgetDefinition({ ...valid, cells: [cell("a")] })
    ).toThrow(/only valid for archetype "stats"/);
  });

  it("refuses a top-level query on a stats widget, naming where it belongs", () => {
    // 🔴 Refused with its OWN reason rather than the queryless one. `stats` is
    // not queryless -- it takes MORE queries than any other archetype -- so a
    // message saying it takes no data would send the author to delete the very
    // thing the card is made of.
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [cell("a")],
        query: { source: "collection:posts", op: "count" as const },
      })
    ).toThrow(/draws from cells, so it takes no top-level query/);
  });

  it("refuses a cell whose query is not a count", () => {
    // 🔴 The card draws ONE number per cell and refuses any other result shape.
    // A `list` here passes the container check, reaches a source that supports
    // it, succeeds, and then renders a muted dash forever -- a declaration
    // mistake wearing the appearance of unavailable data, which is the one
    // reading nobody investigates.
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [
          {
            key: "a",
            label: "A",
            query: { source: "collection:posts", op: "list" },
          },
        ],
      })
    ).toThrow(/must be a "count" query/);
  });

  it("refuses two cells sharing a key", () => {
    // 🔴 The card keys each answer back by `key`, so a duplicate collapses two
    // cells into one answer: the same number drawn twice under two different
    // labels, which no reader can detect.
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [cell("a"), cell("a")],
      })
    ).toThrow(/declare the key "a" more than once/);
  });

  it("refuses a cell link that cannot be followed", () => {
    // 🔴 The admin hands `href` to `Link`, whose external-destination check
    // calls `href.startsWith` -- so a blank or non-string href makes activating
    // the number throw instead of navigating, in the one card whose whole point
    // is navigating.
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [{ ...cell("a"), link: { label: "Go", href: "" } }],
      })
    ).toThrow(/link requires a non-empty href/);
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [{ ...cell("a"), link: { label: "  ", href: "/admin" } }],
      })
    ).toThrow(/link requires a non-empty label/);
  });

  it("accepts a cell with a usable link", () => {
    // The control: a check that refused every link would satisfy both cases.
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [{ ...cell("a"), link: { label: "Go", href: "/admin" } }],
      })
    ).not.toThrow();
  });

  it("refuses more cells than one batch can afford", () => {
    // Each cell is its own query, so an unbounded card would consume the whole
    // request budget and darken every other widget on the dashboard.
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: Array.from({ length: 9 }, (_, i) => cell(`c${i}`)),
      })
    ).toThrow(/at most 8 cells/);
  });

  it("refuses a cell missing its label or its query", () => {
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [{ key: "a", label: "  ", query: { source: "x", op: "count" } }],
      })
    ).toThrow(/requires a non-empty label/);
    expect(() =>
      validateWidgetDefinition({
        ...statsBase,
        cells: [{ key: "a", label: "A" }],
      })
    ).toThrow(/requires a query object/);
  });
});

describe("an archetype draws one kind of result", () => {
  it("refuses a metric declared with a grouped query", () => {
    // Registration is the last point an author can be told. Accepted, the card
    // executes successfully and the admin's metric body replaces it with an
    // "expected a count" error on every load -- a declaration mistake wearing
    // the appearance of a broken server.
    expect(() =>
      validateWidgetDefinition({
        id: "core/x",
        title: "X",
        defaultSize: "lg",
        archetype: "metric",
        query: { source: "collection:posts", op: "groupBy", groupBy: "status" },
      })
    ).toThrow(/cannot use op "groupBy"/);
  });

  it("refuses a list declared with a count", () => {
    // The mirror, so the rule is not satisfied by refusing one op everywhere.
    expect(() =>
      validateWidgetDefinition({
        id: "core/x",
        title: "X",
        defaultSize: "lg",
        archetype: "list",
        query: { source: "collection:posts", op: "count" },
      })
    ).toThrow(/cannot use op "count"/);
  });

  it("leaves a custom widget free to draw whatever its component draws", () => {
    // The flexibility that archetype exists for: its component receives the
    // result whole, so constraining the op here would be this file guessing at
    // a plugin's intent.
    expect(() =>
      validateWidgetDefinition({
        id: "plugin/x",
        title: "X",
        defaultSize: "lg",
        archetype: "custom",
        component: "plugin/x/Body",
        query: { source: "collection:posts", op: "groupBy", groupBy: "status" },
      })
    ).not.toThrow();
  });
});

describe("a widget whose data core builds on the server", () => {
  const { query: _query, ...noQuery } = valid;
  const built = { ...noQuery, serverData: true as const };

  it("carries no query, which its data archetype would otherwise require", () => {
    expect(() => validateWidgetDefinition(built)).not.toThrow();
    // The control: the same definition without the mark still needs its query.
    expect(() => validateWidgetDefinition(noQuery)).toThrow(/requires a query/);
  });

  it("is refused beside a query, which would be a second answer to what the card shows", () => {
    expect(() =>
      validateWidgetDefinition({ ...built, query: valid.query })
    ).toThrow(/built on the server takes no query/);
  });

  it("is a mark, and only true marks it", () => {
    for (const value of [false, "yes", 1]) {
      expect(() =>
        validateWidgetDefinition({ ...built, serverData: value })
      ).toThrow(/serverData may only be true/);
    }
  });

  it("alone may carry an empty state's words and action, which core publishes from its declaration", () => {
    const empty = {
      message: "No orders yet",
      action: { label: "Add", link: "collections/orders" },
    };
    expect(() => validateWidgetDefinition({ ...built, empty })).not.toThrow();
    expect(() => validateWidgetDefinition({ ...valid, empty })).toThrow(
      /empty is published by core for a declared widget only/
    );
    expect(() =>
      validateWidgetDefinition({ ...built, empty: { message: "  " } })
    ).toThrow(/not text/);
  });

  it("may hold a content setting, which a widget with its own query may not", () => {
    const collection = {
      name: "collection",
      label: "Collection",
      type: "collection",
    };
    const filter = {
      name: "filter",
      label: "Filter",
      type: "filter",
      of: "collection",
    };
    // The widget whose data core builds holds them. One with its own query
    // over a source no content knob drives, a system source, may not: there
    // they would change nothing its card asks.
    expect(() =>
      validateWidgetDefinition({ ...built, settings: [collection, filter] })
    ).not.toThrow();
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        query: { ...valid.query, source: "system:releases" },
        settings: [collection, filter],
      })
    ).toThrow(/WIDGET_CONTENT_SETTING_NOT_DRAWN/);
  });
});

describe("a widget's width terms", () => {
  it("states its widths in the arrangement's words, gaps allowed", () => {
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        allowedWidths: ["quarter", "full"],
        defaultWidth: "full",
        allowsSeveral: true,
      })
    ).not.toThrow();
  });

  it("refuses a width the arrangement does not have, an empty list and a repeated width", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, allowedWidths: ["1/4"] })
    ).toThrow(/allowedWidths must hold only/);
    expect(() =>
      validateWidgetDefinition({ ...valid, allowedWidths: [] })
    ).toThrow(/at least one width/);
    expect(() =>
      validateWidgetDefinition({ ...valid, allowedWidths: ["full", "full"] })
    ).toThrow(/names a width twice/);
  });

  it("starts a card at one of its widths, never outside them", () => {
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        allowedWidths: ["quarter", "half"],
        defaultWidth: "full",
      })
    ).toThrow(/is not one of its allowedWidths/);
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultWidth: "wide" })
    ).toThrow(/defaultWidth must be one of/);
  });

  it("sketches its row with one of core's displays, or not at all", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, sketch: "bars" })
    ).not.toThrow();
    expect(() => validateWidgetDefinition({ ...valid, sketch: "pie" })).toThrow(
      /sketch must be one of/
    );
  });

  it("says whether a dashboard may hold several only as true or false", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, allowsSeveral: "yes" })
    ).toThrow(/allowsSeveral must be true or false/);
  });
});

describe("a query whose source a Collection setting supplies", () => {
  const { source: _declared, ...sourceless } = valid.query;
  const collection = { name: "collection", type: "collection" as const };

  it("registers with no source of its own beside a Collection setting", () => {
    expect(() =>
      validateWidgetDefinition({
        ...valid,
        offered: "per-collection",
        settings: [collection],
        query: sourceless,
      })
    ).not.toThrow();
  });

  it("is refused with no source and nothing to supply one", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, query: sourceless })
    ).toThrow(/names no source, and no Collection setting supplies one/);
  });

  it("reads its declared source until the Collection setting is set", () => {
    // The declared source is the card's collection until its reader picks one,
    // so a definition may state both.
    expect(() =>
      validateWidgetDefinition({ ...valid, settings: [collection] })
    ).not.toThrow();
  });
});

describe("a custom card's cells", () => {
  const collection = { name: "collection", type: "collection" as const };
  const card = {
    id: "core/count",
    title: "Count",
    archetype: "custom" as const,
    component: "core#Count",
    defaultSize: "sm" as const,
  };
  const split = {
    key: "split",
    query: {
      op: "groupBy" as const,
      groupBy: "status",
      status: "all" as const,
    },
  };
  const trend = {
    key: "trend",
    query: {
      op: "timeseries" as const,
      dateField: "createdAt",
      interval: "day" as const,
    },
  };

  it("registers keyed reads whose source the Collection setting supplies", () => {
    expect(() =>
      validateWidgetDefinition({
        ...card,
        offered: "per-collection",
        settings: [collection],
        cells: [split, trend],
      })
    ).not.toThrow();
  });

  it("refuses two cells under one key", () => {
    expect(() =>
      validateWidgetDefinition({
        ...card,
        settings: [collection],
        cells: [split, { ...trend, key: "split" }],
      })
    ).toThrow(/declare the key "split" more than once/);
  });

  it("refuses a custom card asking through both a query and cells", () => {
    expect(() =>
      validateWidgetDefinition({
        ...card,
        settings: [collection],
        query: { op: "count" as const },
        cells: [split],
      })
    ).toThrow(/asks through its query or its cells, not both/);
  });

  it("refuses a widget offered per collection that declares no Collection setting", () => {
    // Its add-panel rows each start a card set to a collection; with no such
    // setting it could be added nowhere.
    expect(() =>
      validateWidgetDefinition({
        ...card,
        offered: "per-collection",
        cells: [
          { ...split, query: { ...split.query, source: "collection:posts" } },
        ],
      })
    ).toThrow(/offered per collection needs a Collection setting/);
  });

  it("refuses a content setting no cell's source lets a knob drive", () => {
    // 🔴 Judged as a query a Collection setting supplies, these would be drawn
    // and saved while every cell reads releases, which no content knob drives.
    const filter = {
      name: "filter",
      type: "filter" as const,
      of: "collection",
    };
    const releases = {
      key: "releases",
      query: { source: "system:releases", op: "count" as const },
    };
    expect(() =>
      validateWidgetDefinition({
        ...card,
        settings: [collection, filter],
        cells: [releases, { ...releases, key: "more" }],
      })
    ).toThrow(/WIDGET_CONTENT_SETTING_NOT_DRAWN/);
  });

  it("admits a content setting one cell's source lets a knob drive", () => {
    const filter = {
      name: "filter",
      type: "filter" as const,
      of: "collection",
    };
    expect(() =>
      validateWidgetDefinition({
        ...card,
        settings: [collection, filter],
        cells: [
          split,
          {
            key: "releases",
            query: { source: "system:releases", op: "count" as const },
          },
        ],
      })
    ).not.toThrow();
  });

  it("refuses an offered mode it does not know", () => {
    // 🔴 Read as an ordinary widget, a misspelt mode is placed by default with
    // no collection to read.
    expect(() =>
      validateWidgetDefinition({
        ...card,
        offered: "per-colletion" as "per-collection",
        cells: [
          { ...split, query: { ...split.query, source: "collection:posts" } },
        ],
      })
    ).toThrow(
      /has offered "per-colletion", which is not one of per-collection, on-request/
    );
  });

  it("refuses a cell with no source and nothing to supply one", () => {
    expect(() => validateWidgetDefinition({ ...card, cells: [split] })).toThrow(
      /its cell "split" names no source, and no Collection setting supplies one/
    );
  });
});

describe("a limit setting beside a ranged query", () => {
  // The rule refuses exactly the setting the limit knob would apply: one test
  // of what a limit setting is, read by both, so the two cannot part.
  it.each([
    [{ name: "limit", type: "number" as const, label: "Limit" }, 3],
    [{ name: "limit", type: "text" as const, label: "Limit" }, "3"],
    [{ name: "items", type: "number" as const, label: "Items" }, 3],
  ])("refuses %o exactly when the limit knob applies it", (setting, value) => {
    const applied = applyWidgetSettings(
      { source: "collection:posts", op: "list" as const },
      [setting],
      { [setting.name]: value }
    );
    const refused = rangedLimitSettingProblem({
      query: {
        source: "collection:posts",
        op: "timeseries",
        dateField: "createdAt",
        range: "30d",
      },
      settings: [setting],
    });
    expect(refused !== undefined).toBe("limit" in applied);
  });

  it("is refused at registration, naming the widget", () => {
    expect(() =>
      validateWidgetDefinition({
        id: "acme/over-time",
        title: "Over time",
        archetype: "timeseries",
        defaultSize: "md",
        query: {
          source: "collection:posts",
          op: "timeseries",
          dateField: "createdAt",
          range: "30d",
        },
        settings: [{ name: "limit", type: "number", label: "Limit" }],
      })
    ).toThrow(/acme\/over-time: declares a "limit" setting/);
  });
});

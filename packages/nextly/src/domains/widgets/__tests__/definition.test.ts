import { describe, expect, it } from "vitest";

import { validateWidgetDefinition, widgetValueProblem } from "../definition";

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
      })
    ).not.toThrow();
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

  it("refuses a non-string height", () => {
    expect(() =>
      validateWidgetDefinition({ ...valid, defaultHeight: 2 })
    ).toThrow(/defaultHeight must be one of/);
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

describe("chrome decides whether the HOST frames the widget", () => {
  const custom = {
    id: "core/team",
    title: "Team",
    archetype: "custom" as const,
    defaultSize: "lg" as const,
    component: "core#TeamSummary",
  };

  it("defaults to being framed by leaving it unstated", () => {
    // The compatibility bound: every widget shipping today states nothing and
    // must keep the card it has.
    expect(() => validateWidgetDefinition(custom)).not.toThrow();
  });

  it("lets a CUSTOM widget decline the frame", () => {
    // A `custom` widget supplies its own component, so it can already be a
    // designed surface -- a section with its own heading and rules. Framing one
    // draws a second heading around the first.
    expect(() =>
      validateWidgetDefinition({ ...custom, chrome: "none" })
    ).not.toThrow();
  });

  it("refuses to unframe an archetype CORE draws", () => {
    // Core fills a metric/list/table/actions/text body and the card IS that
    // body's surface -- its title, its footer, its busy state. Unframed, the
    // content has no heading and nothing owning its states.
    //
    // The fixture deliberately omits `component`: spreading the custom one in
    // made every case throw on `component is only valid for archetype "custom"`
    // instead, so the assertion passed with no chrome rule present at all. The
    // MESSAGE is asserted for the same reason -- `toThrow()` alone cannot tell
    // which rule refused.
    for (const [archetype, extra] of [
      ["metric", { query: { source: "collection:posts", op: "count" } }],
      ["list", { query: { source: "collection:posts", op: "find" } }],
      ["table", { query: { source: "collection:posts", op: "find" } }],
      ["actions", { actions: [{ label: "New", href: "/admin/users/create" }] }],
      ["text", {}],
    ] as const) {
      expect(() =>
        validateWidgetDefinition({
          id: "core/x",
          title: "X",
          defaultSize: "lg",
          archetype,
          chrome: "none",
          ...extra,
        })
      ).toThrow(/chrome/i);
    }
  });

  it("refuses a chrome value outside the vocabulary", () => {
    expect(() =>
      validateWidgetDefinition({ ...custom, chrome: "borderless" })
    ).toThrow();
  });
});

describe("a declared permission", () => {
  it("is refused when it is not a string", () => {
    // The field was declared and never checked, and the gap failed OPEN: the
    // dashboard's server filter reads "not a string" as "no permission
    // declared", so a widget whose author wrote `requiredPermission: { read:
    // true }` was gated for nobody and returned to every authenticated caller.
    // Refusing the declaration is the only place the mistake is still visible
    // to the person who made it.
    expect(widgetValueProblem({ requiredPermission: { read: true } })).toMatch(
      /requiredPermission, when given, must be a string/
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
});

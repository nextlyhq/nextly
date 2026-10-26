/**
 * The two channels into the widget registry must differ only where we SAY they
 * differ.
 *
 * `validateWidgetDefinition` guards `registerWidget`; `assertAdminWidgets`
 * guards `contributes.admin.widgets`. They validate related but distinct
 * shapes -- a contribution is a DECLARATION that resolution fills in, while a
 * definition is the resolved widget -- so a handful of differences are correct
 * and are listed below by name.
 *
 * Everything else must agree. The two rule sets are written separately, so a
 * rule added to one and not the other is invisible at the point it is written:
 * both validators still look correct, and the contributed side is the more
 * permissive, which is the direction that reaches a running dashboard.
 *
 * This is the control that makes the next one fail here instead. Adding a rule
 * to one validator and not the other turns a row red with the case that
 * diverged named in the message.
 *
 * @module plugins/__tests__/channel-divergence
 */
import { describe, expect, it } from "vitest";

import { validateWidgetDefinition } from "../../domains/widgets/definition";
import type { PluginDefinition } from "../plugin-context";
import { assertAdminWidgets } from "../validate-admin-widgets";

const asPlugin = (widget: unknown): PluginDefinition =>
  ({
    name: "@acme/p",
    version: "1.0.0",
    nextly: "*",
    contributes: { admin: { widgets: [widget] } },
  }) as unknown as PluginDefinition;

/** The refusal's message, for asserting WHICH rule refused. */
function reasonFrom(run: () => void): string {
  try {
    run();
    return "";
  } catch (error) {
    return (error as Error).message;
  }
}

function refuses(run: () => void): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

/**
 * Where the channels differ ON PURPOSE, each with the reason it is not drift.
 *
 * A contribution arrives from a plugin that may have been built against a
 * different core, and is REDUCED into a definition rather than being one.
 */
const DECLARED_DIFFERENCES: Array<{
  case: string;
  why: string;
  widget: Record<string, unknown>;
}> = [
  {
    case: "an archetype this core does not know",
    why: "refusing aborts the whole plugin install over one card; the grid reports it per-card instead",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "bogus",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "a component beside a non-custom archetype",
    why: "that is the FALLBACK body for an archetype an older admin cannot draw",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "text",
      size: { default: { w: 3, h: 2 } },
      content: "Prose.",
      component: "p#X",
    },
  },
  {
    case: "no title",
    why: "`PluginAdminWidgetBase` types it optional; resolution falls back to the id",
    widget: {
      id: "acme/thing",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "no size",
    why: "typed optional on a contribution; resolution supplies one",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      component: "p#X",
    },
  },
  {
    case: "a blank title",
    why: "`resolveTitle` trims it and falls back to the id, so the card renders correctly named; refusing turns a working card into a failed install",
    widget: {
      id: "acme/thing",
      title: "   ",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "an id that is not namespace/name",
    why: "widget ids are plugin-local and a contribution names its own; the registry is installation-wide and needs the namespace to keep two plugins apart",
    widget: {
      id: "stats",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "a component with no archetype at all",
    why: "a contribution shipping a component IS its body; the archetype is what the registry uses to decide who draws it",
    widget: { id: "acme/thing", title: "T", component: "p#X" },
  },
  {
    case: "actions on an archetype this core does not know",
    why: "the placement rule states THIS core's vocabulary, so applying it to a newer core's archetype would abort the install over a shape we cannot judge",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "timeline",
      size: { default: { w: 3, h: 2 } },
      actions: [{ label: "L", href: "/admin/users/create" }],
    },
  },
];

/**
 * Rules that must hold identically on both sides.
 *
 * `expect` names the diagnostic the row exists for. Without it a fixture can be
 * refused by a DIFFERENT rule and the row stays green when its own is deleted:
 * a size with a minimum above its default and a default above its maximum
 * breaks both orderings, so removing either would leave the pair assertion
 * satisfied by the other.
 */
const MUST_AGREE: Array<{
  case: string;
  widget: Record<string, unknown>;
  expect?: RegExp;
}> = [
  {
    // 🔴 Accepted as a contribution, the admin takes the cells and ignores the
    // query, while the identical registered definition is refused.
    case: "a custom card asking through both a query and cells",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      query: { source: "collection:posts", op: "count" },
      cells: [
        { key: "total", query: { source: "collection:posts", op: "count" } },
      ],
    },
    expect: /asks through its query or its cells, not both/,
  },
  {
    // 🔴 Accepted, the setting would add a limit the ranged query refuses, and
    // every request it changed would fail.
    case: "a limit setting beside a ranged query",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      query: {
        source: "collection:posts",
        op: "timeseries",
        dateField: "createdAt",
        range: "30d",
      },
      settings: [{ name: "limit", type: "number", label: "Limit" }],
    },
    expect: /declares a "limit" setting, and a query with a range/,
  },
  {
    case: "a minimum above the default",
    expect: /size\.min must not be larger than size\.default/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 }, min: { w: 8, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "actions on an archetype that is not actions",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "text",
      size: { default: { w: 3, h: 2 } },
      content: "Prose.",
      actions: [{ label: "L", href: "/h" }],
    },
  },
  {
    // A text widget IS its prose, on both channels, through one rule.
    case: "a text widget with no content",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "text",
      size: { default: { w: 3, h: 2 } },
    },
  },
  {
    case: "content on an archetype that is not text",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "actions",
      size: { default: { w: 3, h: 2 } },
      actions: [{ label: "L", href: "/h" }],
      content: "Prose nobody draws.",
    },
  },
  {
    case: "a malformed shortcut",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "actions",
      size: { default: { w: 3, h: 2 } },
      actions: [{}],
    },
  },
  {
    case: "a data archetype with no query",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "metric",
      size: { default: { w: 3, h: 2 } },
    },
  },
  {
    case: "a query on a queryless archetype",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "text",
      size: { default: { w: 3, h: 2 } },
      content: "Prose.",
      query: { source: "collection:p", op: "count" },
    },
  },
  {
    case: "a non-finite defaultOrder",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      defaultOrder: Number.NaN,
    },
  },
  {
    case: "a chrome field, whatever its value: no widget declines the frame",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      chrome: "card",
    },
  },
  {
    case: "a query that is not an object",
    expect: /query must be an object/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "metric",
      size: { default: { w: 3, h: 2 } },
      query: "bogus",
    },
  },
  {
    case: "a title that is not a string",
    expect: /title, when given, must be a string/,
    widget: {
      id: "acme/thing",
      title: 42,
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "a non-object query behind a component",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      query: "bogus",
    },
  },
  {
    // Taller than its maximum, wide enough: each direction is judged.
    case: "a default taller than the maximum",
    expect: /size\.default must not be larger than size\.max/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 4 }, max: { w: 12, h: 3 } },
      component: "p#X",
    },
  },
  {
    case: "a width outside the twelve columns",
    expect: /size\.default\.w must be a whole number from 1 to 12/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 0, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "a height that is not a whole number",
    expect: /size\.max\.h must be a whole number of 2 or more/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 }, max: { w: 6, h: 2.5 } },
      component: "p#X",
    },
  },
  {
    case: "a default wider than the maximum",
    expect: /size\.default must not be larger than size\.max/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 8, h: 2 }, max: { w: 6, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "an archetype that is not a string",
    expect: /archetype, when given, must be a string/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: 42,
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
    },
  },
  {
    case: "actions beside a component with no archetype at all",
    expect: /only valid for archetype "actions"/,
    widget: {
      id: "acme/thing",
      title: "T",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      actions: [{ label: "L", href: "/admin/users/create" }],
    },
  },
  {
    case: "a non-array actions on an archetype this core does not know",
    expect: /must be an array/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "timeline",
      size: { default: { w: 3, h: 2 } },
      actions: 42,
    },
  },
  {
    case: "a null action item on an archetype this core does not know",
    expect: /must be an object/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "timeline",
      size: { default: { w: 3, h: 2 } },
      actions: [null],
    },
  },
  {
    case: "a primitive action item on an archetype this core does not know",
    expect: /must be an object/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "timeline",
      size: { default: { w: 3, h: 2 } },
      actions: [42],
    },
  },
  /*
   * The settings rules. This channel had NO settings check at all, so
   * `settings: {}` passed the JSON gate, was published, and threw out of
   * `applyWidgetSettings` while the grid rendered -- the dashboard going down
   * rather than the one install that declared it. Both validators now read the
   * same `widgetSettingsProblem`, and these rows are what says so.
   */
  {
    case: "settings that are not an array",
    expect: /"settings" must be an array/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      settings: {},
    },
  },
  {
    case: "a setting default that is not a value of its type",
    expect: /defaults to/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      settings: [{ name: "limit", type: "number", defaultValue: "ten" }],
    },
  },
  {
    case: "a select setting that offers no options",
    expect: /needs a non-empty "options"/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      settings: [{ name: "mode", type: "select" }],
    },
  },
  {
    case: "two settings of one name",
    expect: /duplicate setting/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      settings: [
        { name: "limit", type: "number" },
        { name: "limit", type: "text" },
      ],
    },
  },
  {
    // It decides whether the admin draws a control that HIDES a card, and the
    // admin copies a registration's fields verbatim -- so a truthy non-boolean
    // such as "false" would draw the control on a card whose author declared
    // the opposite. There is no vocabulary a newer core could
    // extend here, so anything but a boolean is a mistake rather than skew.
    case: "a dismissible that is not a boolean",
    expect: /dismissible, when given, must be a boolean/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      dismissible: "false",
    },
  },
  {
    // It decides whether the batch asks a custom card one row more than it
    // draws, so a truthy non-boolean would send its component a row it then
    // draws as an ordinary one.
    case: "a sizedQuery that is not a boolean",
    expect: /sizedQuery, when given, must be a boolean/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      query: { source: "collection:posts", op: "list" },
      sizedQuery: "true",
    },
  },
  {
    // Core already sizes the lists it draws, so on any other archetype the
    // option would be validated and change nothing.
    case: "a sizedQuery on an archetype core draws",
    expect: /sizedQuery is only valid for archetype "custom"/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "list",
      size: { default: { w: 3, h: 2 } },
      query: { source: "collection:posts", op: "list" },
      sizedQuery: true,
    },
  },
  {
    case: "a sizedQuery on a query with no rows to size",
    expect: /sizedQuery needs a list query/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      query: { source: "collection:posts", op: "count" },
      sizedQuery: true,
    },
  },
  {
    case: "a hidesWhenEmpty that is not a boolean",
    expect: /hidesWhenEmpty, when given, must be a boolean/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: { w: 3, h: 2 } },
      component: "p#X",
      hidesWhenEmpty: "yes",
    },
  },
  {
    // 🔴 A named width is not a size on either channel: there is no newer
    // vocabulary for a contribution to be excused for.
    case: "a named width in place of a size",
    expect: /size must be \{ default: \{ w, h \}, min\?, max\? \}/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: "half",
      component: "p#X",
    },
  },
  {
    case: "a size whose default is a named width",
    expect: /size\.default must be \{ w, h \}/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      size: { default: "sm" },
      component: "p#X",
    },
  },
  {
    // 🔴 The registry refuses a non-count cell; the contributions channel
    // checked only that `cells` was a non-empty array, so this reached the
    // batch and rendered a permanent muted dash -- a declaration mistake
    // wearing the look of unavailable data.
    case: "a stats cell whose query is not a count",
    expect: /must be a "count" query/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "stats",
      size: { default: { w: 3, h: 2 } },
      cells: [
        {
          key: "a",
          label: "A",
          query: { source: "collection:posts", op: "list" },
        },
      ],
    },
  },
  {
    // Two cells under one key collapse into a single answer: the same number
    // drawn twice under two labels, which no reader can detect.
    case: "stats cells sharing a key",
    expect: /more than once/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "stats",
      size: { default: { w: 3, h: 2 } },
      cells: [
        {
          key: "a",
          label: "A",
          query: { source: "collection:posts", op: "count" },
        },
        {
          key: "a",
          label: "B",
          query: { source: "collection:posts", op: "count" },
        },
      ],
    },
  },
  {
    // Two bodies described at once. The batch prefers cells, so the top-level
    // query is never asked and nothing is ever filed under the widget's own id.
    case: "a stats widget carrying a top-level query",
    expect: /draws from cells, so it takes no top-level query/,
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "stats",
      size: { default: { w: 3, h: 2 } },
      query: { source: "collection:posts", op: "count" },
      cells: [
        {
          key: "a",
          label: "A",
          query: { source: "collection:posts", op: "count" },
        },
      ],
    },
  },
];

describe("the registry and contributions channels agree except where declared", () => {
  it.each(MUST_AGREE)("both refuse: $case", ({ widget, expect: expected }) => {
    const registry = refuses(() => validateWidgetDefinition(widget));
    const contributions = refuses(() => assertAdminWidgets([asPlugin(widget)]));

    // Asserted as a PAIR so the failure message shows which side let it through.
    expect({ registry, contributions }).toEqual({
      registry: true,
      contributions: true,
    });

    // And that the registry refused for the reason the row NAMES. Every fixture
    // once carried a bare id, which `validateId` refuses before any value rule
    // runs -- so the registry half was green for every row whatever the rule
    // under test did, and deleting a registry rule would not have moved it. A
    // pair of booleans cannot see that; only the message can.
    const reason = reasonFrom(() => validateWidgetDefinition(widget));
    expect(reason).not.toMatch(/id must be namespace/);

    // And, where the row names one, that the refusal is the rule the row is
    // FOR. A fixture can violate more than one rule, so without this a row
    // stays green when its own rule is deleted and another catches the input.
    if (expected) expect(reason).toMatch(expected);
  });

  it.each(DECLARED_DIFFERENCES)(
    "only the registry refuses: $case",
    ({ widget }) => {
      // These rows are the reason the suite cannot simply assert "identical".
      // Each is a difference with a stated reason; if one starts agreeing, the
      // exception has become dead and should be removed rather than kept.
      expect(refuses(() => validateWidgetDefinition(widget))).toBe(true);
      expect(refuses(() => assertAdminWidgets([asPlugin(widget)]))).toBe(false);
    }
  );

  it("accepts a well-formed widget through BOTH channels", () => {
    // The positive control. Two validators that refused everything would
    // satisfy every MUST_AGREE row above.
    const good = {
      id: "acme/revenue",
      title: "Revenue",
      archetype: "metric",
      size: { default: { w: 3, h: 2 } },
      query: { source: "collection:orders", op: "count" },
    };
    expect(refuses(() => validateWidgetDefinition(good))).toBe(false);
    expect(refuses(() => assertAdminWidgets([asPlugin(good)]))).toBe(false);
  });
});

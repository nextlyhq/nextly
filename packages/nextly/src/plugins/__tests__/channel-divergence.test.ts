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
 * Everything else must agree. Four fields have already drifted one at a time,
 * each added to one validator and missed by the other, and each found only when
 * a reviewer happened to look: the shortcut rule, the queryless no-query rule,
 * `defaultOrder` and `chrome`. Every one was the contributed side being the more
 * permissive, which is the direction that ships.
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
      defaultSize: "sm",
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
      defaultSize: "sm",
      component: "p#X",
    },
  },
  {
    case: "no title",
    why: "`PluginAdminWidgetBase` types it optional; resolution falls back to the id",
    widget: {
      id: "acme/thing",
      archetype: "custom",
      defaultSize: "sm",
      component: "p#X",
    },
  },
  {
    case: "no defaultSize",
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
      defaultSize: "sm",
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
      defaultSize: "sm",
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
      defaultSize: "sm",
      actions: [{ label: "L", href: "/admin/users/create" }],
    },
  },
];

/** Rules that must hold identically on both sides. */
const MUST_AGREE: Array<{ case: string; widget: Record<string, unknown> }> = [
  {
    case: "defaultSize outside the vocabulary",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      defaultSize: "enormous",
      component: "p#X",
    },
  },
  {
    case: "minSize above defaultSize",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      defaultSize: "sm",
      minSize: "xl",
      component: "p#X",
    },
  },
  {
    case: "defaultHeight outside the vocabulary",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      defaultSize: "sm",
      defaultHeight: "gigantic",
      component: "p#X",
    },
  },
  {
    case: "actions on an archetype that is not actions",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "text",
      defaultSize: "sm",
      actions: [{ label: "L", href: "/h" }],
    },
  },
  {
    case: "a malformed shortcut",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "actions",
      defaultSize: "sm",
      actions: [{}],
    },
  },
  {
    case: "a data archetype with no query",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "metric",
      defaultSize: "sm",
    },
  },
  {
    case: "a query on a queryless archetype",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "text",
      defaultSize: "sm",
      query: { source: "collection:p", op: "count" },
    },
  },
  {
    case: "a non-finite defaultOrder",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "custom",
      defaultSize: "sm",
      component: "p#X",
      defaultOrder: Number.NaN,
    },
  },
  {
    case: "chrome none on an archetype core draws",
    widget: {
      id: "acme/thing",
      title: "T",
      archetype: "metric",
      defaultSize: "sm",
      query: { source: "collection:p", op: "count" },
      chrome: "none",
    },
  },
];

describe("the registry and contributions channels agree except where declared", () => {
  it.each(MUST_AGREE)("both refuse: $case", ({ widget }) => {
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
    expect(reasonFrom(() => validateWidgetDefinition(widget))).not.toMatch(
      /id must be namespace/
    );
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
      defaultSize: "sm",
      query: { source: "collection:orders", op: "count" },
    };
    expect(refuses(() => validateWidgetDefinition(good))).toBe(false);
    expect(refuses(() => assertAdminWidgets([asPlugin(good)]))).toBe(false);
  });
});

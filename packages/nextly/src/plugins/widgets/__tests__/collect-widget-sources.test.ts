/**
 * The plugin widget-source seam.
 *
 * Every refusal here is a BOOT failure rather than a warning, and the reason is
 * the same one the jobs fold gives: which resolver owned an id would otherwise
 * be decided by plugin load order, and the loser would simply never answer with
 * nothing anywhere to say so. So the cases below assert that each refusal
 * happens AT THE FOLD, before anything reaches a store — the point at which an
 * operator can still be told which plugin to fix.
 */

import { describe, expect, it } from "vitest";

import type { WidgetResult } from "../../../domains/widgets/result";
import {
  collectWidgetSources,
  type PluginWidgetSource,
} from "../collect-widget-sources";

const answer = (): Promise<WidgetResult> =>
  Promise.resolve({ op: "count" as const, total: 0 });

function source(id: string): PluginWidgetSource {
  return {
    source: {
      id,
      label: "Revenue",
      kind: "plugin",
      supports: ["count"],
      fields: [{ name: "total", type: "number" }],
    },
    resolve: answer,
  };
}

const plugin = (
  name: string,
  widgetSources: PluginWidgetSource[],
  enabled?: boolean
) =>
  ({
    name,
    ...(enabled === undefined ? {} : { enabled }),
    contributes: { widgetSources },
  }) as never;

describe("collectWidgetSources", () => {
  it("collects a source a plugin contributes, with its owner", () => {
    // Provenance travels with it because a collision message is not actionable
    // without both names.
    const collected = collectWidgetSources([
      plugin("@acme/stripe", [source("plugin:stripe/revenue")]),
    ]);

    expect(collected.map(c => c.source.id)).toEqual(["plugin:stripe/revenue"]);
    expect(collected.map(c => c.owner)).toEqual(["@acme/stripe"]);
    expect(collected[0].resolve).toBe(answer);
  });

  it("takes nothing from a DISABLED plugin", () => {
    // `initializePlugins` skips a disabled plugin's init, services, hooks and
    // events, so admitting its resolver would publish a function closed over a
    // setup that deliberately never ran.
    const collected = collectWidgetSources([
      plugin("@acme/off", [source("plugin:off/one")], false),
      // The control: an enabled plugin in the same fold still contributes, so
      // this cannot pass by collecting nothing at all.
      plugin("@acme/on", [source("plugin:on/one")]),
    ]);

    expect(collected.map(c => c.source.id)).toEqual(["plugin:on/one"]);
  });

  it("collects from a plugin that does not mention `enabled`", () => {
    // Absent means enabled, so the check is for an explicit `false` rather than
    // for a truthy value -- which is the reading that would have dropped every
    // ordinary plugin.
    expect(
      collectWidgetSources([plugin("@acme/quiet", [source("plugin:quiet/a")])])
    ).toHaveLength(1);
  });

  it("refuses two plugins declaring one id, naming both", () => {
    expect(() =>
      collectWidgetSources([
        plugin("@acme/first", [source("plugin:shared/id")]),
        plugin("@acme/second", [source("plugin:shared/id")]),
      ])
    ).toThrow(/@acme\/first.*@acme\/second|@acme\/second.*@acme\/first/);
  });

  it.each(["collection:posts", "single:site-settings", "system:releases"])(
    "refuses the reserved id %s",
    id => {
      // 🔴 `collection:` and `single:` are the dangerous half. A resolver under
      // one of those answers a question the access-controlled Direct API is
      // supposed to answer, which diverts that entity's rows away from it --
      // and such a source is well-formed by every check downstream, since its
      // kind and namespace agree.
      expect(() =>
        collectWidgetSources([plugin("@acme/x", [source(id)])])
      ).toThrow(/reserved/);
    }
  );

  it("refuses an id in no namespace at all", () => {
    // Not covered by the reserved list: `revenue` starts with none of those
    // prefixes, and admitting it would publish a source whose id says nothing
    // about who owns it.
    expect(() =>
      collectWidgetSources([plugin("@acme/x", [source("revenue")])])
    ).toThrow(/must begin with "plugin:"/);
  });

  it("refuses a source declaring any kind but plugin", () => {
    // 🔴 The host must not CORRECT this. The boot used to spread
    // `{ ...source, kind: "plugin" }`, which erased a declared `"collection"`
    // before `registerSource` could run its kind/namespace agreement check --
    // so a malformed contribution booted successfully under semantics its
    // author never wrote.
    const wrongKind = {
      ...source("plugin:acme/a"),
      source: { ...source("plugin:acme/a").source, kind: "collection" },
    } as unknown as PluginWidgetSource;

    expect(() =>
      collectWidgetSources([plugin("@acme/x", [wrongKind])])
    ).toThrow(/must declare kind "plugin"/);
  });

  it("refuses a source with no resolver", () => {
    // The half that fails latest if it is not caught here: the source is
    // discoverable, passes query validation, and only a reader who places the
    // card finds that nothing answers it.
    const withoutResolver = {
      source: source("plugin:acme/a").source,
    } as unknown as PluginWidgetSource;

    expect(() =>
      collectWidgetSources([plugin("@acme/x", [withoutResolver])])
    ).toThrow(/without a resolver/);
  });

  it("refuses a source with no id, naming the plugin", () => {
    const withoutId = { resolve: answer } as unknown as PluginWidgetSource;

    expect(() =>
      collectWidgetSources([plugin("@acme/x", [withoutId])])
    ).toThrow(/"@acme\/x" contributes a widget source with no id/);
  });

  it("collects nothing when no plugin contributes any", () => {
    expect(collectWidgetSources([])).toEqual([]);
    expect(collectWidgetSources([{ name: "@acme/bare" } as never])).toEqual([]);
  });
});

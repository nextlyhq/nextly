/**
 * Folding every plugin's `contributes.widgetSources` into one list boot registers.
 *
 * ## Why this seam exists
 *
 * A source and the function that answers it are useless apart, and the failure
 * of registering one without the other is invisible until a reader puts the
 * card on their dashboard: the source is discoverable, it passes query
 * validation, and only execution finds that nothing answers it. So they travel
 * as one value from the plugin's declaration all the way to `registerResolvedSource`,
 * which writes both stores in one call.
 *
 * ## Why a fold rather than letting plugins register directly
 *
 * A plugin COULD call `registerResolvedSource` from its `init()`, and that is
 * precisely the arrangement this replaces. Registration order would then be
 * plugin load order, a duplicate id would be decided by whoever ran last with
 * nothing anywhere to say so, and a disabled plugin whose `init` is skipped
 * would contribute nothing while an enabled one that forgot to call it would
 * look identical. Declaring the sources in `contributes` makes the set readable
 * before anything executes, which is what lets the collisions below be boot
 * failures instead of silent losses.
 *
 * @module plugins/widgets/collect-widget-sources
 */

import type { SourceResolver } from "../../domains/widgets/resolved-sources";
import type { WidgetSource } from "../../domains/widgets/sources";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";

/**
 * One source a plugin contributes, and the function that answers it.
 *
 * The resolver is handed `(query, caller)` and nothing else. It reaches
 * whatever the plugin's own closure captured; there is no request, no headers
 * and no fetch-capable context — see `domains/widgets/resolved-sources` for why
 * that signature is a boundary rather than a convenience.
 */
export interface PluginWidgetSource {
  source: WidgetSource;
  resolve: SourceResolver;
}

/** A contributed source resolved to what boot needs, plus its provenance. */
export interface CollectedWidgetSource extends PluginWidgetSource {
  /** The declaring plugin's name, for logs and collisions. */
  owner: string;
}

/**
 * Namespaces a plugin may not publish into.
 *
 * `collection:` and `single:` belong to the Direct API, and a resolver under
 * one of those ids would answer a question the access-controlled read path is
 * supposed to answer — diverting that entity's rows away from it. `system:` is
 * core's own. Held as prefixes so a namespace core adds later is reserved
 * without anyone remembering to come back here; core's registrations bypass
 * this fold entirely, so nothing legitimate is refused.
 */
const RESERVED_SOURCE_PREFIXES = ["collection:", "single:", "system:"];

/** The namespace a plugin source must declare, matching its `kind`. */
const PLUGIN_PREFIX = "plugin:";

/**
 * Fold every enabled plugin's `contributes.widgetSources` into one list.
 *
 * Pure — no database access, no registry, no registration. The caller decides
 * when these reach the stores, which is what keeps built-in sources ahead of
 * them.
 *
 * A DISABLED plugin contributes nothing, for the reason the jobs fold gives:
 * `initializePlugins` skips a disabled plugin's init, services, hooks and
 * events, so admitting its resolver would publish a function whose setup
 * deliberately never ran, closed over whatever it expects to exist.
 *
 * Throws on a duplicate id and on an id outside the `plugin:` namespace. Both
 * are boot failures rather than warnings: which resolver won would otherwise
 * depend on plugin load order, and the loser would simply never answer with
 * nothing anywhere to say so.
 */
export function collectWidgetSources(
  plugins: readonly PluginDefinition[]
): CollectedWidgetSource[] {
  const seen = new Map<string, string>();
  const out: CollectedWidgetSource[] = [];

  for (const plugin of plugins) {
    // `enabled` is optional and absent means enabled, so this tests for an
    // explicit `false` rather than for a truthy value.
    if (plugin.enabled === false) continue;
    for (const contributed of plugin.contributes?.widgetSources ?? []) {
      consider(contributed, plugin.name, seen, out);
    }
  }

  return out;
}

/**
 * Admit one contributed source, or refuse it by name.
 *
 * Its own function rather than a closure in the loop: the checks below are the
 * substance of this module, and folding them into the iteration put every
 * refusal one indent deeper than the rule it enforces.
 */
function consider(
  contributed: PluginWidgetSource,
  owner: string,
  seen: Map<string, string>,
  out: CollectedWidgetSource[]
): void {
  const id = contributed?.source?.id;
  if (typeof id !== "string" || id === "") {
    throw NextlyError.invalidInput({
      message: `NEXTLY_WIDGET_SOURCE_INVALID: "${owner}" contributes a widget source with no id.`,
      logContext: { owner },
    });
  }

  // Checked here rather than left to `registerSource`'s own kind/namespace
  // agreement rule. That rule would refuse a `plugin:` id declaring kind
  // `"collection"`, but it has nothing to say about a `collection:` id
  // declaring kind `"collection"` — which is exactly what a plugin must not be
  // able to publish, and which is well-formed by every check downstream.
  const reserved = RESERVED_SOURCE_PREFIXES.find(prefix =>
    id.startsWith(prefix)
  );
  if (reserved !== undefined) {
    throw NextlyError.invalidInput({
      message: `NEXTLY_WIDGET_SOURCE_RESERVED: "${owner}" contributes widget source "${id}", but the "${reserved}" namespace is reserved.`,
      logContext: { id, owner, reserved },
    });
  }
  if (!id.startsWith(PLUGIN_PREFIX)) {
    throw NextlyError.invalidInput({
      message: `NEXTLY_WIDGET_SOURCE_NAMESPACE: "${owner}" contributes widget source "${id}", but a contributed source's id must begin with "${PLUGIN_PREFIX}".`,
      logContext: { id, owner },
    });
  }

  if (typeof contributed.resolve !== "function") {
    // The half that fails latest if it is not caught here: a source with no
    // resolver is discoverable and passes validation, and only a reader who
    // places the card finds out that nothing answers it.
    throw NextlyError.invalidInput({
      message: `NEXTLY_WIDGET_SOURCE_INVALID: "${owner}" contributes widget source "${id}" without a resolver function.`,
      logContext: { id, owner },
    });
  }

  const previous = seen.get(id);
  if (previous !== undefined) {
    throw NextlyError.invalidInput({
      message: `NEXTLY_WIDGET_SOURCE_COLLISION: widget source "${id}" is declared by both "${previous}" and "${owner}". Source ids must be unique.`,
      logContext: { id, owner, previous },
    });
  }

  seen.set(id, owner);
  out.push({ ...contributed, owner });
}

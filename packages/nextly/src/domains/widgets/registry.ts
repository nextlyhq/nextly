/**
 * The widget registry: the single place that knows which widgets exist in a
 * running app, and the gate every definition passes through.
 *
 * `globalThis`-pinned and cleared per boot (clear-and-rebuild), so a dev-server
 * hot reload re-registering the same widgets never collides with itself, while
 * a genuine duplicate id inside one boot still fails loudly.
 *
 * Core built-ins live in the SAME store as plugin contributions. Two stores
 * would mean two resolution paths, two sizing implementations and two ordering
 * rules -- and a user could not reorder a core widget alongside a plugin one,
 * which is the whole point of having a registry.
 *
 * @module domains/widgets/registry
 */

import { NextlyError } from "../../errors/nextly-error";

import { validateWidgetDefinition, type WidgetDefinition } from "./definition";
import { detachedSnapshot } from "./detached-snapshot";

/** The fields a plugin may patch on someone else's widget. */
export type WidgetPatch = Partial<
  Pick<
    WidgetDefinition,
    | "title"
    | "description"
    | "icon"
    | "category"
    | "defaultSize"
    | "minSize"
    | "maxSize"
    | "defaultHeight"
    | "requiredPermission"
    | "query"
    | "link"
  >
>;

interface RegistryEntry {
  definition: WidgetDefinition;
  source: string;
}

const globalForWidgets = globalThis as unknown as {
  __nextly_widgets?: Map<string, RegistryEntry>;
};

function store(): Map<string, RegistryEntry> {
  globalForWidgets.__nextly_widgets ??= new Map();
  return globalForWidgets.__nextly_widgets;
}

/**
 * The value the store actually holds: a detached, frozen copy.
 *
 * Keeping the caller's object by reference makes every gate in this module
 * optional. `validateWidgetDefinition` ran at registration and a plugin that
 * still holds the object can edit it afterwards; `extendWidget`'s patch
 * allowlist and the deliberate `overrideWidget` path are then both routes
 * nobody has to take. The archetype, the `component` path, or the `query` the
 * host is about to execute all change with nothing revalidating them.
 *
 * Shares `detachedSnapshot` with the SOURCE store rather than repeating its
 * clone-and-freeze: both stores answer the same question about the same kind of
 * value, and the reason each refuses is the only part that differs. That
 * refusal is wrapped here so it reads like every other one in this module
 * rather than as an unhandled `DOMException`.
 */
function snapshot(def: WidgetDefinition): WidgetDefinition {
  return detachedSnapshot(def, () => {
    throw NextlyError.invalidInput({
      message:
        `Widget "${def.id}" carries a value that cannot be stored. A widget ` +
        `definition is data: functions, symbols and class instances are not ` +
        `part of it.`,
    });
  });
}

/** Register a widget. Throws if the id is taken or the definition is malformed. */
export function registerWidget(
  def: WidgetDefinition,
  opts: { source?: string } = {}
): void {
  validateWidgetDefinition(def);
  const source = opts.source ?? "unknown";
  const existing = store().get(def.id);
  if (existing) {
    throw NextlyError.conflict({
      message:
        `Widget id "${def.id}" is already registered by "${existing.source}"; ` +
        `"${source}" cannot claim it. Use overrideWidget() to replace it deliberately.`,
    });
  }
  store().set(def.id, { definition: snapshot(def), source });
}

/**
 * Replace a registered widget wholesale.
 *
 * Separate from `registerWidget` so replacing someone else's widget is always
 * a deliberate act that reads as one at the call site.
 *
 * The replacement must AGREE with the key it is replacing. The store is keyed
 * by id and the definition carries its own, so a mismatch stores an object
 * under "core/a" that announces itself as "core/b": `getWidget("core/a")`
 * answers with the wrong identity, anything keying off `definition.id` -- a
 * picker, a saved layout, a diagnostic naming the offender -- disagrees with
 * the registry, and "core/b" is still free for a second widget to claim
 * alongside it. Refusing here keeps the key and the identity one fact.
 */
export function overrideWidget(
  id: string,
  def: WidgetDefinition,
  opts: { source?: string } = {}
): void {
  validateWidgetDefinition(def);
  if (def.id !== id) {
    throw NextlyError.invalidInput({
      message:
        `Cannot override widget "${id}" with a definition whose id is ` +
        `"${def.id}". The replacement must carry the id it replaces.`,
    });
  }
  if (!store().has(id)) {
    throw NextlyError.notFound({
      message: `Cannot override widget "${id}": it is not registered.`,
    });
  }
  store().set(id, {
    definition: snapshot(def),
    source: opts.source ?? "unknown",
  });
}

/**
 * Patch named fields of a registered widget.
 *
 * Deliberately a narrow patch rather than arbitrary mutation: it may retitle,
 * resize, re-permission or re-query a widget, but it cannot change the
 * archetype or inject behaviour. That keeps "customize a core widget"
 * expressible without making core widgets unversionable.
 *
 * Re-validates the MERGED result, not the patch alone: two individually valid
 * values -- a widget's existing `maxSize` and a patch's `minSize` -- can
 * compose into an invalid definition, and that is only visible after merging.
 */
export function extendWidget(
  id: string,
  patch: WidgetPatch,
  opts: { source?: string } = {}
): void {
  const existing = store().get(id);
  if (!existing) {
    throw NextlyError.notFound({
      message: `Cannot extend widget "${id}": it is not registered.`,
    });
  }
  const merged = { ...existing.definition, ...patch };
  validateWidgetDefinition(merged);
  store().set(id, {
    definition: snapshot(merged),
    source: opts.source ?? existing.source,
  });
}

/** Remove a widget. Returns whether anything was removed. */
export function deregisterWidget(id: string): boolean {
  return store().delete(id);
}

export function getWidget(id: string): WidgetDefinition | undefined {
  return store().get(id)?.definition;
}

/** Every registered widget, in registration order. */
export function listWidgets(): WidgetDefinition[] {
  return [...store().values()].map(entry => entry.definition);
}

/** Which source registered a widget, for diagnostics. */
export function widgetSource(id: string): string | undefined {
  return store().get(id)?.source;
}

/** Clear the store. Called at boot before re-registering. */
export function clearWidgets(): void {
  store().clear();
}

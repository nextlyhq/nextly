/**
 * The widget registry: the single place that knows which widgets exist in a
 * running app, each the data core published from a `defineWidget` declaration
 * (`toDefinition`), and the gate every one passes through.
 *
 * `globalThis`-pinned and cleared per boot (clear-and-rebuild), so a dev-server
 * hot reload re-registering the same widgets never collides with itself, while
 * a genuine duplicate id inside one boot still fails loudly.
 *
 * Core's own widgets live in the SAME store as a plugin's and the site's. Two stores
 * would mean two resolution paths, two sizing implementations and two ordering
 * rules -- and a user could not reorder a core widget alongside a plugin one,
 * which is the whole point of having a registry.
 *
 * @module domains/widgets/registry
 */

import { NextlyError } from "../../errors/nextly-error";

import { validateWidgetDefinition, type WidgetDefinition } from "./definition";
import { detachedSnapshot } from "./detached-snapshot";
import { retiredWidgetReplacement } from "./retired-widget-namespaces";

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
 * Keeping the caller's object by reference would make the validation optional:
 * `validateWidgetDefinition` ran at registration, and anything still holding
 * the object could edit its archetype or `component` path afterwards with
 * nothing revalidating them.
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

/**
 * Register a widget as core published it from its declaration, under its
 * owner. Throws if the id is taken or the definition is malformed.
 *
 * The one door into the registry: every widget is declared, and startup
 * publishes each declaration through it (`registerDashboardWidgets`), so
 * nothing else writes here but a test.
 */
export function registerWidget(
  def: WidgetDefinition,
  opts: { source?: string } = {}
): void {
  const source = opts.source ?? "unknown";
  validateWidgetDefinition(def);
  // 🔴 A retired namespace is refused here, where every registration passes,
  // so the registry and the layout doors give one answer: a card registered
  // there would be offered, then refused by every write and dropped by every
  // read. Thrown at startup, where an app registers, with what replaced it.
  const replacement = retiredWidgetReplacement(def.id);
  if (replacement !== undefined) {
    throw NextlyError.invalidInput({
      message: `Widget "${def.id}" cannot be registered: "${def.id}" ${replacement}`,
    });
  }
  const existing = store().get(def.id);
  if (existing) {
    throw NextlyError.conflict({
      message:
        `Widget id "${def.id}" is already registered by "${existing.source}"; ` +
        `"${source}" cannot claim it.`,
    });
  }
  store().set(def.id, { definition: snapshot(def), source });
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

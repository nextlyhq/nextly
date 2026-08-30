/**
 * What a widget may read FROM.
 *
 * A source is addressed by a stable string id -- `collection:posts`,
 * `system:users`, `plugin:stripe/revenue` -- and declares the fields and
 * operations it exposes. A widget query names a source id and declared field
 * names; it never names a table or a column, which is what keeps caller input
 * away from the compiler.
 *
 * @module domains/widgets/sources
 */

import { NextlyError } from "../../errors/nextly-error";

export type WidgetOp = "count" | "list" | "groupBy" | "timeseries";

export interface WidgetSourceField {
  name: string;
  type: "string" | "number" | "boolean" | "date";
}

export interface WidgetSource {
  /** e.g. "collection:posts", "system:users", "plugin:stripe/revenue". */
  id: string;
  label: string;
  kind: "collection" | "single" | "system" | "plugin";
  /** Gates who may SELECT this source when configuring a widget. */
  requiredPermission?: string;
  supports: readonly WidgetOp[];
  /** The only field names a query may reference. */
  fields: readonly WidgetSourceField[];
}

const globalForSources = globalThis as unknown as {
  __nextly_widget_sources?: Map<string, WidgetSource>;
};

function store(): Map<string, WidgetSource> {
  globalForSources.__nextly_widget_sources ??= new Map();
  return globalForSources.__nextly_widget_sources;
}

/** Register a source. Throws if the id is already taken. */
export function registerSource(source: WidgetSource): void {
  const existing = store().get(source.id);
  if (existing) {
    throw NextlyError.conflict({
      message: `Widget source "${source.id}" is already registered.`,
    });
  }
  store().set(source.id, source);
}

export function getSource(id: string): WidgetSource | undefined {
  return store().get(id);
}

export function listSources(): WidgetSource[] {
  return [...store().values()];
}

export function clearSources(): void {
  store().clear();
}

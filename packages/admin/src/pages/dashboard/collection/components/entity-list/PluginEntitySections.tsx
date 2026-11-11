"use client";

import { ChevronRight, Plug } from "lucide-react";
import { useId, useMemo, useState, type JSX } from "react";

import {
  DataTableView,
  type NextlyColumn,
  type RowAction,
} from "@admin/components/ui/table/data-table";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { pluginDisplayName } from "@admin/lib/plugins/plugin-display-name";
import type { PluginMetadata } from "@admin/types/branding";

import { matchesSearch } from "./entity-list-columns";
import {
  usePluginEntities,
  type OwnedListFetcher,
} from "./use-entity-lists-by-owner";

/** The kinds of entity a plugin's metadata lists, by its slug lists' names. */
export type PluginEntityKind = "collections" | "singles" | "fieldGroups";

/** One plugin's entries, under the name the admin calls that plugin. */
interface PluginGroup<Row> {
  key: string;
  name: string;
  rows: Row[];
}

/**
 * The plugins' entries grouped by the plugin that provides them, in the
 * order the plugins are installed. An entry the plugin metadata does not
 * place (metadata still loading, or a plugin it does not describe) is grouped
 * under "Plugins" rather than under a name nobody chose.
 */
function groupByPlugin<Row>(
  rows: readonly Row[],
  slugOf: (row: Row) => string,
  kind: PluginEntityKind,
  plugins: readonly PluginMetadata[]
): PluginGroup<Row>[] {
  const groups: PluginGroup<Row>[] = [];
  const placed = new Set<Row>();
  for (const plugin of plugins) {
    const slugs = new Set(plugin[kind] ?? []);
    const own = rows.filter(row => !placed.has(row) && slugs.has(slugOf(row)));
    if (own.length === 0) continue;
    own.forEach(row => placed.add(row));
    groups.push({
      key: plugin.name,
      name: pluginDisplayName(plugin),
      rows: own,
    });
  }
  const rest = rows.filter(row => !placed.has(row));
  if (rest.length > 0) {
    groups.push({ key: "", name: "Plugins", rows: rest });
  }
  return groups;
}

export interface PluginEntitySectionsProps<Row extends { label?: string }> {
  kind: PluginEntityKind;
  /** What one and several entries are called: "collection", "collections". */
  noun: { one: string; many: string };
  /** The entity's `lists()` key, so its list refreshes refresh these too. */
  listKey: readonly unknown[];
  /** The entity's list read, asked for the plugins' entries. */
  fetchPage: OwnedListFetcher<Row>;
  /** The list's search text: the sections show the entries it finds. */
  search: string;
  slugOf: (row: Row) => string;
  /** The section's columns, given the plugin's name for its source cell. */
  columnsFor: (pluginName: string) => NextlyColumn<Row>[];
  /** Each row's actions: never a delete, since a plugin's entries are its own. */
  rowActions: (row: Row) => RowAction<Row>[];
  onRowClick: (row: Row) => void;
}

/**
 * The plugins' collections, Singles or field groups, one section per plugin
 * under the site's own list. Folded by default and read-only: a section lists
 * a plugin's entries so a reader can find and open them, and offers nothing
 * that would change them — no selection, no delete.
 */
export function PluginEntitySections<Row extends { label?: string }>({
  kind,
  noun,
  listKey,
  fetchPage,
  search,
  slugOf,
  columnsFor,
  rowActions,
  onRowClick,
}: PluginEntitySectionsProps<Row>): JSX.Element | null {
  const plugins = useBranding().plugins;
  // Every plugin entry this reader may read, then the ones the search finds;
  // the list's source and schema filters narrow the site's own entries only.
  const { data: rows } = usePluginEntities(listKey, fetchPage);
  const groups = useMemo(
    () =>
      groupByPlugin(
        (rows ?? []).filter(row =>
          matchesSearch({ label: row.label, slug: slugOf(row) }, search)
        ),
        slugOf,
        kind,
        plugins ?? []
      ),
    [rows, search, slugOf, kind, plugins]
  );
  if (groups.length === 0) return null;
  return (
    <div className="mt-6 flex flex-col gap-3">
      {groups.map(group => (
        <PluginSection
          key={group.key}
          group={group}
          noun={noun}
          slugOf={slugOf}
          columnsFor={columnsFor}
          rowActions={rowActions}
          onRowClick={onRowClick}
        />
      ))}
    </div>
  );
}

function PluginSection<Row extends { label?: string }>({
  group,
  noun,
  slugOf,
  columnsFor,
  rowActions,
  onRowClick,
}: Pick<
  PluginEntitySectionsProps<Row>,
  "noun" | "slugOf" | "columnsFor" | "rowActions" | "onRowClick"
> & { group: PluginGroup<Row> }): JSX.Element {
  // Folded until asked for: the site's own entries are what the page is for.
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const columns = useMemo(
    () => columnsFor(group.name),
    [columnsFor, group.name]
  );
  const count = `${group.rows.length} ${group.rows.length === 1 ? noun.one : noun.many}`;
  return (
    <section
      aria-label={`${group.name} ${noun.many}`}
      className="rounded-md border border-border bg-card"
    >
      <h2 className="m-0 text-sm font-medium">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(value => !value)}
          className="flex min-h-11 w-full items-center gap-2 rounded-md px-4 py-2 text-left text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          <Plug
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <span>{group.name}</span>
          <span className="font-normal text-muted-foreground">{count}</span>
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            Provided by the plugin, read-only
          </span>
        </button>
      </h2>
      {open ? (
        <div id={panelId} className="border-t border-border">
          <DataTableView<Row>
            columns={columns}
            rows={[...group.rows]}
            getRowId={slugOf}
            onRowClick={onRowClick}
            primaryColumn="label"
            rowActions={rowActions}
            ariaLabel={`${group.name} ${noun.many}`}
            bordered={false}
          />
        </div>
      ) : null}
    </section>
  );
}

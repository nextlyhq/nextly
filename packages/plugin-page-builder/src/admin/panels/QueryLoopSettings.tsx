"use client";

/**
 * Dedicated Query Loop authoring panel (spec §5). Replaces the generic Content tab for
 * `core/query-loop`: a collection DROPDOWN discovered from the admin, a sort field + asc/desc,
 * a limit, a column count, and one basic equals-filter — all discovered from the collection's
 * schema so the author never types a slug or field name from memory. Writes to `node.props`.
 */
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { useEffect, useState } from "react";

import type { BlockNode } from "../../core/types";
import {
  getCollectionFields,
  listCollections,
  type CollectionField,
  type CollectionSummary,
} from "../api/collectionsApi";
import { buildSort, parseSort, type SortDir } from "../logic/queryLoop";
import { useEditor } from "../store/EditorProvider";

const NONE = "__none__";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function QueryLoopSettings({ node }: { node: BlockNode }) {
  const { dispatch } = useEditor();
  const props = node.props;
  const collection = str(props.collection);

  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [fields, setFields] = useState<CollectionField[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Record<string, unknown>) =>
    dispatch({ type: "UPDATE_PROPS", id: node.id, props: patch });

  useEffect(() => {
    let alive = true;
    listCollections()
      .then(c => alive && setCollections(c))
      .catch(e => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!collection) {
      setFields([]);
      return;
    }
    getCollectionFields(collection)
      .then(f => alive && setFields(f))
      .catch(() => alive && setFields([]));
    return () => {
      alive = false;
    };
  }, [collection]);

  const sort = parseSort(str(props.sort));
  const limit = typeof props.limit === "number" ? props.limit : 10;
  const columns = typeof props.columns === "number" ? props.columns : 1;
  const where = (props.where ?? {}) as Record<string, { equals?: unknown }>;
  const filterField = Object.keys(where)[0] ?? "";
  const filterValue = filterField ? str(where[filterField]?.equals) : "";

  const setSort = (field: string, dir: SortDir) =>
    set({ sort: buildSort(field === NONE ? "" : field, dir) });
  const setFilter = (field: string, value: string) => {
    if (!field || field === NONE || value === "")
      return set({ where: undefined });
    set({ where: { [field]: { equals: value } } });
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="nx-pb-section-label">Data source</div>

      <label className="nx-pb-control-label">Collection</label>
      <Select
        value={collection || NONE}
        onValueChange={v => set({ collection: v === NONE ? "" : v })}
      >
        <SelectTrigger aria-label="Collection">
          <SelectValue placeholder="Choose a collection…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Choose a collection…</SelectItem>
          {collections.map(c => (
            <SelectItem key={c.slug} value={c.slug}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <p className="nx-pb-empty" style={{ color: "var(--nx-destructive)" }}>
          Couldn’t load collections: {error}
        </p>
      ) : null}

      <div className="nx-pb-section-label">Order &amp; layout</div>

      <label className="nx-pb-control-label">Sort by</label>
      <div style={{ display: "flex", gap: 6 }}>
        <Select
          value={sort.field || NONE}
          onValueChange={v => setSort(v, sort.dir)}
        >
          <SelectTrigger aria-label="Sort field" style={{ flex: 1 }}>
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Default order</SelectItem>
            {fields.map(f => (
              <SelectItem key={f.name} value={f.name}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort.dir}
          onValueChange={v => setSort(sort.field, v as SortDir)}
        >
          <SelectTrigger aria-label="Sort direction" style={{ width: 110 }}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Asc</SelectItem>
            <SelectItem value="desc">Desc</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <label className="nx-pb-control-label" style={{ flex: 1 }}>
          Items
          <Input
            type="number"
            min={1}
            value={limit}
            aria-label="Limit"
            onChange={e =>
              set({
                limit:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
        <label className="nx-pb-control-label" style={{ flex: 1 }}>
          Columns
          <Input
            type="number"
            min={1}
            max={12}
            value={columns}
            aria-label="Columns"
            onChange={e =>
              set({
                columns: e.target.value === "" ? 1 : Number(e.target.value),
              })
            }
          />
        </label>
      </div>

      <div className="nx-pb-section-label">Filter</div>
      <div style={{ display: "flex", gap: 6 }}>
        <Select
          value={filterField || NONE}
          onValueChange={v => setFilter(v, v === NONE ? "" : filterValue)}
        >
          <SelectTrigger aria-label="Filter field" style={{ flex: 1 }}>
            <SelectValue placeholder="No filter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No filter</SelectItem>
            {fields.map(f => (
              <SelectItem key={f.name} value={f.name}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={filterValue}
          placeholder="equals…"
          aria-label="Filter value"
          disabled={!filterField}
          style={{ flex: 1 }}
          onChange={e => setFilter(filterField, e.target.value)}
        />
      </div>
    </div>
  );
}

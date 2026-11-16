"use client";

/**
 * A collection list's query in the Content tab, as one group of controls:
 * where its entries come from, the filters that narrow them, the order they
 * come in, how many show, and what the canvas shows when none match.
 *
 * - **Source**: a collection, or a to-many relation of the page's entry or
 *   of each item of the list this one sits in. A relation is offered only
 *   where it can be read, and the menu says why when none is.
 * - **Filters**: one sentence per row ("Category is any of News, Guides")
 *   that opens in place into its field, operator and value. A new filter
 *   opens already open. A row is written once it is complete; until then it
 *   is kept here and says what it lacks, and the canvas keeps the last
 *   query that read.
 * - **Sort**: a row per key, each with a drag handle, its field, its
 *   direction in words for the field's kind, and a menu to move or remove
 *   it. Alt+↑ and Alt+↓ move the focused row, as they move a block in Layers.
 * - **How many**: the number of items and the entries to skip, each refused
 *   inline while it is not one a save takes.
 * - **When nothing matches**: whether the canvas draws the entries or the
 *   empty state, which is editor state and never stored.
 *
 * Everything stored is read by the engine's `readListQuery`, and every
 * problem shown is the engine's `listQueryIssues`, so what this says and what
 * a save refuses are one judgement. Each action is one write of the block's
 * props, so it is one undo step. Only fields visitors can see are offered,
 * and none holding several values: the host's list is the public's.
 *
 * This module draws the field and the parts of its query; each area is a
 * module of its own: what the controls read and share
 * (`list-query-reading`), the Source field (`list-query-source`), the
 * filters (`list-query-filters`, with their values in
 * `list-query-filter-values`), the sort (`list-query-sort`), how many show
 * (`list-query-how-many`) and editing a custom source
 * (`list-query-named-source`).
 *
 * @module list-query-controls
 */
import { findNode, type BlockNode } from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { ContentServices } from "./content-controls";
import { FiltersGroup } from "./list-query-filters";
import {
  CanvasShowsGroup,
  codedIssues,
  HowManyGroup,
} from "./list-query-how-many";
import { sortValue } from "./list-query-model";
import { useNamedEditing, type NamedEditing } from "./list-query-named-source";
import {
  issuesAt,
  LIST_QUERY_PROPS,
  relatedShownOf,
  useListQueryReading,
  type ListQueryFieldProps,
  type ListQueryReading,
} from "./list-query-reading";
import { SortGroup } from "./list-query-sort";
import { NO_COLLECTIONS, SourceField } from "./list-query-source";
import {
  FiltersSetBy,
  InputsGroup,
  KeptInputsGroup,
} from "./named-query-controls";
import { judgedDraft } from "./named-query-model";

export { FilterValue, useEntryTitles } from "./list-query-filter-values";
export {
  fieldList,
  LimitNote,
  listLimit,
  PUBLIC_ONLY,
} from "./list-query-filters";
export {
  fieldSourceOf,
  LIST_QUERY_PROPS,
  useCustomSources,
  type ListQueryFieldProps,
} from "./list-query-reading";
// Part of this module's exported names; no importer in the package reads them.
// fallow-ignore-next-line unused-type
export type { ValueProps } from "./list-query-filter-values";
// fallow-ignore-next-line unused-type
export type { FieldChoice } from "./list-query-filters";
// fallow-ignore-next-line unused-type
export type { ListLimit } from "./list-query-filters";
// fallow-ignore-next-line unused-type
export type { OfferedField } from "./list-query-filters";

/** What the groups under Source are drawn with. */
interface QueryPartsProps {
  readonly id: string;
  readonly reading: ListQueryReading;
  readonly node: BlockNode;
  readonly editing: NamedEditing;
  readonly held: boolean;
  readonly services: ContentServices | undefined;
  readonly sortFieldAsked: number | undefined;
  readonly commit: (changes: Readonly<Record<string, unknown>>) => void;
}

/** Filters and Sort, for a collection or a related source. */
function CollectionParts({
  id,
  reading,
  node,
  held,
  services,
  sortFieldAsked,
  commit,
}: QueryPartsProps): React.JSX.Element {
  const { query, issues, fields, fieldSource } = reading;
  const unsourced = held || query.collection === undefined;
  return (
    <>
      <FiltersGroup
        key={query.collection ?? ""}
        id={`${id}-filters`}
        query={query}
        node={node}
        fields={fields}
        fieldSource={fieldSource}
        disabled={unsourced}
        problems={codedIssues(issues, "filters", "list-filter-invalid")}
        services={services}
        relatedWordsShown={relatedShownOf(query, reading.related)}
        onFilters={filters => commit({ filters })}
      />
      <SortGroup
        id={`${id}-sort`}
        query={query}
        node={node}
        fields={fields}
        fieldSource={fieldSource}
        disabled={unsourced}
        problems={codedIssues(issues, "sort", "list-sort-invalid")}
        fieldAsked={sortFieldAsked}
        onSort={keys => commit({ sort: sortValue(keys) })}
      />
    </>
  );
}

/**
 * The groups under Source: Filters and Sort for a collection or a related
 * source; Inputs and the read-only Filters and sort line for a custom one;
 * and for a stored custom source the site no longer registers, what it
 * keeps, once the site's sources are known to lack it.
 */
function QueryParts(props: QueryPartsProps): React.JSX.Element | null {
  const { id, reading, editing, held, services } = props;
  const named = editing.named;
  if (named === undefined) return <CollectionParts {...props} />;
  const source = named.source;
  if (source === undefined) {
    return reading.customsRead === undefined ? null : (
      <KeptInputsGroup id={`${id}-inputs`} params={named.params} />
    );
  }
  const judged = judgedDraft(source.declaration, named.params);
  return (
    <>
      <InputsGroup
        key={named.name}
        id={`${id}-inputs`}
        declaration={source.declaration}
        params={named.params}
        problems={judged.problems}
        unknown={judged.unknown}
        disabled={held}
        services={services}
        onInput={editing.setInput}
      />
      <FiltersSetBy id={`${id}-filters`} declaration={source.declaration} />
    </>
  );
}

/**
 * The Source control, and, where the site's collections could not be
 * listed, the note saying so: then the custom sources are offered alone, or
 * no source can be chosen where there are none.
 */
function SourcePart({
  id,
  reading,
  editing,
  held,
}: {
  id: string;
  reading: ListQueryReading;
  editing: NamedEditing;
  held: boolean;
}): React.JSX.Element {
  const { listed, issues } = reading;
  const unlisted = listed === undefined || listed.kind === "failed";
  const offersCustom = reading.customs.length > 0;
  // Custom sources read before the collections are usable at once: the
  // collections join the menu when they arrive.
  const waiting = listed?.kind === "loading" && offersCustom;
  return (
    <>
      {unlisted ? (
        <p className="nx-inspector__note">
          {offersCustom ? (
            <>
              The site&apos;s collections could not be listed, so only its
              custom sources are offered here.
            </>
          ) : (
            <>
              The site&apos;s collections could not be listed, so this
              list&apos;s source, filters and sort can&apos;t be chosen here.
            </>
          )}
        </p>
      ) : null}
      {unlisted && !offersCustom ? null : (
        <SourceField
          id={id}
          reading={reading}
          listed={unlisted || waiting ? NO_COLLECTIONS : listed}
          named={editing.named}
          disabled={held}
          // A source just picked has nothing stored to refuse yet.
          problems={
            editing.named?.drafted === true
              ? []
              : issuesAt(issues, ["collection", "relation", "namedQuery"])
          }
          onPick={editing.pickSource}
        />
      )}
    </>
  );
}

/**
 * A collection list's query, drawn as one group in the Content tab where its
 * `collection` prop would sit.
 */
export function ListQueryField({
  props,
  writable,
  services,
  onCommitMany,
  document,
  nodeId,
  showsEmpty,
  onShowEmpty,
  sortFieldAsked,
  onStillShowing,
}: ListQueryFieldProps): React.JSX.Element | null {
  const id = React.useId();
  const reading = useListQueryReading(props, services, document, nodeId);
  const commit = (changes: Readonly<Record<string, unknown>>) => {
    onCommitMany(changes);
  };
  const editing = useNamedEditing(nodeId, reading, commit, onStillShowing);
  const node = findNode(document.nodes, nodeId);
  if (node === undefined) return null;
  const held = LIST_QUERY_PROPS.some(
    name => props.some(prop => prop.name === name) && !writable(name)
  );
  const { issues } = reading;
  return (
    <div className="nx-list-query" data-content-control="listQuery">
      <SourcePart
        id={`${id}-source`}
        reading={reading}
        editing={editing}
        held={held}
      />
      <QueryParts
        id={id}
        reading={reading}
        node={node}
        editing={editing}
        held={held}
        services={services}
        sortFieldAsked={sortFieldAsked}
        commit={commit}
      />
      <HowManyGroup
        id={`${id}-many`}
        values={reading.values}
        limitFallback={props.find(prop => prop.name === "limit")?.defaultValue}
        issues={issues}
        disabled={held}
        count={services?.countListEntries}
        commit={commit}
      />
      {onShowEmpty === undefined ? null : (
        <CanvasShowsGroup
          id={`${id}-empty`}
          showsEmpty={showsEmpty}
          onShowEmpty={onShowEmpty}
        />
      )}
    </div>
  );
}

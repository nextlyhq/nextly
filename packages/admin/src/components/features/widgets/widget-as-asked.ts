/**
 * A placed widget as its reader's settings ask it: the settings its component is handed, whether
 * a card set as they say reads anything, what it asks as one comparable value, and the title it
 * is drawn under.
 *
 * Every card is answered on the server by its widget's `load`, which reads the settings itself,
 * so the settings are all a card asks with: one reading of them here, for the batch, the card,
 * the quick setting and the settings preview alike.
 *
 * @module components/features/widgets/widget-as-asked
 */

import {
  applyWidgetSettings,
  effectiveWidgetSettings,
  type KnobContext,
  type PublishedContentSource,
  type WidgetQuery,
} from "nextly/config";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { quickSettingOf, quickValueLabel } from "./edit/quick-setting";

/**
 * Whether a read can be asked as it stands: it names what it reads, and a
 * grouped one names what it groups by. A card whose Collection setting is
 * empty has nothing to read, and a Breakdown on a collection with nothing to
 * divide by groups by nothing. What `askableWith` judges a card's own read by,
 * so the add panel and the settings sheet offer a widget on exactly the
 * collections its card can read.
 */
export function askableQuery(
  query: { source?: string; op?: string; groupBy?: string } | undefined
): query is WidgetQuery {
  return (
    query !== undefined &&
    query.source !== undefined &&
    !(query.op === "groupBy" && query.groupBy === undefined)
  );
}

/**
 * What the knobs consult: each collection as the server published it to this reader, and the
 * fields it offers. The one place a knob reads the reader's collections from.
 */
function readerContext(
  sources: readonly PublishedContentSource[] | undefined
): KnobContext {
  const sourceOf = (collection: string) =>
    sources?.find(source => source.collection === collection);
  return {
    sourceOf,
    fieldsOf: (collection: string) => sourceOf(collection)?.fields,
  };
}

/**
 * Whether a card of `widget` set as `config` says reads anything: judged by the settings whose
 * reading core's knobs decide, as its widget's `load` applies them. A titled Collection setting
 * reads a collection only where it can title the rows (its list keeps a source); a Group by that
 * falls back to the collection reads one only where the collection has something to divide by. A
 * card with neither, such as a note, always reads. What the add panel and the Collection picker
 * ask of a widget set to each collection, so it is offered only where its card would draw.
 */
export function askableWith(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[]
): boolean {
  const settings = widget.settings ?? [];
  const ctx = readerContext(sources);
  const probes = [
    ...(settings.some(
      setting => setting.type === "collection" && setting.rows === "titled"
    )
      ? [{ op: "list" }]
      : []),
    ...(settings.some(
      setting =>
        setting.type === "groupBy" && setting.defaultFrom === "collection"
    )
      ? [{ op: "groupBy" }]
      : []),
  ];
  return probes.every(probe =>
    askableQuery(applyWidgetSettings(probe, settings, config, ctx))
  );
}

/**
 * The settings a card's component is handed: its reader's over the widget's defaults, each read
 * against the collections and fields this reader may use, so a component building a link from
 * its Filter names the filter its answer was read under, never a stored one set aside for a
 * field this reader may not use.
 */
export function settingsAsAsked(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[]
): Record<string, unknown> {
  return effectiveWidgetSettings(
    widget.settings,
    config,
    readerContext(sources)
  );
}

/**
 * The name of a collection as the server published it to this reader: its label, or its slug
 * where none is known.
 */
export function collectionLabel(
  collection: string,
  sources: readonly { collection: string; label: string }[] | undefined
): string {
  return (
    sources?.find(source => source.collection === collection)?.label ??
    collection
  );
}

/**
 * The title a card is drawn under, and the subtitle beneath it: the one reading of both.
 *
 * A card whose Collection setting names a collection is titled AUTOMATICALLY by its subject,
 * that collection, and the choice its quick select holds where it has one ("Posts · last 30
 * days"), with its widget's name as the subtitle ("Over time"). So two of a widget's cards for
 * different collections are told apart by sight and by the region's name alike, and read subject
 * first. A card set to none is titled as its widget, with no subtitle.
 *
 * A title the reader gave the card (`ownTitle`, the placement's) replaces the title and keeps the
 * widget's name beneath it, unless the two are the same words.
 */
export function titleAsAsked(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources?: readonly PublishedContentSource[],
  ownTitle?: string
): { title: string; subtitle?: string } {
  const own = ownTitle?.trim();
  if (own !== undefined && own !== "") {
    return own === widget.title
      ? { title: own }
      : { title: own, subtitle: widget.title };
  }
  return automaticTitle(widget, config, sources);
}

/** A card's title as its widget and settings give it, when its reader gave it none. */
function automaticTitle(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined,
  sources: readonly PublishedContentSource[] | undefined
): { title: string; subtitle?: string } {
  const name = widget.settings?.find(
    setting => setting.type === "collection"
  )?.name;
  const values = effectiveWidgetSettings(widget.settings, config);
  const collection = name === undefined ? undefined : values[name];
  if (typeof collection !== "string") return { title: widget.title };
  const subject = collectionLabel(collection, sources);
  const choice = quickChoiceOf(widget, values);
  return {
    title: choice === undefined ? subject : `${subject} · ${choice}`,
    subtitle: widget.title,
  };
}

/**
 * The option a card's quick select is set to, as its automatic title names it ("Posts · last 30
 * days"), so the title says what the quick control changed; nothing for a toggle, whose On or
 * Off says nothing on its own, or for a widget with no quick select.
 */
function quickChoiceOf(
  widget: DashboardWidget,
  values: Record<string, unknown>
): string | undefined {
  const quick = quickSettingOf(widget.settings);
  if (quick?.type !== "select") return undefined;
  const label = quickValueLabel(quick, values[quick.name]);
  // Lowercased to sit inside the title, unless it starts as an acronym does ("UTC day").
  return /[A-Z]/.test(label.charAt(1))
    ? label
    : `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

/**
 * What a card asks with `config`, as one comparable string: its settings
 * themselves, since its widget's `load` builds its data from them. One reading,
 * so a quick setting and the settings preview agree on whether a change asks
 * again.
 */
export function questionOf(
  config: Record<string, unknown> | undefined
): string {
  return JSON.stringify({ settings: config ?? {} });
}

/**
 * Visibility conditions applied for the entry a template is previewed with,
 * as the editor's host hands them to the canvas and to the Previewing strip.
 *
 * @module use-applied-conditions
 */
import type {
  BlockDocument,
  DefinitionsById,
  DocumentLimits,
} from "@nextlyhq/blocks-engine";
import {
  conditionDayStart,
  type BlocksFieldShapes,
  type ItemHiddenAs,
} from "@nextlyhq/blocks-react";
import { useMemo } from "react";

import {
  appliedConditionsOf,
  itemHiddenAsOf,
  type AppliedConditions,
  type ConditionsPreview,
  type DrawnWith,
} from "./applied-conditions";
import { useLoopCollections } from "./collection-loop-controls";
import {
  conditionFieldsOf,
  conditionFieldsOfShapes,
  type ConditionField,
} from "./condition-model";
import type { ContentServices } from "./content-controls";
import { layerLabel, type ComponentTitleOf } from "./layers";
import type { PreviewedEntry } from "./previewed-entry";

/**
 * What a template's conditions are checked against, from the entry it is
 * previewed with: its published values as a visitor reads them, and the
 * fields a visitor may read. `undefined` while there is no entry to check.
 *
 * The values are the published entry's, never the working draft the canvas
 * otherwise draws, so the canvas hides what a visitor would not see. An entry
 * a visitor reads none of (never published, or the public may not read it)
 * hides every conditioned block, as the published page does.
 *
 * `labelled` are the collection's fields as the "Show when" rows name them,
 * where the host lists them; the entry's own field shapes, named by their
 * stored names, otherwise.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function conditionsPreviewOf(
  previewed: PreviewedEntry | undefined,
  noun: string,
  labelled?: readonly ConditionField[],
  /** The site's zone, where a day compared by a condition starts. */
  timeZone?: string
): ConditionsPreview | undefined {
  if (previewed?.kind !== "entry") return undefined;
  const readable = previewed.fields;
  return {
    subject:
      previewed.publicValues === null
        ? undefined
        : {
            fields: {
              declared: new Set(readable.map(field => field.name)),
              readable,
            },
            values: previewed.publicValues,
          },
    noun,
    fields: labelled ?? conditionFieldsOfShapes(readable),
    // The published page's own rule for when a day starts, in the site's
    // zone, so a date compared by day is judged as a visitor gets it.
    dayStart: conditionDayStart(timeZone),
  };
}

/** What the conditions are applied with, besides the entry. */
export interface AppliedConditionsOptions {
  /** What the entry is called in words, lower case: "post". */
  readonly noun: string;
  /** The collections the inspector lists, for the fields' names. */
  readonly services?: Pick<ContentServices, "listLoopCollections">;
  /** A placed component's title, for a hidden placement's name. */
  readonly componentTitle?: ComponentTitleOf;
  /** The limits the canvas draws under. */
  readonly limits?: DocumentLimits;
  /** The definitions of the components the page places. */
  readonly definitions?: DefinitionsById;
  /** The regions of the page's Layout the canvas draws around it. */
  readonly regions?: DrawnWith["regions"];
  /** The site's time zone, as the canvas's bindings read it. */
  readonly timeZone?: string;
  /**
   * Whether the canvas's lists draw the entries a visitor reads, so a block
   * a list's item decides is judged for each item drawn.
   */
  readonly itemsJudged?: boolean;
}

/**
 * The page with its conditions applied for `previewed`, the entry a template
 * is previewed with, which the host hands only while the author's switch is
 * on; `undefined` otherwise, when the canvas draws every conditioned block.
 * Each hidden block is named as its Layers row names it, and each condition
 * that hides it as its "Show when" row does.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function useAppliedConditions(
  document: BlockDocument,
  previewed: PreviewedEntry | undefined,
  {
    noun,
    services,
    componentTitle,
    limits,
    definitions,
    regions,
    timeZone,
    itemsJudged,
  }: AppliedConditionsOptions
): AppliedConditions | undefined {
  // The collections the inspector lists, read once and shared, for the
  // fields' names as the rows give them.
  const listed = useLoopCollections(services?.listLoopCollections);
  const collection = previewed?.kind === "entry" ? previewed.collection : "";
  const labelled = useMemo(() => {
    if (listed?.kind !== "ready") return undefined;
    const found = listed.collections.find(each => each.slug === collection);
    return found === undefined ? undefined : conditionFieldsOf(found);
  }, [listed, collection]);
  const preview = useMemo(
    () => conditionsPreviewOf(previewed, noun, labelled, timeZone),
    [previewed, noun, labelled, timeZone]
  );
  return useMemo(
    () =>
      preview === undefined
        ? undefined
        : appliedConditionsOf(
            document,
            preview,
            node => layerLabel(node, undefined, componentTitle),
            {
              ...(limits === undefined ? {} : { limits }),
              ...(definitions === undefined ? {} : { definitions }),
              ...(regions === undefined ? {} : { regions }),
              ...(itemsJudged === true ? { itemsJudged } : {}),
            }
          ),
    [
      document,
      preview,
      componentTitle,
      limits,
      definitions,
      regions,
      itemsJudged,
    ]
  );
}

/** What a list item's hidden block is drawn with, besides the item. */
export interface ItemHiddenOptions {
  /** The fields a visitor may read of each collection, as the canvas's bindings read them. */
  readonly fieldShapes: BlocksFieldShapes | undefined;
  /** The collections the inspector lists, for the fields' names. */
  readonly services?: Pick<ContentServices, "listLoopCollections">;
  /** A placed component's title, for a hidden placement's name. */
  readonly componentTitle?: ComponentTitleOf;
  /** The site's time zone, as the canvas's bindings read it. */
  readonly timeZone?: string;
}

/**
 * What the canvas draws where a list's item hides a block while conditions
 * apply: the block's marker, named as its Layers row names it, saying why
 * that entry hides it as the "Show when" rows word it.
 *
 * @experimental Settles with the editor's condition controls.
 */
export function useItemHiddenAs({
  fieldShapes,
  services,
  componentTitle,
  timeZone,
}: ItemHiddenOptions): ItemHiddenAs {
  const listed = useLoopCollections(services?.listLoopCollections);
  return useMemo(() => {
    const collections =
      listed?.kind === "ready" ? listed.collections : undefined;
    return itemHiddenAsOf({
      fieldsOf: collection => fieldShapes?.fieldsOf({ collection }),
      labelledOf: collection => {
        const found = collections?.find(each => each.slug === collection);
        return found === undefined ? undefined : conditionFieldsOf(found);
      },
      nameOf: node => layerLabel(node, undefined, componentTitle),
      dayStart: conditionDayStart(timeZone),
    });
  }, [listed, fieldShapes, componentTitle, timeZone]);
}

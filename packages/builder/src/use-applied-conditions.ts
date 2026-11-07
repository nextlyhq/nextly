/**
 * Visibility conditions applied for the entry a template is previewed with,
 * as the editor's host hands them to the canvas and to the Previewing strip.
 *
 * @module use-applied-conditions
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { useMemo } from "react";

import {
  appliedConditionsOf,
  type AppliedConditions,
  type ConditionsPreview,
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
  labelled?: readonly ConditionField[]
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
  };
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
  noun: string,
  services: Pick<ContentServices, "listLoopCollections"> | undefined,
  componentTitle?: ComponentTitleOf
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
    () => conditionsPreviewOf(previewed, noun, labelled),
    [previewed, noun, labelled]
  );
  return useMemo(
    () =>
      preview === undefined
        ? undefined
        : appliedConditionsOf(document, preview, node =>
            layerLabel(node, undefined, componentTitle)
          ),
    [document, preview, componentTitle]
  );
}

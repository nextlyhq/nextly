/**
 * What the component editor is told about the component it edits, read once
 * per editor.
 *
 * Read only while the document is a component with a row: a page has no
 * fields to expose, and a component not yet saved has no live definition and
 * no placements.
 *
 * Fresh on every mount, as the library read is: the live definition changes
 * through a publish this route hears nothing of.
 *
 * @module admin/component-facts-client
 */
import type { ComponentFieldsHost } from "@nextlyhq/builder/shell";
import { useDocumentLocale, usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useMemo, useState } from "react";

import {
  componentFactsPath,
  PAGE_BUILDER_PLUGIN_NAME,
  type ComponentFactsResponse,
} from "../library-contract";

/** Said while the live definition's ids are being read. */
export const FACTS_PENDING =
  "Checking which fields this component’s published version uses…";

/** Said when they could not be read. */
export const FACTS_FAILED =
  "This component’s published fields could not be read, so a new field can’t be added yet. Reload to try again.";

/**
 * The inspector's component facts, or `undefined` for a document with no live
 * definition to read.
 *
 * Until the read has answered, adding a field WAITS rather than minting from
 * the ids the draft holds: a draft that dropped a published field no longer
 * holds its id, and a new field minted under it would take over the values
 * placements still store. Read in the language being edited, since a
 * localized definition can expose different fields in each.
 */
export function useComponentFacts(
  componentId: string | undefined
): ComponentFieldsHost | undefined {
  const locale = useDocumentLocale();
  // A read of this editor's OWN, keyed by a token made when it mounts: the
  // query cache would otherwise hand back an answer from an earlier mount while
  // it asks again, and a definition published since could hold an id that
  // answer lacks.
  const [mounted] = useState(mountToken);
  const read = usePluginRoute<ComponentFactsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: componentFactsPath(componentId ?? "", locale?.code, mounted),
    enabled: componentId !== undefined,
    staleTime: 0,
  });
  const { data, error } = read;
  const failed = error !== null && error !== undefined;
  return useMemo(() => {
    if (componentId === undefined) return undefined;
    // A failed read, even one holding an earlier answer, is not trusted.
    if (failed) return { reserved: { unavailable: FACTS_FAILED } };
    if (data === undefined) return { reserved: { unavailable: FACTS_PENDING } };
    return {
      reserved: data.live,
      ...(data.reach === null ? {} : { reach: data.reach }),
    };
  }, [componentId, data, failed]);
}

/** A token unique to one mount of the editor. */
function mountToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import {
  componentFactsPath,
  PAGE_BUILDER_PLUGIN_NAME,
  type ComponentFactsResponse,
} from "../library-contract";

/**
 * The inspector's component facts, or `undefined` while there are none to
 * give. Until the read answers, the ids the session has seen still keep a new
 * field off every id the editor opened with.
 */
export function useComponentFacts(
  componentId: string | undefined
): ComponentFieldsHost | undefined {
  const read = usePluginRoute<ComponentFactsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: componentFactsPath(componentId ?? ""),
    enabled: componentId !== undefined,
    staleTime: 0,
  });
  const { data } = read;
  return useMemo(
    () =>
      data === undefined
        ? undefined
        : {
            reserved: data.live,
            ...(data.reach === null ? {} : { reach: data.reach }),
          },
    [data]
  );
}

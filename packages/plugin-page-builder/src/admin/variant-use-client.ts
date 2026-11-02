/**
 * The count the variant delete dialog shows, asked of this plugin's
 * variant-use route when the dialog opens.
 *
 * Asked only for a component with a row: one not yet saved has no placements.
 *
 * @module admin/variant-use-client
 */
import {
  isComponentDocument,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type {
  ComponentVariantsHost,
  VariantUse,
} from "@nextlyhq/builder/shell";
import {
  useDocumentIdentity,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";
import { useMemo } from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  VARIANT_USE_ROUTE_PATH,
  type VariantUseRequest,
  type VariantUseResponse,
} from "../variant-use-contract";

/**
 * The inspector's variant host for a stored component, or `undefined` for a
 * document with no row to count placements of.
 */
export function useVariantUse(
  componentId: string | undefined
): ComponentVariantsHost | undefined {
  const { write } = usePluginRouteMutation<
    VariantUseRequest,
    VariantUseResponse
  >({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: VARIANT_USE_ROUTE_PATH,
  });
  return useMemo(() => {
    if (componentId === undefined) return undefined;
    return {
      countUse: async (variantId: string): Promise<VariantUse> => {
        const answer = await write({ componentId, variantId });
        // The writer resolves `undefined` on failure, which the dialog says
        // as a count that could not be made rather than as none.
        if (answer === undefined) throw new Error("not counted");
        return answer;
      },
    };
  }, [componentId, write]);
}

/**
 * The variant host for the component a document view edits: asked only of a
 * component with a row, since a page has no variants and a component not yet
 * saved has no placements.
 */
export function useEditedComponentVariants(
  document: BlockDocument
): ComponentVariantsHost | undefined {
  const identity = useDocumentIdentity();
  return useVariantUse(
    isComponentDocument(document) ? identity?.documentId : undefined
  );
}

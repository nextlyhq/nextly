"use client";

/**
 * The outline of the fields a builder page is editing, with the field groups
 * it uses: built once per page, and read by both the outline and the
 * settings panel, so the two answer every question about a row alike.
 */
import { useMemo } from "react";

import { useBlockCatalogs } from "@admin/hooks/useBlockCatalogs";
import { useOutlineFieldGroups } from "@admin/hooks/useOutlineFieldGroups";
import { blockCatalogKey } from "@admin/lib/builder/outline/block-rows";
import {
  buildOutline,
  flattenOutline,
  type FieldGroupsLoad,
  type LoadedFieldGroup,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import type { BuilderField } from "../types";

export function useBuilderOutline(
  fields: readonly BuilderField[],
  entityReadOnly: boolean,
  /** Whether the entity is translated, so its fields can be. */
  entityLocalized: boolean
): {
  outline: readonly OutlineNode[];
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
  fieldGroupsLoad: FieldGroupsLoad;
} {
  const { fieldGroups, load } = useOutlineFieldGroups();
  const options = useMemo(
    () => ({
      entityReadOnly,
      entityLocalized,
      fieldGroups,
      fieldGroupsLoad: load,
    }),
    [entityReadOnly, entityLocalized, fieldGroups, load]
  );
  // The allow-list of every blocks field the outline holds, at any depth and
  // in the field groups it uses too, so each is read once.
  const allowLists = useMemo(() => {
    const lists = new Map<string, readonly string[] | undefined>();
    for (const node of flattenOutline(buildOutline(fields, options))) {
      if (!node.blocks || node.blocks.allow?.length === 0) continue;
      lists.set(blockCatalogKey(node.blocks.allow), node.blocks.allow);
    }
    return lists;
  }, [fields, options]);
  const blockCatalogs = useBlockCatalogs(allowLists);
  const outline = useMemo(
    () => buildOutline(fields, { ...options, blockCatalogs }),
    [fields, options, blockCatalogs]
  );
  return { outline, fieldGroups, fieldGroupsLoad: load };
}

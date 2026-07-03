import { json } from "nextly/config";

import { defaultBlockRegistry, validateDocument } from "../core";

/** String path the host admin resolves to our field editor (registered on `./admin`). */
export const FIELD_COMPONENT_PATH =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderField";

export interface PageBuilderFieldOptions {
  /** Admin label for the field editor. */
  label?: string;
  /**
   * Show the editor only when a sibling field matches — enables an Elementor-style
   * "choose your editor" workflow (e.g. show the builder only when a `mode` select is
   * "page-builder"). Maps to the field's `admin.condition`.
   */
  condition?: {
    field: string;
    equals?: unknown;
    notEquals?: unknown;
    exists?: boolean;
  };
}

/**
 * A page-builder editor as a custom field (spec §9/§11). Stores the BlockDocument as
 * JSON and renders our editor via `admin.component` (D24, the plugin-supplied field
 * editor). Works in BOTH collections and singles — the host form persists the value.
 * Register the component with `@nextlyhq/plugin-page-builder/admin`.
 *
 * Node-side the block registry is empty at config-load (renderers live in `./render`),
 * so the validator runs with `allowUnknown: true` — it still enforces the structural
 * invariants (depth / node count / unique ids / namespaced types).
 */
export function pageBuilderField(
  name: string,
  opts: PageBuilderFieldOptions = {}
) {
  return json({
    name,
    label: opts.label,
    admin: { component: FIELD_COMPONENT_PATH, condition: opts.condition },
    validate: value =>
      validateDocument(value, defaultBlockRegistry, { allowUnknown: true }),
  });
}

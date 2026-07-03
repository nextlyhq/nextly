import { json } from "nextly/config";

import { defaultBlockRegistry, validateDocument } from "../core";

/** String path the host admin resolves to our field editor (registered on `./admin`). */
export const FIELD_COMPONENT_PATH =
  "@nextlyhq/plugin-page-builder/admin#PageBuilderField";

export interface PageBuilderFieldOptions {
  /** Admin label for the field editor. */
  label?: string;
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
    admin: { component: FIELD_COMPONENT_PATH },
    validate: value =>
      validateDocument(value, defaultBlockRegistry, { allowUnknown: true }),
  });
}

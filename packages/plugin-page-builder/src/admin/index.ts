"use client";

/**
 * "./admin" entry — the React surface the entry form mounts for this plugin.
 *
 * One component, where there were five. The other four were the previous
 * editor: an edit view, a field wrapper and two mode toggles, all rendering a
 * canvas and inspector this package implemented itself. Editing now belongs to
 * `@nextlyhq/builder`, and blocks draw through `@nextlyhq/blocks-react`, so the
 * plugin contributes the FIELD and not the editor behind it.
 *
 * `BlocksSummary` stays because it is the blocks field's own admin surface
 * rather than part of that editor: it reads the stored document through the
 * entry form's control and describes it, importing nothing from this package.
 * `BLOCKS_FIELD_COMPONENT` names it, so removing it would leave every blocks
 * field pointing at a component that no longer resolves — a field that fails to
 * render rather than a field with no editor.
 *
 * @module @nextlyhq/plugin-page-builder/admin
 */

export { BlocksSummary } from "./BlocksSummary";
export type { BlocksSummaryProps } from "./BlocksSummary";

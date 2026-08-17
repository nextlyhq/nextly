"use client";

/**
 * "./admin" entry — REGISTERS the plugin's React admin components, and exports
 * them.
 *
 * The registration is the load-bearing half. A field names its control by
 * SPECIFIER (`BLOCKS_FIELD_COMPONENT`), and the admin resolves that string
 * through the component registry — so an entry that exports a component without
 * registering it leaves every blocks field rendering an empty group with its
 * label and nothing inside. Nothing type-checks the link, because the link is a
 * string.
 *
 * One component, where there were five. The other four were the previous
 * editor: an edit view, a field wrapper and two schema/entry toggles, all
 * rendering a canvas and inspector this package implemented itself. Editing now
 * belongs to `@nextlyhq/builder` and blocks draw through
 * `@nextlyhq/blocks-react`, so the plugin contributes the FIELD and not the
 * editor behind it.
 *
 * `BlocksSummary` stays because it is the blocks field's own admin surface
 * rather than part of that editor: it reads the stored document through the
 * entry form's control and describes it, importing nothing from this package.
 *
 * @module @nextlyhq/plugin-page-builder/admin
 */

import {
  registerComponents,
  registerKnownPlugin,
} from "@nextlyhq/plugin-sdk/admin";

import { BlocksSummary } from "./BlocksSummary";

/**
 * The blocks field's editor-form control.
 *
 * Must match `BLOCKS_FIELD_COMPONENT` exported from the "." entry. The two are
 * separate declarations of one string because the field is declared in a
 * Node-safe module and the component only exists behind this client boundary —
 * so the entry cannot import the constant without dragging React into the
 * isomorphic bundle. A mismatch is silent: the field renders empty.
 */
const BLOCKS_SUMMARY_PATH = "@nextlyhq/plugin-page-builder/admin#BlocksSummary";

const COMPONENTS = {
  [BLOCKS_SUMMARY_PATH]: BlocksSummary,
};

// Eager registration on module load.
registerComponents(COMPONENTS);

// Lazy fallback: the host can trigger registration on demand by package prefix.
registerKnownPlugin("@nextlyhq/plugin-page-builder", () => {
  registerComponents(COMPONENTS);
  return Promise.resolve();
});

export { BlocksSummary };
export type { BlocksSummaryProps } from "./BlocksSummary";

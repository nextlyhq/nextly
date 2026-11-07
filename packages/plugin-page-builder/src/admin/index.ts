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

import {
  BUILDER_VIEW_COMPONENT,
  ENTRY_DESIGN_SECTION_COMPONENT,
  REMOVE_LAYOUT_ACTION_COMPONENT,
  TEMPLATE_DELETE_COMPONENT,
  TEMPLATE_OWN_DESIGNS_COMPONENT,
} from "../builder-view";
import { TRANSFER_IMPORT_COMPONENT } from "../transfer/transfer-contract";
/*
 * The editor's stylesheet, loaded by whatever loads this entry.
 *
 * An app reaches this module through the component map `nextly generate:types`
 * writes, which imports it wherever the plugin is configured. Importing the
 * sheet here is what makes "configure the plugin" enough: before, every app
 * also had to import it in its admin page by hand, and one that missed the step
 * got an unstyled builder with no error. An app that still imports it by hand
 * loads the same file, which its bundler includes once.
 *
 * Relative, and kept external by the build (`tsdown.config.ts`): the sheet is
 * copied into `dist/styles` rather than bundled, so `dist/admin/index.js`
 * reaches the shipped file by the same relative path this source file uses.
 */
import "../styles/editor.css";

import { BlocksField } from "./BlocksField";
import { BlocksSummary } from "./BlocksSummary";
import { PageBuilderView } from "./editor/PageBuilderView";
import { registerEntryDesignColumn } from "./entry-design-column";
import { EntryDesignSection } from "./EntryDesignSection";
import { RemoveLayoutToolbarSlot } from "./RemoveLayoutAction";
import { TemplateDeleteAction } from "./TemplateDeleteAction";
import { TemplateOwnDesigns } from "./TemplateOwnDesigns";
import { registerExportActions } from "./transfer-export-action";
import { TransferImport } from "./transfer-import";

/**
 * The blocks field's editor-form control.
 *
 * Must match `BLOCKS_FIELD_COMPONENT` exported from the "." entry. The two are
 * separate declarations of one string because the field is declared in a
 * Node-safe module and the component only exists behind this client boundary —
 * so the entry cannot import the constant without dragging React into the
 * isomorphic bundle. A mismatch is silent: the field renders empty.
 */
const BLOCKS_FIELD_PATH = "@nextlyhq/plugin-page-builder/admin#BlocksField";

/**
 * Still registered under its own specifier.
 *
 * `BlocksField` composes it, so the field no longer resolves to it — but the
 * summary is a usable control in its own right for a host that wants the
 * account of a document without the way in to change it, and unregistering a
 * published specifier would break any such host silently.
 */
const BLOCKS_SUMMARY_PATH = "@nextlyhq/plugin-page-builder/admin#BlocksSummary";

const COMPONENTS = {
  [BLOCKS_FIELD_PATH]: BlocksField,
  [BLOCKS_SUMMARY_PATH]: BlocksSummary,
  [TRANSFER_IMPORT_COMPONENT]: TransferImport,
  // The editor itself, drawn by the admin as a view of the document at the
  // address the blocks field's card links to.
  [BUILDER_VIEW_COMPONENT]: PageBuilderView,
  // "Remove Layout…" in a Layout's document bar.
  [REMOVE_LAYOUT_ACTION_COMPONENT]: RemoveLayoutToolbarSlot,
  // An entry's own design: the Design section of every entry's side panel,
  // a template's own designs, and the delete that says what it means.
  [ENTRY_DESIGN_SECTION_COMPONENT]: EntryDesignSection,
  [TEMPLATE_OWN_DESIGNS_COMPONENT]: TemplateOwnDesigns,
  [TEMPLATE_DELETE_COMPONENT]: TemplateDeleteAction,
};

// Eager registration on module load.
registerComponents(COMPONENTS);
// "Export" on the Components, Patterns and Layouts lists.
registerExportActions();
// The Design column on the lists of collections that have a template.
registerEntryDesignColumn();

// Lazy fallback: the host can trigger registration on demand by package prefix.
registerKnownPlugin("@nextlyhq/plugin-page-builder", () => {
  registerComponents(COMPONENTS);
  registerExportActions();
  registerEntryDesignColumn();
  return Promise.resolve();
});

export {
  BlocksField,
  BlocksSummary,
  EntryDesignSection,
  PageBuilderView,
  RemoveLayoutToolbarSlot,
  TemplateDeleteAction,
  TemplateOwnDesigns,
  TransferImport,
};
/**
 * Called by the app's generated component map to hand the editor the block
 * modules plugins declared (`editorEntry`, `editor.component`). Not for a
 * plugin to call: the map is what knows every declared path.
 */
export { registerBlockEditorModules } from "./contributed-blocks";
export type { BlockEditorModules } from "./contributed-blocks";
export type { BlocksFieldProps } from "./BlocksField";
export type { BlocksSummaryProps } from "./BlocksSummary";

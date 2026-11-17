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
 * @module @nextlyhq/plugin-page-builder/admin
 */

import { registerComponents } from "@nextlyhq/plugin-sdk/admin";

import {
  BINDINGS_TO_FIX_CARD_COMPONENT,
  BINDINGS_TO_FIX_PAGE_COMPONENT,
  BUILDER_VIEW_COMPONENT,
  COMPONENT_STORE_DELETE_HOST_COMPONENT,
  COMPONENT_LIST_TOOLS_COMPONENT,
  DELETE_COMPONENT_REPLACEMENT_COMPONENT,
  ENTRY_DESIGN_SECTION_COMPONENT,
  SINGLE_SHOWN_ON_SECTION_COMPONENT,
  OVERVIEW_PAGE_COMPONENT,
  REMOVE_LAYOUT_ACTION_COMPONENT,
  TEMPLATE_DELETE_COMPONENT,
  TEMPLATE_DESIGN_DETAILS_COMPONENT,
  TEMPLATE_OWN_DESIGNS_COMPONENT,
} from "../builder-view";
import { TRANSFER_IMPORT_COMPONENT } from "../transfer/transfer-contract";

import type { BindingsToFixCard as BindingsToFixCardPart } from "./bindings-report/BindingsToFixCard";
import type { BindingsToFixPage as BindingsToFixPagePart } from "./bindings-report/BindingsToFixPage";
import type { BlocksField as BlocksFieldPart } from "./BlocksField";
import type {
  ComponentListTools as ComponentListToolsPart,
  ComponentStoreDeleteHost as ComponentStoreDeleteHostPart,
  DeleteComponentReplacement as DeleteComponentReplacementPart,
} from "./DeleteComponentAction";
import type { PageBuilderView as PageBuilderViewPart } from "./editor/PageBuilderView";
import { registerEntryDesignColumn } from "./entry-design-column";
import type { EntryDesignSection as EntryDesignSectionPart } from "./EntryDesignSection";
import { lazyPart, withEditorStylesheet } from "./lazy-part";
import type { PageBuilderOverview as PageBuilderOverviewPart } from "./overview/PageBuilderOverview";
import { PUBLISHING_ACTIONS } from "./publishing-actions";
import type { RemoveLayoutToolbarSlot as RemoveLayoutToolbarSlotPart } from "./RemoveLayoutAction";
import type { ShownOnSection as ShownOnSectionPart } from "./shown-on/ShownOnSection";
import type { TemplateAddressField as TemplateAddressFieldPart } from "./TemplateAddressField";
import type { TemplateCollectionField as TemplateCollectionFieldPart } from "./TemplateCollectionField";
import type { TemplateDeleteAction as TemplateDeleteActionPart } from "./TemplateDeleteAction";
import type { TemplateDesignDetails as TemplateDesignDetailsPart } from "./TemplateDesignDetails";
import type { TemplateOwnDesigns as TemplateOwnDesignsPart } from "./TemplateOwnDesigns";
import { registerExportActions } from "./transfer-export-action";
import type { TransferImport as TransferImportPart } from "./transfer-import";

/*
 * Every part below is registered now and fetched when a screen first draws
 * it (`lazyPart`), the editor's stylesheet with the parts it styles. The
 * app's generated component map imports this entry with the admin's first
 * load, so anything imported here eagerly is downloaded on every admin
 * screen, the sign-in page included, and an app reaches the stylesheet
 * through this entry alone. What stays eager is the registration: the
 * specifiers, the list column and the row actions.
 */

const BindingsToFixCard: typeof BindingsToFixCardPart = lazyPart(() =>
  import("./bindings-report/BindingsToFixCard").then(m => m.BindingsToFixCard)
);
const BindingsToFixPage: typeof BindingsToFixPagePart = lazyPart(() =>
  import("./bindings-report/BindingsToFixPage").then(m => m.BindingsToFixPage)
);
// Asks about the components and Layout a page needs before it is published,
// so a publish waits for its code, and is refused if that never arrives.
const BlocksField: typeof BlocksFieldPart = lazyPart(
  () => withEditorStylesheet(import("./BlocksField")).then(m => m.BlocksField),
  { holdsActions: PUBLISHING_ACTIONS }
);
const ComponentListTools: typeof ComponentListToolsPart = lazyPart(() =>
  import("./DeleteComponentAction").then(m => m.ComponentListTools)
);
const ComponentStoreDeleteHost: typeof ComponentStoreDeleteHostPart = lazyPart(
  () => import("./DeleteComponentAction").then(m => m.ComponentStoreDeleteHost)
);
const DeleteComponentReplacement: typeof DeleteComponentReplacementPart =
  lazyPart(() =>
    import("./DeleteComponentAction").then(m => m.DeleteComponentReplacement)
  );
const EntryDesignSection: typeof EntryDesignSectionPart = lazyPart(() =>
  import("./EntryDesignSection").then(m => m.EntryDesignSection)
);
const ShownOnSection: typeof ShownOnSectionPart = lazyPart(() =>
  import("./shown-on/ShownOnSection").then(m => m.ShownOnSection)
);
const PageBuilderOverview: typeof PageBuilderOverviewPart = lazyPart(() =>
  import("./overview/PageBuilderOverview").then(m => m.PageBuilderOverview)
);
const PageBuilderView: typeof PageBuilderViewPart = lazyPart(() =>
  withEditorStylesheet(import("./editor/PageBuilderView")).then(
    m => m.PageBuilderView
  )
);
const RemoveLayoutToolbarSlot: typeof RemoveLayoutToolbarSlotPart = lazyPart(
  () => import("./RemoveLayoutAction").then(m => m.RemoveLayoutToolbarSlot)
);
const TemplateAddressField: typeof TemplateAddressFieldPart = lazyPart(() =>
  import("./TemplateAddressField").then(m => m.TemplateAddressField)
);
const TemplateCollectionField: typeof TemplateCollectionFieldPart = lazyPart(
  () => import("./TemplateCollectionField").then(m => m.TemplateCollectionField)
);
const TemplateDeleteAction: typeof TemplateDeleteActionPart = lazyPart(() =>
  import("./TemplateDeleteAction").then(m => m.TemplateDeleteAction)
);
const TemplateDesignDetails: typeof TemplateDesignDetailsPart = lazyPart(() =>
  import("./TemplateDesignDetails").then(m => m.TemplateDesignDetails)
);
const TemplateOwnDesigns: typeof TemplateOwnDesignsPart = lazyPart(() =>
  import("./TemplateOwnDesigns").then(m => m.TemplateOwnDesigns)
);
const TransferImport: typeof TransferImportPart = lazyPart(() =>
  withEditorStylesheet(import("./transfer-import")).then(m => m.TransferImport)
);

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
 * The template form's address control. Must match
 * `TEMPLATE_ADDRESS_FIELD_COMPONENT`, for the reason `BLOCKS_FIELD_PATH`
 * gives.
 */
const TEMPLATE_ADDRESS_FIELD_PATH =
  "@nextlyhq/plugin-page-builder/admin#TemplateAddressField";

/**
 * The template form's collection control. Must match
 * `TEMPLATE_COLLECTION_FIELD_COMPONENT`, for the reason `BLOCKS_FIELD_PATH`
 * gives.
 */
const TEMPLATE_COLLECTION_FIELD_PATH =
  "@nextlyhq/plugin-page-builder/admin#TemplateCollectionField";

const COMPONENTS = {
  [BLOCKS_FIELD_PATH]: BlocksField,
  [TRANSFER_IMPORT_COMPONENT]: TransferImport,
  // The editor itself, drawn by the admin as a view of the document at the
  // address the blocks field's card links to.
  [BUILDER_VIEW_COMPONENT]: PageBuilderView,
  // "Remove Layout…" in a Layout's document bar.
  [REMOVE_LAYOUT_ACTION_COMPONENT]: RemoveLayoutToolbarSlot,
  // The overview the rail item opens.
  [OVERVIEW_PAGE_COMPONENT]: PageBuilderOverview,
  // The "Bindings to fix" page and its dashboard card.
  [BINDINGS_TO_FIX_PAGE_COMPONENT]: BindingsToFixPage,
  [BINDINGS_TO_FIX_CARD_COMPONENT]: BindingsToFixCard,
  // Above the Components list: Import from file, and the row action's
  // Delete component dialog; for a host's component store, the same tools
  // drawn through the header slot.
  [COMPONENT_LIST_TOOLS_COMPONENT]: ComponentListTools,
  [COMPONENT_STORE_DELETE_HOST_COMPONENT]: ComponentStoreDeleteHost,
  // The component store's own Delete, opening Delete component instead.
  [DELETE_COMPONENT_REPLACEMENT_COMPONENT]: DeleteComponentReplacement,
  // An entry's own design: the Design section of every entry's side panel,
  // a template's own designs, and the delete that says what it means.
  [ENTRY_DESIGN_SECTION_COMPONENT]: EntryDesignSection,
  // Where the builder shows a Single's values, in every Single's side panel.
  [SINGLE_SHOWN_ON_SECTION_COMPONENT]: ShownOnSection,
  [TEMPLATE_OWN_DESIGNS_COMPONENT]: TemplateOwnDesigns,
  [TEMPLATE_DESIGN_DETAILS_COMPONENT]: TemplateDesignDetails,
  [TEMPLATE_DELETE_COMPONENT]: TemplateDeleteAction,
  // The template's address, editable under the routing permission.
  [TEMPLATE_ADDRESS_FIELD_PATH]: TemplateAddressField,
  // The template's collection, by its name.
  [TEMPLATE_COLLECTION_FIELD_PATH]: TemplateCollectionField,
};

// Eager registration on module load.
registerComponents(COMPONENTS);
// "Export" on the Components, Patterns and Layouts lists.
registerExportActions();
// "Delete component…" on the component store's list is registered by the
// list's own tools, under the slug the site resolved.

// The Design column on the lists of collections that have a template.
registerEntryDesignColumn();

export {
  BindingsToFixCard,
  BindingsToFixPage,
  BlocksField,
  ComponentListTools,
  ComponentStoreDeleteHost,
  DeleteComponentReplacement,
  EntryDesignSection,
  PageBuilderOverview,
  PageBuilderView,
  RemoveLayoutToolbarSlot,
  ShownOnSection,
  TemplateAddressField,
  TemplateCollectionField,
  TemplateDeleteAction,
  TemplateDesignDetails,
  TemplateOwnDesigns,
  TransferImport,
};
/**
 * Called by the app's generated component map to hand the editor the block
 * modules plugins declared (`editorEntry`, `editor.component`). Not for a
 * plugin to call: the map is what knows every declared path.
 */
export { registerBlockEditorModules } from "./block-editor-modules";
// The card's data, named so an app's generated component map, which holds the
// registered card, can name its props when the app emits declarations.
export type { BindingsToFixCardData } from "./bindings-report/BindingsToFixCard";
export type { BlockEditorModules } from "./block-editor-modules";
export type { BlocksFieldProps } from "./BlocksField";

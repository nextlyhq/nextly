/**
 * What the plugin contributes to the admin: the editor's client config, its
 * pages and panel, the full-screen editor view, the Layout and template
 * screens' actions, the Settings dialog's place, an entry's Design section,
 * a Single's "Shown on (from the builder)" section, Delete component on the
 * component store, and the menu.
 */
import type { PluginAdminContributions } from "@nextlyhq/plugin-sdk";

import {
  BUILDER_VIEW_COMPONENT,
  BUILDER_VIEW_PATH,
  COMPONENT_STORE_DELETE_HOST_COMPONENT,
  ENTRY_DESIGN_SECTION_COMPONENT,
  REMOVE_LAYOUT_ACTION_COMPONENT,
  SINGLE_SHOWN_ON_SECTION_COMPONENT,
  TEMPLATE_DELETE_COMPONENT,
  TEMPLATE_DESIGN_DETAILS_COMPONENT,
  TEMPLATE_OWN_DESIGNS_COMPONENT,
} from "../builder-view";
import { TEMPLATES_SLUG } from "../collections/templates";
import { BLOCKS_TYPE } from "../fields/blocksField";
import {
  PAGE_BUILDER_MENU,
  PAGE_BUILDER_PAGES,
  PAGE_BUILDER_PANEL,
} from "../overview/admin-panel";
import { PAGE_BUILDER_SETTINGS_PLACE } from "../settings-place-contract";
import { SHOWN_ON_TITLE } from "../shown-on-contract";
import { ENTRY_DESIGN_STARTUP_PATH } from "../templates/entry-designs-contract";

import {
  adminClientConfig,
  componentStoreOf,
  deleteComponentViews,
  hostStoreOf,
} from "./options";
import type { Definition } from "./state";

/** The plugin's admin contributions, from its options. */
export function adminContributions(def: Definition): PluginAdminContributions {
  const { opts, configStyle, canvasPath, fonts } = def;
  return {
    // What the editor in the browser needs of the options: see
    // `adminClientConfig`.
    ...adminClientConfig(opts, {
      configStyle,
      canvasPath,
      fontsOff: fonts.off,
    }),
    // The overview the rail item opens, and the "Bindings to fix" page,
    // reached from the panel, its dashboard card and the editor's notice.
    pages: PAGE_BUILDER_PAGES,
    // The panel's headings: the libraries, then the checks.
    panel: PAGE_BUILDER_PANEL,
    // The LIBRARIES and the bindings report, and no link to Pages.
    //
    // Pages is an ordinary collection that happens to declare a `blocks`
    // field — a title, a slug and the document — and the Collections
    // listing already offers it, because it is not hidden and claims no
    // sidebar group. A second entry here was the same screen named twice.
    //
    // It is also a claim the code does not support. The page builder is a
    // FIELD TYPE, so any collection may declare it and a Single may too;
    // nothing in the engine, the builder or this package knows the slug
    // `pages`. A menu promising "the page builder lives here, and it means
    // Pages" gets less true the moment a second collection declares the
    // field, and nothing would ever add that one.
    //
    // So content sits with content, and this menu holds what is genuinely
    // global: the pieces pages are built FROM. An author already switches
    // page from inside the editor, whose left rail carries a Pages panel —
    // which is where that job belongs, since it is done while building
    // rather than while deciding what to build.
    //
    // Each entry names the permission that makes its screen reachable, so
    // a role without it is not offered a link into a list it would be
    // refused, and each names its `collection`, so a host that renames one
    // gets a link to the collection it actually registered and a gate on
    // the permission that slug actually seeds. Spelling either literally
    // would strand the link and hide the item from the readers who can
    // open the list.
    //
    // They are listed in the plugin's own panel, beside its rail item,
    // since the plugin is placed standalone; where the overview lists the
    // collections and Singles that use the field, which is the answer to
    // "where are the pages" that stays true as more of them declare it.
    //
    // The editor is a full-screen view of the document, offered wherever a
    // blocks field is used — including collections the Schema Builder adds
    // later — and opened by the field's card at that address.
    documentViews: [
      {
        path: BUILDER_VIEW_PATH,
        fieldType: BLOCKS_TYPE,
        component: BUILDER_VIEW_COMPONENT,
        label: "Page Builder",
      },
    ],
    // "Remove Layout…" in a Layout's document bar, beside History: the one
    // way an author deletes or unpublishes a Layout, since the form's own
    // delete and unpublish are refused. The slot is offered to every entry
    // form; the component draws only on a saved Layout's own.
    entryFormToolbarSlot: REMOVE_LAYOUT_ACTION_COMPONENT,
    // The editor's Settings dialog, where other plugins may add a tab
    // beside the page's or the design's own settings.
    places: [
      {
        name: PAGE_BUILDER_SETTINGS_PLACE,
        description:
          "A tab in the Page Builder's Settings dialog, beside the page's or the design's own settings.",
        accepts: ["tab"],
      },
    ],
    // An entry's own design, where an author meets it.
    //
    // The Design section of an entry's side panel, first, before Status:
    // which design the entry is shown with, and its own design. Declared
    // at the `collection.edit` place with no collections named, so it is
    // offered on every collection's entries, a collection the Schema
    // Builder adds later included; it draws nothing for an entry whose
    // collection cannot have a template, which leaves no section.
    contributions: [
      {
        id: "nextlyhq-plugin-page-builder.entry-design",
        kind: "sidebarSection",
        place: "collection.edit",
        label: "Design",
        component: ENTRY_DESIGN_SECTION_COMPONENT,
        before: "status",
        // On a phone the panel opens only from the document's menu, so
        // the section sits above the form there, where an author meets
        // which design the entry is shown with before its fields.
        narrow: "above-form",
        // The section's read, started as the edit page opens rather than
        // once the section mounts, so the section is drawn above Status
        // with the editor instead of pushing it down after.
        startupReads: [{ path: ENTRY_DESIGN_STARTUP_PATH }],
      },
      // Where the builder shows a Single's values, on every Single's side
      // panel, among the sections plugins add: after Last changed, before
      // For developers. Offered on every Single, a Single the Schema Builder
      // adds later included.
      {
        id: "nextlyhq-plugin-page-builder.single-shown-on",
        kind: "sidebarSection",
        place: "single.edit",
        label: SHOWN_ON_TITLE,
        component: SINGLE_SHOWN_ON_SECTION_COMPONENT,
      },
    ],
    // Delete component on the component store, wherever it is: the
    // plugin's own collection (followed through a rename, as every view
    // key is), or the host's store named by `componentReadiness`. The
    // document's own Delete opens the Delete component dialog in its
    // place, keeping its row, its permission and every reason it can't
    // run (a past version on screen, a colleague's claim). A host's store
    // also gets the delete tools above its list, for the row action; the
    // plugin's own collection declares them itself.
    //
    // On a template's own document screen: the entries with their own
    // design, in its panel, and a Delete that says what deleting the
    // template, or an own design, does to the site before it happens.
    views: {
      ...deleteComponentViews(componentStoreOf(opts)),
      [TEMPLATES_SLUG]: {
        documentActions: {
          delete: { component: TEMPLATE_DELETE_COMPONENT },
        },
        panelSections: [
          {
            title: "Own designs",
            component: TEMPLATE_OWN_DESIGNS_COMPONENT,
          },
          // On an own design instead: the entry it serves and the
          // template it was copied from, which the form does not draw.
          {
            title: "Own design",
            component: TEMPLATE_DESIGN_DETAILS_COMPONENT,
          },
        ],
      },
    },
    // A host's own store's list gets Delete component on each row through
    // tools drawn in the header, which is on every page: the slot above a
    // list is the host's own to fill, and a second one there would be
    // dropped. Its slug reaches them through `clientConfig`.
    ...(hostStoreOf(componentStoreOf(opts)) === undefined
      ? {}
      : { header: { slot: COMPONENT_STORE_DELETE_HOST_COMPONENT } }),
    // Each library's item with a quiet count of its collection, and
    // "Bindings to fix" with its attention badge: see
    // `overview/admin-panel.ts`.
    menu: PAGE_BUILDER_MENU,
    // No `schemaBuilderSlot`. It named a component this package no longer
    // ships: a schema-builder toggle for turning a collection into a
    // page-builder one, from an editor that stored its own document
    // format. A slot is registered by SPECIFIER, so nothing type-checks
    // the name: pointing at a component that is not exported resolves to
    // nothing at render time. The toolbar slot above names one this entry
    // registers (`admin/index.ts`).
  };
}

/**
 * The services the inspector's Content tab is handed: what it borrows from
 * the admin, with this editor's language, collection, author and entries.
 *
 * @module @nextlyhq/plugin-page-builder/admin/editor/editor-services
 */
import type { InspectorPanel, OpenPassages } from "@nextlyhq/builder/shell";
import {
  loadInlineRichTextEditor,
  MediaPickerDialog,
  type DocumentIdentity,
} from "@nextlyhq/plugin-sdk/admin";
import type { ComponentProps } from "react";

import { bindingFieldsReader, unbindPlanner } from "../binding-fields-client";
import { copyEmbedThumbnail } from "../../embed-thumbnail/client";
import { findEntries } from "../entries-client";
import { findLinkTargets, findLinkTargetsIn } from "../link-targets-client";
import { canvasListReadsIn } from "../list-entries-client";
import {
  listLoopCollections,
  loopCollectionsIn,
} from "../loop-collections-client";
import { canvasNamedQueriesIn } from "../named-queries-client";

import { bindingSourcePath } from "./builder-address";
import type {
  ReadMediaSummary,
  SearchMediaSummaries,
} from "./media-summary-reader";
import { pickerPreviewServices } from "./picker-previews";
import { recentIconsStore } from "./recent-icons-store";

export type ContentServices = NonNullable<
  ComponentProps<typeof InspectorPanel>["contentServices"]
>;

let contentServices: ContentServices | undefined;

/**
 * What the inspector's Content tab borrows from the admin: the media library,
 * to choose an image, the shared rich-text editor, and the page builder's
 * entries route, to find an entry a `relation` prop points at with the
 * author's own access, the pages search, to find a page a link points at
 * the same way, and the loop collections route, to offer a collection loop
 * the collections that author may read. Built on first use and
 * kept for the module's life, so the panel never sees a new object on a
 * render, and loading this module reads nothing from the admin's surface
 * until an editor is drawn.
 */
function borrowedServices(): ContentServices {
  contentServices ??= {
    MediaPicker: MediaPickerDialog,
    loadRichTextEditor: loadInlineRichTextEditor,
    findEntries,
    findLinkTargets,
    listLoopCollections,
    // An Embed's "Use the video's thumbnail", through the copy route.
    copyEmbedThumbnail,
  };
  return contentServices;
}

/**
 * The borrowed services with this editor's open-passage registry, its
 * language, the collection its document is an entry of and the author's
 * recent icons, one object per registry, language, collection and author so
 * the panel sees the same one on every render. A relation search and a link's search read titles in
 * the language being edited.
 */
const servicesByPassages = new WeakMap<
  OpenPassages,
  Map<string, ContentServices>
>();

export function servicesFor(
  passages: OpenPassages,
  locale: string | undefined,
  readMedia: ReadMediaSummary,
  searchMedia: SearchMediaSummaries,
  entryCollection: string | null | undefined,
  userId: string | null,
  /** The entry bindings read, and the document an unbind is planned in. */
  binding: {
    readonly entry: DocumentIdentity | null;
    readonly page: DocumentIdentity | null;
    /** The entry the canvas is drawn as, which the site's zone is read for. */
    readonly canvas: DocumentIdentity | null;
  },
  /** The language the canvas's render formats bound values in. */
  formatLocale: string | undefined
): ContentServices {
  let byLocale = servicesByPassages.get(passages);
  if (byLocale === undefined) {
    byLocale = new Map();
    servicesByPassages.set(passages, byLocale);
  }
  // All three in the key, as JSON so no language, collection and person can
  // collide: the list count below reads as the person signed in, and the
  // recent icons are theirs. The language previews are formatted in too.
  const key = JSON.stringify([
    locale ?? "",
    entryCollection ?? null,
    userId,
    binding.entry,
    binding.page,
    binding.canvas,
    formatLocale ?? null,
  ]);
  const recentIcons = recentIconsStore(userId);
  let services = byLocale.get(key);
  if (services === undefined) {
    services = {
      ...borrowedServices(),
      openPassages: passages,
      readMedia,
      // The library's images by name, for an image binding's Fallback: read
      // as the author, through the admin's own list read.
      searchMedia,
      findEntries: query =>
        findEntries(locale === undefined ? query : { ...query, locale }),
      // The same language for a link's search, so a page is found and named
      // as the author reads it.
      findLinkTargets: findLinkTargetsIn(locale),
      // The fields a list may name, as a save in this language judges them.
      listLoopCollections: loopCollectionsIn(locale, userId),
      // The site's named queries, a list's custom sources, as judged in
      // this language: one read the canvas shares.
      listCustomSources: canvasNamedQueriesIn(locale, userId).sources,
      // The selected list's "N entries match, so M show", taken from the
      // canvas's own read of the list in this language, or its named
      // query's run where that is its source.
      countListEntries: props =>
        props.namedQuery === undefined || props.namedQuery === null
          ? canvasListReadsIn(locale, userId).count(props)
          : canvasNamedQueriesIn(locale, userId).count(props),
      ...(entryCollection === undefined ? {} : { entryCollection }),
      // The fields a binding can read, as this author reads them, kept a
      // short while: the picker opens on every bindable prop.
      listBindingFields: bindingFieldsReader(binding.entry, locale, userId),
      // The picker's previews: the canvas's language, the site's zone, and
      // the values of a list's first entry beside its item's fields.
      ...pickerPreviewServices({
        passages,
        canvas: binding.canvas,
        entryCollection,
        userId,
        formatLocale,
        locale,
      }),
      // An unbind's plan against the document the editor holds, by the same
      // decision as the page actions API's.
      ...withPlanUnbind(unbindPlanner(binding.page, locale)),
      // Where a bound field's source is edited, for the chip's "Open
      // source": the entry the bindings read, a Single, or the settings, in
      // the language the picker previewed it in.
      sourceHref: bound => bindingSourcePath(bound, binding.entry, locale),
      // The icons this author chose last, for the Icon control's Recent row.
      ...(recentIcons === undefined ? {} : { recentIcons }),
    };
    byLocale.set(key, services);
  }
  return services;
}

/** The unbind planner as a service member, absent where none can be planned. */
function withPlanUnbind(
  planUnbind: ContentServices["planUnbind"]
): Pick<ContentServices, "planUnbind"> {
  return planUnbind === undefined ? {} : { planUnbind };
}

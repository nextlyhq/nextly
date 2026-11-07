"use client";

/**
 * The admin's side of an entry's own design: the one read every surface
 * draws from, the template actions it runs, and the words they all say.
 *
 * One read for a collection (`GET /templates/entry-designs`), cached by its
 * path, so the entry's Design section, every cell of the entry list's Design
 * column and the template's own designs share one request where they are
 * on screen together, and a write here asks it again for all of them.
 *
 * The words live here so the entry page, the list, the template and the
 * dialogs call one thing by one name: "own design", and the template by its
 * own title.
 *
 * @module admin/entry-designs-client
 */
import {
  apiErrorMessage,
  navigateTo,
  readPluginRoute,
  usePluginRoute,
  writePluginRoute,
  type PluginRouteRead,
} from "@nextlyhq/plugin-sdk/admin";

import { BUILDER_VIEW_PATH } from "../builder-view";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  entryDesignPath,
  entryDesignsPath,
  entryDesignsPathForTemplate,
  type EntryDesignItem,
  type EntryDesignsResponse,
} from "../templates/entry-designs-contract";
import {
  TEMPLATE_ACTIONS_ROUTE_PATH,
  type TemplateAction,
  type TemplateActionResult,
} from "../templates/template-actions-contract";

export type { EntryDesignItem, EntryDesignsResponse };

/**
 * The own designs of `collection`'s entries, its template and its names.
 * Asked again on every mount: an author gives or removes an own design on
 * one screen and opens the next expecting to see it.
 */
export function useEntryDesigns(
  collection: string | undefined
): PluginRouteRead<EntryDesignsResponse> {
  return usePluginRoute<EntryDesignsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: entryDesignsPath(collection ?? ""),
    enabled: collection !== undefined && collection !== "",
    staleTime: 0,
  });
}

/**
 * One entry's own design, or none, with the same `meta`: answered by the
 * entry's key, so whether it has one never rests on the capped list.
 */
export function useEntryDesign(
  collection: string,
  entryId: string
): PluginRouteRead<EntryDesignsResponse> {
  return usePluginRoute<EntryDesignsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: entryDesignPath(collection, entryId),
    enabled: collection !== "" && entryId !== "",
    staleTime: 0,
  });
}

/**
 * The same read for the collection template `id` is about: the one it
 * draws, or, for an entry's own design, the one whose entry it serves.
 */
export function useTemplateDesigns(
  id: string | undefined
): PluginRouteRead<EntryDesignsResponse> {
  return usePluginRoute<EntryDesignsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: entryDesignsPathForTemplate(id ?? ""),
    enabled: id !== undefined && id !== "",
    staleTime: 0,
  });
}

/** Read the own designs of `collection` once, outside React. */
export function readCollectionDesigns(
  collection: string
): Promise<EntryDesignsResponse | undefined> {
  return readPluginRoute<EntryDesignsResponse>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: entryDesignsPath(collection),
  });
}

/** The template actions route's answer, inside the mutation envelope. */
interface ActionEnvelope {
  readonly message: string;
  readonly item: TemplateActionResult;
}

/** Run one template action as the signed-in author. */
export async function runTemplateAction(
  action: TemplateAction,
  dryRun = false
): Promise<TemplateActionResult | undefined> {
  const answer = await writePluginRoute<ActionEnvelope>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: TEMPLATE_ACTIONS_ROUTE_PATH,
    body: dryRun ? { action, dryRun } : { action },
  });
  return answer?.item;
}

/** A refusal's own words, or `fallback`. */
export function reasonOf(error: unknown, fallback: string): string {
  return error instanceof Error ? apiErrorMessage(error, fallback) : fallback;
}

/** Where a template, or an own design, opens in the builder. */
export function builderHref(templates: string, id: string): string {
  return `/admin/collections/${encodeURIComponent(templates)}/${encodeURIComponent(id)}/${BUILDER_VIEW_PATH}`;
}

/** Where an entry opens. */
export function entryHref(collection: string, id: string): string {
  return `/admin/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
}

/** Open an address inside the admin. */
export function openInAdmin(href: string): void {
  navigateTo(href);
}

/** This entry's own design, if the read lists it. */
export function designOf(
  answer: EntryDesignsResponse | undefined,
  entryId: string
): EntryDesignItem | undefined {
  return answer?.items.find(item => item.entryId === entryId);
}

/**
 * A collection's name inside a sentence: lowercased where it is an ordinary
 * word ("Post" → "post"), kept where it reads as a name or an acronym
 * ("FAQ", "iPhone guide").
 */
export function inSentence(label: string): string {
  const [first, second] = [...label];
  if (first === undefined) return label;
  const ordinary =
    first === first.toUpperCase() &&
    first !== first.toLowerCase() &&
    (second === undefined || second === second.toLowerCase());
  return ordinary ? first.toLowerCase() + label.slice(first.length) : label;
}

/**
 * When an own design was last edited, as its row says it: "today",
 * "yesterday", or the date. `null` when the row does not say.
 */
export function editedWhen(updatedAt: string | null, now: Date): string | null {
  if (updatedAt === null) return null;
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return null;
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(at);
}

/** The words every surface of an own design says, in one place. */
export const OWN_DESIGN_WORDS = {
  pill: "Own design",
  pillUnpublished: "Own design · not published",
  /** What the unpublished pill explains, said as its tooltip and to a reader. */
  unpublishedExplained: (template: string | null): string =>
    template === null
      ? "Not published yet: visitors don't see it"
      : `Not published yet: visitors see the ${template} template`,
  give: (singular: string): string =>
    `Give this ${inSentence(singular)} its own design`,
  giving: "Creating its own design…",
  givenToast: (template: string): string =>
    `Own design created as a copy of ${template}`,
  givenNote:
    "It starts as a copy of the published template. Later changes to the template won't reach it.",
  usesTemplate: (singular: string, template: string): string =>
    `This ${inSentence(singular)} is shown with the ${template} template, like every ${inSentence(singular)} without its own design.`,
  openTemplate: (template: string): string => `Open the ${template} template`,
  edit: "Edit design",
  remove: "Remove own design…",
  unpublishedWarning: (template: string | null): string =>
    template === null
      ? "Visitors don't see this design until you publish it."
      : `Visitors still see the ${template} template until you publish this design.`,
  publishedSays: (singular: string, template: string | null): string =>
    template === null
      ? `Visitors see this ${inSentence(singular)}'s own design.`
      : `Visitors see this ${inSentence(singular)}'s own design. Changes to the ${template} template don't reach it.`,
  goesWithEntry: (singular: string): string =>
    `Deleting this ${inSentence(singular)} deletes its own design too.`,
  noTemplate: "No template",
  noPublishedTemplate: (singular: string, plural: string): string =>
    `${plural} have no published template yet, so this ${inSentence(singular)} isn't shown as a page on the site.`,
  createTemplate: (plural: string): string => `Create a template for ${plural}`,
  creatingTemplate: "Creating the template…",
  removeTitle: (singular: string): string =>
    `Remove this ${inSentence(singular)}'s own design?`,
  removeSays: (
    title: string,
    template: string | null,
    plural: string
  ): string =>
    template === null
      ? `"${title}" won't be shown as a page until ${plural} have a published template. The own design and its history are deleted.`
      : `"${title}" will be shown with the ${template} template again. The own design and its history are deleted.`,
  keep: "Keep it",
  removeConfirm: "Remove own design",
  removing: "Removing…",
  removedToast: (template: string | null): string =>
    template === null
      ? "Own design removed"
      : `Own design removed · shown with ${template} again`,
  loadFailed: "This design couldn't be loaded.",
  retry: "Retry",
  someHave: (count: number, singular: string, plural: string): string =>
    count === 1
      ? `1 ${inSentence(singular)} has its own design`
      : `${String(count)} ${inSentence(plural)} have their own design`,
  /**
   * The count where the read says the list may not be the whole: cut at its
   * bound, or stopped before it looked at every own design.
   */
  someHaveOrMore: (count: number, plural: string): string =>
    count === 0
      ? `Some ${inSentence(plural)} may have their own design`
      : `${String(count)} or more ${inSentence(plural)} have their own design`,
  notAllListed: "More may exist that aren't listed here.",
  noneHave: (singular: string): string =>
    `No ${inSentence(singular)} has its own design.`,
  noneHaveMore: (singular: string): string =>
    `Every ${inSentence(singular)} is shown with this template.`,
  noneHaveUnpublished: (plural: string): string =>
    `This template isn't published, so ${inSentence(plural)} aren't shown as pages until it is.`,
  copiedSays:
    "They were copied from this template and are edited on their own. Changes here don't reach them.",
  rowPublished: (edited: string | null): string =>
    edited === null ? "Published" : `Published · edited ${edited}`,
  rowUnpublished: "Not published · visitors see this template",
  rowUnpublishedNoTemplate: "Not published · not shown as a page",
  open: "Open",
} as const;

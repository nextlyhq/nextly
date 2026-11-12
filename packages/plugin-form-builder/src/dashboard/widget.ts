/**
 * New form submissions: the form-builder plugin's dashboard widget, declared
 * once with `defineWidget` and contributed under `contributes.dashboard`.
 *
 * Offered to a reader of both the forms and the submissions, and shown while
 * at least one form is theirs to read; its card lists the new submissions of
 * those forms, newest first, and stays on the dashboard with "No new
 * submissions" while there are none. Its summary puts the card's own count in
 * the dashboard's header. Core's default dashboard names it by its id
 * (`NEW_SUBMISSIONS_WIDGET_ID`), so a site without this plugin has no such
 * card and no such part.
 *
 * @module dashboard/widget
 */

import {
  defineWidget,
  listEntries,
  MAX_WIDGET_ROWS,
  setting,
  type AnyWidget,
} from "@nextlyhq/plugin-sdk";

import {
  NEW_SUBMISSIONS_WIDGET_ID,
  readNewSubmissions,
  type NewSubmissionsData,
  type SubmissionsCollections,
} from "./new-submissions";

/** The component the card is drawn by, as the admin's component map imports it. */
const CARD_COMPONENT = "@nextlyhq/plugin-form-builder/admin#NewSubmissionsCard";

/** A case for the preview page and the add panel's tile. */
const PREVIEW: NewSubmissionsData = {
  items: [
    {
      id: "preview-1",
      title: "Ana Ruiz",
      form: "Contact",
      excerpt: "Could you send me your price list?",
      at: "2026-01-05T09:30:00.000Z",
      href: "/admin/collections/form-submissions/preview-1",
    },
    {
      id: "preview-2",
      title: "sam@example.com",
      form: "Newsletter",
      at: "2026-01-05T08:10:00.000Z",
      href: "/admin/collections/form-submissions/preview-2",
    },
  ],
  total: 2,
  allHref: "/admin/collections/form-submissions",
  collection: "form-submissions",
};

/**
 * The widget, over the plugin's collections as it declares them and the
 * submissions slug the admin knows them by once installed.
 *
 * `submissionsPath` is read when a card loads rather than when the widget is
 * declared: the plugin learns the slug a site renamed its collection to only
 * at `init`, after this declaration was made. Every link the card draws, its
 * empty state's among them, is made from it, so none names a slug the site
 * renamed away.
 */
export function newSubmissionsWidget(
  declared: SubmissionsCollections,
  submissionsPath: () => string
): AnyWidget {
  return defineWidget({
    id: NEW_SUBMISSIONS_WIDGET_ID,
    title: "New form submissions",
    description: "Form submissions nobody has opened yet, newest first.",
    icon: "Inbox",
    category: "Forms",
    size: { default: { w: 6, h: 3 }, max: { w: 12, h: 8 } },
    // Each must be readable before the card is answered at all.
    access: { collections: [declared.forms, declared.submissions] },
    // Shown while a form is the reader's to read: without one there are no
    // submissions they could ever be shown.
    shows: async ({ services, signal }) =>
      (await services.count(declared.forms, { status: "all", signal })) > 0,
    skeleton: "list",
    // How many submissions the card lists before its "View all": its reader's
    // choice, not its size, as a card is as tall as its content.
    settings: {
      limit: setting.number({
        label: "Number of entries",
        defaultValue: 5,
        min: 1,
        max: MAX_WIDGET_ROWS,
      }),
    },
    load: async ({ services, settings, signal, scope }) =>
      readNewSubmissions(services, declared, {
        // Exactly the rows the card draws: the read counts the rest apart.
        limit: listEntries(settings.limit),
        signal,
        scope,
        submissionsPath: submissionsPath(),
      }),
    view: { component: CARD_COMPONENT },
    // The card draws its own empty state: its link is to the submissions as
    // the site installed them, which a declaration made before `init` cannot
    // name, and which the card's data carries.
    isEmpty: () => false,
    preview: [{ name: "Two new", data: PREVIEW }],
    // The card's own read, asked for no rows, so the header counts exactly
    // what the card lists, a floor ("1,000+") where the card's is one.
    summary: {
      label: "new submissions",
      count: async ({ services, signal, scope }) => {
        const { total, atLeast } = await readNewSubmissions(
          services,
          declared,
          { limit: 0, signal, scope, submissionsPath: submissionsPath() }
        );
        return { count: total, atLeast: atLeast === true };
      },
    },
  });
}

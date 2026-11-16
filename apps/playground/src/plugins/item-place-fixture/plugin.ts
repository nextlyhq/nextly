/**
 * Two fixture plugins that each put their own item in one of the places a
 * plugin may choose, so the browser suite and visual checks can see them:
 *
 * - `release-notes-fixture` keeps a component at the rail's foot, above the
 *   Inbox (`header.place: "rail-foot"`): a quiet icon button that opens the
 *   release notes.
 * - `whats-new-fixture` declares an item in the person's menu, under "Help and
 *   community" (`header.place: "menu"`), whose action opens a short dialog.
 *
 * Loaded only where the browser suite and visual checks run the playground
 * (`NEXTLY_E2E_STYLE_FIXTURE=1`), like the style fixture. Inert: no tables,
 * routes, jobs or hooks.
 */
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { RELEASE_NOTES_BUTTON_PATH, WHATS_NEW_DIALOG_PATH } from "./constants";

export const releaseNotesFixturePlugin = definePlugin({
  name: "release-notes-fixture",
  version: "0.0.0",
  nextly: "*",
  admin: {
    description: "Draws a release notes button at the rail's foot.",
  },
  contributes: {
    admin: {
      header: { slot: RELEASE_NOTES_BUTTON_PATH, place: "rail-foot" },
    },
  },
});

export const whatsNewFixturePlugin = definePlugin({
  name: "whats-new-fixture",
  version: "0.0.0",
  nextly: "*",
  admin: {
    description: "Adds What's new to the person's menu.",
  },
  contributes: {
    admin: {
      header: {
        place: "menu",
        item: {
          label: "What's new",
          icon: "Sparkles",
          action: { open: WHATS_NEW_DIALOG_PATH },
        },
      },
    },
  },
});

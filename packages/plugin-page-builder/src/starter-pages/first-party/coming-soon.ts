/**
 * The Coming soon starter: one message and one field, collecting emails for
 * when the site opens. Finished with nothing to add.
 *
 * @module starter-pages/first-party/coming-soon
 */
import {
  defineStarterPage,
  type StarterPageDefinition,
} from "@nextlyhq/plugin-sdk/blocks";

import { centred, form, heading, section, text } from "./parts";

export const COMING_SOON_STARTER: StarterPageDefinition = defineStarterPage({
  id: "coming-soon",
  label: "Coming soon",
  description:
    "One message about what's coming and one field to leave an email, for a page before launch.",
  blocks: [
    section(
      "coming-soon-main",
      [
        centred("coming-soon-inner", [
          text("coming-soon-eyebrow", "Ledgerline for teams", "eyebrow"),
          heading(
            "coming-soon-title",
            "Shared books are coming this spring.",
            "h1"
          ),
          text(
            "coming-soon-lead",
            "Everyone on your team sees the same numbers, and each person only what they need to.",
            "lead"
          ),
          form(
            "coming-soon-form",
            [{ label: "Email", type: "email" }],
            "Tell me when it's ready",
            "Thanks. We'll write once, when it opens."
          ),
          text(
            "coming-soon-note",
            "One email when it launches. Nothing else.",
            "small"
          ),
        ]),
      ],
      { padding: "roomy" }
    ),
  ],
});

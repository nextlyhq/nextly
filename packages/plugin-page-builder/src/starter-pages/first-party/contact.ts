/**
 * The Contact starter: how to reach the business beside a Form that sends
 * as a Form does anywhere else, then the answers people ask for most.
 *
 * @module starter-pages/first-party/contact
 */
import {
  defineStarterPage,
  type StarterPageDefinition,
} from "@nextlyhq/plugin-sdk/blocks";

import {
  card,
  columns,
  detail,
  form,
  heading,
  questions,
  section,
  stack,
  text,
} from "./parts";

export const CONTACT_STARTER: StarterPageDefinition = defineStarterPage({
  id: "contact",
  label: "Contact",
  description:
    "Email, phone and address beside a form that sends to you, then answers to the questions people ask most.",
  blocks: [
    section("contact-main", [
      columns(
        "contact-main-columns",
        [
          [
            text("contact-eyebrow", "Contact", "eyebrow"),
            heading("contact-title", "Talk to us", "h1"),
            text(
              "contact-lead",
              "Questions about your books or your plan? A bookkeeper reads every message.",
              "lead"
            ),
            stack("contact-details", [
              detail("contact-email", "mail", "hello@ledgerline.example"),
              detail("contact-phone", "phone", "+44 20 7946 0000"),
              detail("contact-address", "map-pin", "12 Mill Lane, Leeds"),
            ]),
            text("contact-reply", "We answer within one working day.", "small"),
          ],
          [
            card("contact-form-card", [
              form(
                "contact-form",
                [
                  { label: "Name", type: "text" },
                  { label: "Email", type: "email" },
                  { label: "Message", type: "textarea" },
                ],
                "Send message",
                "Thanks, we'll reply within a day."
              ),
            ]),
          ],
        ],
        { alignCentre: true }
      ),
    ]),
    section(
      "contact-questions",
      [
        columns("contact-questions-columns", [
          [
            heading("contact-questions-title", "Before you write", "h2"),
            text(
              "contact-questions-lead",
              "The answers people ask for most.",
              "muted"
            ),
          ],
          [
            questions("contact-questions-list", [
              [
                "Do I need an accountant as well?",
                "Most studios don't. If you have one, give them read-only access and they'll see the same books you do.",
              ],
              [
                "Which banks work with it?",
                "Most UK and EU business accounts connect in a minute. Others import a statement each month.",
              ],
              [
                "Can I cancel?",
                "Any time, from Settings. Your books export as a spreadsheet first.",
              ],
            ]),
          ],
        ]),
      ],
      { look: "surface" }
    ),
  ],
});

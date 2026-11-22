/**
 * The Landing starter: what the business does and the one thing to do next.
 * A split opening with an Image to pick, three reasons, how it works in
 * three steps, a customer's words, and a closing call. Each section can be
 * deleted without the rest falling apart.
 *
 * @module starter-pages/first-party/landing
 */
import {
  defineStarterPage,
  type StarterPageDefinition,
} from "@nextlyhq/plugin-sdk/blocks";

import {
  button,
  buttons,
  card,
  centred,
  columns,
  emptyImage,
  heading,
  icon,
  quote,
  section,
  stack,
  text,
} from "./parts";

/** Where the page's calls to action lead until the author changes them. */
const START = "/contact";

/** One of the three reasons. */
function reason(id: string, iconName: string, title: string, words: string) {
  return card(id, [
    icon(`${id}-icon`, iconName),
    heading(`${id}-title`, title, "h3"),
    text(`${id}-text`, words, "muted"),
  ]);
}

/** One of the three steps. */
function step(id: string, number: string, title: string, words: string) {
  return stack(id, [
    text(`${id}-number`, number, "step"),
    heading(`${id}-title`, title, "h3"),
    text(`${id}-text`, words, "muted"),
  ]);
}

export const LANDING_STARTER: StarterPageDefinition = defineStarterPage({
  id: "landing",
  label: "Landing",
  description:
    "What the business does, three reasons to choose it, how it works, a customer's words and a call to act.",
  blocks: [
    section("landing-hero", [
      columns(
        "landing-hero-columns",
        [
          [
            text(
              "landing-hero-eyebrow",
              "Bookkeeping for small studios",
              "eyebrow"
            ),
            heading("landing-hero-title", "Your books, done by Friday.", "h1"),
            text(
              "landing-hero-lead",
              "Ledgerline matches your bank feed to invoices and receipts, flags the few that need a look, and closes the month before you plan the next one.",
              "lead"
            ),
            buttons("landing-hero-actions", [
              button("landing-hero-start", "Start free for 30 days", START),
              button(
                "landing-hero-how",
                "See how it works",
                "#how-it-works",
                "outline"
              ),
            ]),
            text(
              "landing-hero-note",
              "No card needed. Cancel any time.",
              "small"
            ),
          ],
          [emptyImage("landing-hero-image")],
        ],
        { alignCentre: true }
      ),
    ]),
    section(
      "landing-reasons",
      [
        stack("landing-reasons-intro", [
          heading("landing-reasons-title", "Less time in spreadsheets", "h2"),
          text(
            "landing-reasons-lead",
            "Three things it does for you every week.",
            "lead"
          ),
        ]),
        columns("landing-reasons-columns", [
          [
            reason(
              "landing-reason-feeds",
              "landmark",
              "Bank feeds that sort themselves",
              "Each payment lands in the right category, and it learns from the ones you correct."
            ),
          ],
          [
            reason(
              "landing-reason-receipts",
              "mail",
              "Receipts from your inbox",
              "Forward a receipt and it's matched to the payment it belongs to."
            ),
          ],
          [
            reason(
              "landing-reason-close",
              "circle-check",
              "A month-end you can trust",
              "One list of what's left, and a report you can send as it is."
            ),
          ],
        ]),
      ],
      { look: "surface" }
    ),
    section("landing-how", [
      heading("landing-how-title", "How it works", "h2"),
      columns("landing-how-columns", [
        [
          step(
            "landing-step-1",
            "1",
            "Connect your bank",
            "Read-only, in about a minute."
          ),
        ],
        [
          step(
            "landing-step-2",
            "2",
            "Review what it flags",
            "Usually a handful each week."
          ),
        ],
        [
          step(
            "landing-step-3",
            "3",
            "Close the month",
            "Your report is ready to send."
          ),
        ],
      ]),
    ]),
    section(
      "landing-voice",
      [
        centred("landing-voice-inner", [
          quote(
            "landing-voice-quote",
            "We used to lose two evenings a month to receipts. Now it's a coffee on Friday.",
            "Mara Okafor, Okafor Interiors"
          ),
        ]),
      ],
      { padding: "compact" }
    ),
    section(
      "landing-close",
      [
        centred("landing-close-inner", [
          heading("landing-close-title", "Try it on last month's books", "h2"),
          text(
            "landing-close-lead",
            "Connect your bank and see your March closed in an afternoon.",
            "lead"
          ),
          button("landing-close-start", "Start free", START),
        ]),
      ],
      { look: "surface" }
    ),
  ],
});

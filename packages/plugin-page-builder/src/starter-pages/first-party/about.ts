/**
 * The About starter: why the business exists, three facts about it, a
 * founder's words and the team, as names. Built to look finished with no
 * pictures at all; an author adds Images where they have photos.
 *
 * @module starter-pages/first-party/about
 */
import {
  defineStarterPage,
  type StarterPageDefinition,
} from "@nextlyhq/plugin-sdk/blocks";

import {
  button,
  buttons,
  centred,
  columns,
  heading,
  list,
  opening,
  quote,
  section,
  stack,
  text,
} from "./parts";

/** One of the three facts: a figure, and what it counts. */
function fact(id: string, figure: string, words: string) {
  return stack(id, [
    text(`${id}-figure`, figure, "figure"),
    text(`${id}-text`, words, "muted"),
  ]);
}

export const ABOUT_STARTER: StarterPageDefinition = defineStarterPage({
  id: "about",
  label: "About",
  description:
    "Why the business exists, three facts about it, a founder's words and the team, with no photos needed.",
  blocks: [
    section("about-intro", [
      opening("about-intro-inner", [
        text("about-intro-eyebrow", "About us", "eyebrow"),
        heading(
          "about-intro-title",
          "Bookkeeping should take an afternoon, not a weekend.",
          "h1"
        ),
        text(
          "about-intro-lead",
          "That's the whole idea. Here's who we are and how we got here.",
          "lead"
        ),
      ]),
    ]),
    section(
      "about-facts",
      [
        columns("about-facts-columns", [
          [
            fact(
              "about-fact-start",
              "2019",
              "Started in Leeds, by three people doing their own books."
            ),
          ],
          [
            fact(
              "about-fact-team",
              "14",
              "People on the team, half of them bookkeepers."
            ),
          ],
          [
            fact(
              "about-fact-studios",
              "2,300",
              "Studios closing their month with it."
            ),
          ],
        ]),
      ],
      { look: "surface", padding: "compact" }
    ),
    section("about-why", [
      columns("about-why-columns", [
        [heading("about-why-title", "Why we exist", "h2")],
        [
          text(
            "about-why-first",
            "Small studios are good at the work they're hired for. Bookkeeping isn't that work, and it shouldn't eat a weekend every month."
          ),
          text(
            "about-why-second",
            "So Ledgerline does the sorting and matching, and leaves you with the few decisions only you can make.",
            "muted"
          ),
        ],
      ]),
    ]),
    section(
      "about-voice",
      [
        centred("about-voice-inner", [
          quote(
            "about-voice-quote",
            "If it isn't quicker than the spreadsheet, we haven't finished it.",
            "Priya Shah, co-founder"
          ),
        ]),
      ],
      { look: "surface" }
    ),
    section("about-team", [
      columns("about-team-columns", [
        [
          heading("about-team-title", "The team", "h2"),
          text(
            "about-team-lead",
            "Fourteen of us, in Leeds and wherever the coffee's good.",
            "muted"
          ),
        ],
        [
          list(
            "about-team-first",
            [
              "Priya Shah, Co-founder",
              "Tom Ellery, Co-founder",
              "Ana Ruiz, Head of support",
            ],
            "none"
          ),
        ],
        [
          list(
            "about-team-second",
            [
              "Sam Okoro, Engineering",
              "Lena Vogt, Bookkeeping",
              "Joe Marsh, Design",
            ],
            "none"
          ),
        ],
      ]),
    ]),
    section(
      "about-close",
      [
        centred("about-close-inner", [
          heading("about-close-title", "Want to talk?", "h2"),
          buttons("about-close-actions", [
            button("about-close-contact", "Get in touch", "/contact"),
            button("about-close-pricing", "See pricing", "/pricing", "outline"),
          ]),
        ]),
      ],
      { look: "surface", padding: "compact" }
    ),
  ],
});

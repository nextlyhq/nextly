/**
 * The Pricing starter: three plans side by side, the middle one marked as
 * the one most chosen, then the questions people ask before they choose.
 * Each plan is one Card, so a fourth is a copy and paste away.
 *
 * @module starter-pages/first-party/pricing
 */
import {
  defineStarterPage,
  type StarterPageDefinition,
} from "@nextlyhq/plugin-sdk/blocks";

import {
  button,
  card,
  centred,
  columns,
  divider,
  heading,
  list,
  questions,
  section,
  stack,
  text,
} from "./parts";

/** One plan's card. */
function plan(
  id: string,
  words: {
    name: string;
    who: string;
    price: string;
    action: string;
    features: string[];
  },
  options: { marked?: boolean } = {}
) {
  return card(
    id,
    [
      ...(options.marked === true
        ? [text(`${id}-tag`, "Most chosen", "eyebrow")]
        : []),
      heading(`${id}-name`, words.name, "h3"),
      text(`${id}-who`, words.who, "muted"),
      stack(
        `${id}-price`,
        [
          text(`${id}-amount`, words.price, "figure"),
          text(`${id}-period`, "a month", "small"),
        ],
        "space.4"
      ),
      button(
        `${id}-action`,
        words.action,
        "/contact",
        options.marked === true ? "primary" : "outline"
      ),
      divider(`${id}-divider`),
      list(`${id}-features`, words.features),
    ],
    options
  );
}

export const PRICING_STARTER: StarterPageDefinition = defineStarterPage({
  id: "pricing",
  label: "Pricing",
  description:
    "Three plans side by side, the middle one marked as most chosen, then answers to the questions people ask first.",
  blocks: [
    section(
      "pricing-intro",
      [
        centred("pricing-intro-inner", [
          text("pricing-eyebrow", "Pricing", "eyebrow"),
          heading("pricing-title", "One price per studio, no surprises", "h1"),
          text(
            "pricing-lead",
            "Every plan has bank feeds, receipts and support from people who do bookkeeping.",
            "lead"
          ),
        ]),
      ],
      { padding: "compact" }
    ),
    section(
      "pricing-plans",
      [
        columns("pricing-plans-columns", [
          [
            plan("pricing-solo", {
              name: "Solo",
              who: "For one person working alone.",
              price: "£12",
              action: "Start free",
              features: [
                "One bank account",
                "Receipts by email",
                "Monthly report",
              ],
            }),
          ],
          [
            plan(
              "pricing-studio",
              {
                name: "Studio",
                who: "For a small team with shared books.",
                price: "£29",
                action: "Start free",
                features: [
                  "Up to five bank accounts",
                  "Receipts by email and app",
                  "Quarterly VAT ready",
                  "Chat with a bookkeeper",
                ],
              },
              { marked: true }
            ),
          ],
          [
            plan("pricing-agency", {
              name: "Agency",
              who: "For studios with several entities.",
              price: "£59",
              action: "Talk to us",
              features: [
                "Unlimited bank accounts",
                "Several companies",
                "Read-only access for your accountant",
                "A named bookkeeper",
              ],
            }),
          ],
        ]),
      ],
      { padding: "compact" }
    ),
    section(
      "pricing-questions",
      [
        columns("pricing-questions-columns", [
          [heading("pricing-questions-title", "Questions about plans", "h2")],
          [
            questions("pricing-questions-list", [
              [
                "Can I change plan later?",
                "Yes, any time. You pay the new price from the next month.",
              ],
              [
                "Can I cancel?",
                "Any time, from Settings. Your books export as a spreadsheet first.",
              ],
              [
                "Do I need an accountant as well?",
                "Most studios don't. If you have one, give them read-only access and they'll see the same books you do.",
              ],
            ]),
          ],
        ]),
      ],
      { look: "surface" }
    ),
  ],
});

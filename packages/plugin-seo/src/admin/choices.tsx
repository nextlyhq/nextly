/**
 * The two sets of choices first-time setup and the settings both offer: the
 * kind of site, and what AI tools may do. One wording for both places.
 *
 * @module admin/choices
 */
import type { JSX } from "react";

import type { AiCrawlerChoice, SiteKind } from "../settings/contract";

/** Each kind of site, and what choosing it changes. */
export const SITE_KIND_CHOICES: readonly {
  value: SiteKind;
  title: string;
  detail: string;
}[] = [
  {
    value: "company",
    title: "A company or product",
    detail: "Adds your company's name, logo and profiles for Google.",
  },
  {
    value: "blog",
    title: "A blog or publication",
    detail: "Articles get author and date details.",
  },
  {
    value: "shop",
    title: "An online shop",
    detail: "Products get price and stock details.",
  },
  {
    value: "local",
    title: "A local business",
    detail: "Adds your address and opening hours.",
  },
];

/** Each choice of what AI tools may do, and what it means. */
export const AI_CHOICES: readonly {
  value: AiCrawlerChoice;
  title: string;
  detail: string;
}[] = [
  {
    value: "all",
    title: "Allow all AI tools",
    detail:
      "They can read your pages for AI search answers and for training. This is the default.",
  },
  {
    value: "search",
    title: "Allow AI search, not training",
    detail:
      "Tools that answer questions, like ChatGPT search and Perplexity, can read and cite pages. Tools that collect pages to train AI models are asked not to.",
  },
  {
    value: "block",
    title: "Block all AI tools",
    detail:
      "Asks every known AI tool to stay away. Google and Bing search are not affected.",
  },
];

/**
 * What the AI choices are, said once under them, and the one crawler no
 * choice names: OpenAI's ads checker visits only pages the site submitted
 * as ads, so asking it away would only stop OpenAI checking them.
 */
export const AI_CHOICES_NOTE =
  "These are requests. Well-behaved tools follow them; some ignore them. Asking Google not to use your pages for AI training also limits what Gemini can use from them. Google Search itself is not affected. No choice asks OpenAI's ads checker, OAI-AdsBot, to stay away: it visits only pages you submitted as ads in ChatGPT.";

/**
 * A group of choice cards, each a radio button with its explanation: a card
 * bordered in the admin's own colours, the chosen one ringed in the
 * foreground colour, as Import's first step draws its sources.
 */
export function ChoiceCards<T extends string>({
  name,
  label,
  choices,
  value,
  onChange,
  columns = 1,
}: {
  name: string;
  label: string;
  choices: readonly { value: T; title: string; detail: string }[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 1 | 2 | 3;
}): JSX.Element {
  const grid =
    columns === 3
      ? "grid gap-3 sm:grid-cols-3"
      : columns === 2
        ? "grid gap-3 sm:grid-cols-2"
        : "grid gap-3";
  return (
    <div className={grid} role="radiogroup" aria-label={label}>
      {choices.map(choice => (
        // The hover outline in the muted text token, un-faded, so it keeps
        // the 3:1 a control's boundary needs against the card.
        <label
          key={choice.value}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-muted-foreground has-[:checked]:border-foreground has-[:checked]:ring-1 has-[:checked]:ring-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        >
          <input
            type="radio"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-semibold text-foreground">
              {choice.title}
            </span>
            <span className="text-xs leading-normal text-muted-foreground">
              {choice.detail}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

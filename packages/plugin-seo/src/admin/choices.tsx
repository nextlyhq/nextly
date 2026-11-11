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

/** What the AI choices are, said once under them. */
export const AI_CHOICES_NOTE =
  "These are requests. Well-behaved tools follow them; some ignore them. Asking Google not to use your pages for AI training also limits what Gemini can use from them. Google Search itself is not affected.";

/** A group of choice cards, each a radio button with its explanation. */
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
  columns?: 1 | 2;
}): JSX.Element {
  return (
    <div
      className={columns === 2 ? "nx-seo-rgroup two" : "nx-seo-rgroup"}
      role="radiogroup"
      aria-label={label}
    >
      {choices.map(choice => (
        <label key={choice.value} className="nx-seo-radio">
          <input
            type="radio"
            name={name}
            value={choice.value}
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span>
            <b>{choice.title}</b>
            <span>{choice.detail}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

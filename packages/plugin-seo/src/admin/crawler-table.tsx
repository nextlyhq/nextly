/**
 * "See which tools this covers", under the AI tools choice: the crawlers the
 * choice speaks for, by what they read pages for, and what the chosen option
 * asks of each, from the one list robots.txt is written from.
 *
 * @module admin/crawler-table
 */
import { Badge } from "@nextlyhq/plugin-sdk/admin";
import { ChevronRight } from "lucide-react";
import { useId, useState, type JSX } from "react";

import {
  AI_CRAWLERS,
  AI_CRAWLERS_CHECKED,
  type AiCrawlerUse,
} from "../outputs/ai-crawlers";
import type { AiCrawlerChoice } from "../settings/contract";

/** Each use, as the table's row says what its crawlers do. */
const USES: readonly { use: AiCrawlerUse; title: string; detail?: string }[] = [
  { use: "training", title: "Collect pages to train AI models" },
  {
    use: "answers",
    title: "Read pages to answer questions and cite them",
    detail:
      "For an AI search index, or because a person asked about the page. OpenAI says ChatGPT-User may not follow robots.txt, because a person asked for the page.",
  },
  {
    use: "own-request",
    title: "Visit only what the site asked for",
    detail:
      "Such as OpenAI's ads checker, which visits only pages the site itself submitted as ads in ChatGPT, so none of the three choices asks it to stay away.",
  },
];

/** What the chosen option asks of the crawlers of one use. */
function askedOf(
  use: AiCrawlerUse,
  choice: AiCrawlerChoice
): { text: string; away: boolean } {
  if (use === "own-request")
    return { text: "Never asked to stay away", away: false };
  const away =
    choice === "block" || (choice === "search" && use === "training");
  return { text: away ? "Asked to stay away" : "Allowed", away };
}

/** The date the names were last checked, as `13 Nov 2026`. */
function checkedOn(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** The disclosure and, once opened, the table. */
export function CrawlerTable({
  choice,
}: {
  choice: AiCrawlerChoice;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const tableId = useId();
  return (
    <div className="mt-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={tableId}
        className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2 hover:decoration-2"
        onClick={() => setOpen(was => !was)}
      >
        <ChevronRight
          className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        />
        See which tools this covers
      </button>
      {open ? (
        <div
          id={tableId}
          className="mt-3 overflow-x-auto rounded-md border border-border"
        >
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="p-3 font-medium">
                  What they do
                </th>
                <th scope="col" className="p-3 font-medium">
                  Names in robots.txt
                </th>
                <th scope="col" className="p-3 font-medium">
                  With your choice
                </th>
              </tr>
            </thead>
            <tbody>
              {USES.map(row => {
                const asked = askedOf(row.use, choice);
                return (
                  <tr
                    key={row.use}
                    className="border-b border-border align-top last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="p-3 font-semibold text-foreground"
                    >
                      {row.title}
                      {row.detail === undefined ? null : (
                        <span className="mt-1 block font-normal text-muted-foreground">
                          {row.detail}
                        </span>
                      )}
                    </th>
                    <td className="p-3">
                      <span className="flex flex-wrap gap-1">
                        {AI_CRAWLERS.filter(
                          crawler => crawler.use === row.use
                        ).map(crawler => (
                          <code
                            key={crawler.name}
                            className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground"
                          >
                            {crawler.name}
                          </code>
                        ))}
                      </span>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant={
                          asked.away
                            ? "warning"
                            : asked.text === "Allowed"
                              ? "default"
                              : "outline"
                        }
                      >
                        {asked.text}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-border p-3 text-xs text-muted-foreground">
            The list is checked against each company&apos;s own page at every
            release. Last checked {checkedOn(AI_CRAWLERS_CHECKED)}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

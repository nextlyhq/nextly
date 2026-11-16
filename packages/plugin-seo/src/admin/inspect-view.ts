/**
 * What Inspect shows, worked out from what the check answered: each
 * crawler's line in the strip, the notice a fetch that stopped or an address
 * that isn't fetched is told by, the value Nextly holds in each row of the
 * Head table and where it comes from, and what the chosen crawler received
 * there. Pure, so each is tested without the screen.
 *
 * @module admin/inspect-view
 */
import {
  CRAWLER_NAMES,
  FETCH_LIMITS,
  fileOf,
  type CrawlerKey,
  type CrawlerResult,
  type FetchStop,
  type ReceivedAnswer,
  type ReceivedCell,
  type RowKey,
  type StoredValues,
  type ValueOrigin,
} from "../received/contract";
import type { AiCrawlerChoice } from "../settings/contract";

/** A checked answer. */
export type Checked = Extract<ReceivedAnswer, { kind: "checked" }>;

/** How a line reads: its colour follows its tone. */
export type Tone = "good" | "warning" | "danger" | "muted";

/** What robots.txt asks of AI crawlers, as their line ends. */
const AI_CHOICE_TEXT: Readonly<Record<AiCrawlerChoice, string>> = {
  all: "allowed",
  search: "search only",
  block: "blocked",
};

/** The differences in `key`'s column of the table. */
function differencesOf(answer: Checked, key: CrawlerKey): Set<number> {
  const numbers = new Set<number>();
  for (const cells of Object.values(answer.rows)) {
    const cell = cells[key];
    if (cell.kind === "different") numbers.add(cell.difference);
  }
  return numbers;
}

/**
 * One crawler's line in the strip: what stopped its fetch, the status it
 * was answered, how many differences it has that need fixing, or that it
 * matches; the AI crawlers' line ends with what robots.txt asks of them.
 */
export function crawlerLine(
  answer: Checked,
  crawler: CrawlerResult
): { text: string; tone: Tone } {
  const line = ((): { text: string; tone: Tone } => {
    if (crawler.failure !== undefined) {
      return { text: "Couldn't fetch", tone: "danger" };
    }
    if (crawler.status !== undefined && crawler.status >= 400) {
      return { text: `Answered ${crawler.status}`, tone: "danger" };
    }
    if (answer.stored === undefined) return { text: "Fetched", tone: "muted" };
    const expected = new Set(
      answer.differences
        .filter(difference => difference.expected === true)
        .map(difference => difference.number)
    );
    const count = [...differencesOf(answer, crawler.key)].filter(
      number => !expected.has(number)
    ).length;
    return count === 0
      ? { text: "Matches", tone: "good" }
      : {
          text: `${count} ${count === 1 ? "difference" : "differences"}`,
          tone: "warning",
        };
  })();
  return crawler.key === "ai"
    ? { ...line, text: `${line.text} · ${AI_CHOICE_TEXT[answer.aiCrawlers]}` }
    : line;
}

/** The stops that mean Inspect never fetches the address. */
const NOT_FETCHED: ReadonlySet<FetchStop> = new Set([
  "no-site",
  "not-an-address",
  "scheme",
  "credentials",
  "other-site",
  "port",
  "private",
]);

/** The notice a check that fetched nothing is told by. */
export type FetchNotice =
  | {
      kind: "not-fetched";
      /** The reason's lead, said first in bold, where it has one. */
      lead?: string;
      text: string;
      /** Where it is put right, for a site with no production address. */
      settings?: true;
    }
  | { kind: "failed"; text: string };

/** Why an address isn't fetched, in the notice's own words. */
function notFetchedText(
  reason: FetchStop,
  site: string,
  redirected: boolean,
  message: string
): Extract<FetchNotice, { kind: "not-fetched" }> {
  switch (reason) {
    case "other-site":
      return redirected
        ? {
            kind: "not-fetched",
            lead: "Redirects to another site.",
            text: "The page sent us to a different domain, so we stopped there.",
          }
        : {
            kind: "not-fetched",
            text: `It points outside ${site}, so Inspect only shows what Nextly holds for it.`,
          };
    case "private":
      return {
        kind: "not-fetched",
        lead: "Leads to a private network address.",
        text: "For safety, Inspect never fetches addresses inside a private network.",
      };
    case "port":
      return {
        kind: "not-fetched",
        lead: "Uses an unusual port.",
        text: "Only the standard web ports (80 and 443) are fetched.",
      };
    case "credentials":
      return {
        kind: "not-fetched",
        lead: "Contains a username or password.",
        text: "Addresses with login details in them are never fetched.",
      };
    case "no-site":
      return { kind: "not-fetched", text: message, settings: true };
    default:
      return { kind: "not-fetched", text: message };
  }
}

/** What a fetch that ran into a limit, or found no site, says first. */
function failedLead(reason: FetchStop, message: string): string {
  switch (reason) {
    case "too-slow":
      return `It took longer than ${FETCH_LIMITS.timeoutMs / 1000} seconds to answer.`;
    case "too-large":
      return `It is larger than ${FETCH_LIMITS.maxBytes / (1024 * 1024)} MB.`;
    case "too-many-redirects":
      return `It redirected more than ${FETCH_LIMITS.maxRedirects} times.`;
    default:
      return message;
  }
}

/** The limits every fetch is held to, as the notice says them. */
const LIMITS_TEXT: string = `Nextly stops a fetch at ${FETCH_LIMITS.timeoutMs / 1000} seconds, ${FETCH_LIMITS.maxBytes / (1024 * 1024)} MB or ${FETCH_LIMITS.maxRedirects} redirects.`;

/**
 * The notice for a check that fetched nothing: the address refused, or
 * every crawler stopped for the same reason. Nothing where any crawler
 * received a page, whose differences say the rest.
 */
export function fetchNotice(
  answer: ReceivedAnswer,
  host: string
): FetchNotice | undefined {
  if (answer.kind === "refused") {
    return notFetchedText(
      answer.reason,
      answer.site ?? host,
      false,
      answer.message
    );
  }
  const [first, ...others] = answer.crawlers;
  if (first?.reason === undefined) return undefined;
  if (others.some(other => other.reason !== first.reason)) return undefined;
  const site = (() => {
    try {
      return new URL(answer.address).host;
    } catch {
      return host;
    }
  })();
  if (NOT_FETCHED.has(first.reason)) {
    return notFetchedText(
      first.reason,
      site,
      first.redirected,
      first.failure ?? ""
    );
  }
  return {
    kind: "failed",
    text: `${failedLead(first.reason, first.failure ?? "")} ${LIMITS_TEXT} What Nextly holds is still shown below.`,
  };
}

/** What Nextly holds in a row of the Head table, as the table writes it. */
export function heldText(stored: StoredValues, row: RowKey): string {
  switch (row) {
    case "title":
      return stored.title ?? "None";
    case "description":
      return stored.description ?? "None";
    case "canonical":
      return stored.canonical ?? "None";
    case "robots":
      return [
        stored.listed ? "index" : "noindex",
        stored.followed ? "follow" : "nofollow",
      ].join(", ");
    case "image": {
      const image = stored.image;
      if (image === undefined) return "None";
      const size =
        image.width === undefined || image.height === undefined
          ? ""
          : ` · ${image.width} × ${image.height}`;
      return `${fileOf(image.url)}${size}`;
    }
    case "locale":
      return stored.locale ?? "None";
    case "siteName":
      return stored.siteName ?? "None";
  }
}

/** A field's name as a sentence says it: `metaExcerpt` as `meta excerpt`. */
function spoken(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
}

/** Where a value in the Head table comes from, as its last column says. */
export function originText(
  row: RowKey,
  origin: ValueOrigin | undefined
): string {
  if (row === "locale") return "Site language";
  if (row === "siteName") return "Settings";
  if (origin === undefined) return "—";
  switch (origin.level) {
    case "page":
      return "Own value";
    case "code":
      return "The page’s code";
    case "template":
      return "Its design";
    case "pattern":
      return origin.pattern === undefined
        ? "Pattern"
        : `Pattern: ${origin.pattern}`;
    case "content":
      return origin.field === undefined
        ? "Its content"
        : `The page’s ${spoken(origin.field)}`;
    case "site":
      return "Site default";
    case "address":
      return "Address";
    case "type":
      return "Content type";
  }
}

/** What the chosen crawler received in a row, as the table writes it. */
export function receivedText(
  cell: ReceivedCell | undefined,
  key: CrawlerKey
): { text: string; tone: Tone } {
  if (cell === undefined) return { text: "—", tone: "muted" };
  switch (cell.kind) {
    case "same":
      return {
        text: cell.note === undefined ? "Same" : `Same, ${cell.note}`,
        tone: "good",
      };
    case "different":
      return { text: cell.received ?? "None", tone: "warning" };
    case "received":
      return { text: cell.received ?? "None", tone: "muted" };
    case "not-used":
      return { text: `${CRAWLER_NAMES[key]} doesn't read it`, tone: "muted" };
    case "none":
      return { text: "Nothing received", tone: "muted" };
  }
}

/** How long ago `when` was, for "Fetched …". */
export function fetchedAgo(when: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(when)) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}

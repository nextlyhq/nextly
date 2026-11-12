/**
 * What each crawler received, beside what Nextly holds for the page: one
 * cell per value and crawler, and every difference numbered once and said in
 * plain words, with its likely cause.
 *
 * Each crawler reads the values it uses: Google, Bing and the AI crawlers the
 * page's title, description, share image and official address, and Google its
 * robots rules; Facebook, X and LinkedIn the shared card, falling back to the
 * page's own title and description as they do, with its language and the
 * site's name. What Nextly holds is compared with what the page served each
 * one; a value the crawler does not use is said so, not compared. A share
 * image a network doesn't display is a difference even where it was served.
 *
 * @module received/compare
 */
import { imageFormatOf } from "../social/contract";

import {
  CRAWLER_NAMES,
  CRAWLERS,
  fileOf,
  inSentence,
  RECEIVED_ROWS,
  type CrawlerKey,
  type CrawlerResult,
  type ReceivedCell,
  type ReceivedDifference,
  type RowKey,
} from "./contract";
import type { Fetched } from "./fetch";
import { readHead, type ReceivedHead } from "./head";

/** What Nextly holds for the page, every address made absolute. */
export interface StoredHead {
  title?: string;
  description?: string;
  /** The shared card's title: its own, else the page's. */
  cardTitle?: string;
  /** The shared card's description: its own, else the page's. */
  cardDescription?: string;
  image?: { url: string; width?: number; height?: number };
  canonical?: string;
  listed: boolean;
  /** Whether search engines are told to follow the page's links; yes where unsaid. */
  followed?: boolean;
  /** The language the card states, such as `en_US`. */
  locale?: string;
  /** The site's name, as the card states it. */
  siteName?: string;
  /**
   * The values Nextly worked out automatically, from the content type's
   * pattern, the page's content or the site's defaults: a Page Builder
   * design or the page's route may set its own, which wins over them.
   */
  automatic?: {
    title?: boolean;
    description?: boolean;
    image?: boolean;
    /** The card's own title and description, which may be set apart from the page's. */
    cardTitle?: boolean;
    cardDescription?: boolean;
  };
}

/** The comparison of one page, as the screen shows it. */
export interface Comparison {
  crawlers: CrawlerResult[];
  rows: Record<RowKey, Record<CrawlerKey, ReceivedCell>>;
  differences: ReceivedDifference[];
}

/** Where a noindex came from, for Googlebot. */
type NoindexFrom = "header" | "tag";

/** The values one crawler read from the page. */
interface Seen {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  locale?: string;
  siteName?: string;
  /** Where Googlebot was told not to list it, or false where it was not. */
  noindex: NoindexFrom | false;
  /** Whether Googlebot was told not to follow its links. */
  nofollow: boolean;
}

/** Whether `key` reads the page's own title and description, not the card's. */
function readsPage(key: CrawlerKey): boolean {
  return CRAWLERS.some(
    crawler => crawler.key === key && crawler.reads === "page"
  );
}

/** `text` with its runs of white space made one space, and trimmed. */
function tidy(text: string | undefined): string | undefined {
  const tidied = text?.replace(/\s+/g, " ").trim();
  return tidied === "" ? undefined : tidied;
}

/** `address` made absolute against `base`, or as written where it can't be. */
function absolute(
  address: string | undefined,
  base: string
): string | undefined {
  if (address === undefined) return undefined;
  try {
    return new URL(address, base).href;
  } catch {
    return address;
  }
}

/**
 * Whether the `X-Robots-Tag` header tells Googlebot not to index the page:
 * a rule for every crawler, or one named for Googlebot. A rule named for
 * another crawler (`bingbot: noindex`) does not.
 */
function headerNoindex(header: string | undefined): boolean {
  return headerSays(header, NOINDEX);
}

/** The rules that keep a page out of search, and that stop its links being followed. */
const NOINDEX: readonly string[] = ["noindex", "none"];
const NOFOLLOW: readonly string[] = ["nofollow", "none"];

/** Whether the `X-Robots-Tag` header gives Googlebot one of `rules`. */
function headerSays(
  header: string | undefined,
  rules: readonly string[]
): boolean {
  if (header === undefined) return false;
  // Each header, a line of its own, starts out naming no crawler.
  return header.split("\n").some(line => oneHeaderSays(line, rules));
}

/** Whether one robots header gives Googlebot one of `rules`. */
function oneHeaderSays(header: string, rules: readonly string[]): boolean {
  let crawler: string | undefined;
  for (const part of header.toLowerCase().split(",")) {
    const named = /^\s*([a-z0-9_-]+)\s*:\s*(.*)$/.exec(part);
    const known = named?.[1] ?? "";
    // A word before a colon names a crawler, except the rules that take a
    // value of their own (`max-snippet: 20`).
    const isCrawler =
      named !== null && !/^(max-|unavailable_after)/.test(known);
    if (isCrawler) crawler = known;
    const rule = (isCrawler ? named[2] : part)?.trim() ?? "";
    const forGoogle = crawler === undefined || crawler === "googlebot";
    if (forGoogle && rules.includes(rule)) return true;
  }
  return false;
}

/** What `key` reads from the page it received. */
function seenBy(
  key: CrawlerKey,
  head: ReceivedHead,
  headers: Record<string, string>,
  url: string
): Seen {
  const tagNoindex = head.robots.some(
    rule => rule === "noindex" || rule === "none"
  );
  const nofollow =
    headerSays(headers["x-robots-tag"], NOFOLLOW) ||
    head.robots.some(rule => NOFOLLOW.includes(rule));
  const noindex: Seen["noindex"] = headerNoindex(headers["x-robots-tag"])
    ? "header"
    : tagNoindex
      ? "tag"
      : false;
  const canonical = absolute(head.canonical, url);
  if (readsPage(key)) {
    return {
      ...defined("title", head.title),
      ...defined("description", head.description),
      ...defined("image", absolute(head.og.image, url)),
      ...defined("canonical", canonical),
      noindex,
      nofollow,
    };
  }
  const x = key === "x";
  return {
    ...defined(
      "title",
      (x ? head.twitter.title : undefined) ?? head.og.title ?? head.title
    ),
    ...defined(
      "description",
      (x ? head.twitter.description : undefined) ??
        head.og.description ??
        head.description
    ),
    ...defined(
      "image",
      absolute((x ? head.twitter.image : undefined) ?? head.og.image, url)
    ),
    ...defined("canonical", canonical),
    ...defined("locale", head.og.locale),
    ...defined("siteName", head.og.siteName),
    noindex,
    nofollow,
  };
}

/** `value` under `key`, or nothing where it is undefined. */
function defined<K extends string>(
  key: K,
  value: string | undefined
): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

/** How long ago `seconds` was, in the largest whole unit. */
function ago(seconds: number): string {
  const units: [number, string][] = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${unit}${count === 1 ? "" : "s"}`;
    }
  }
  return "moments";
}

/**
 * How old the copy a host's cache served was, in seconds, where it served a
 * saved copy: `true` where it says so without saying how old.
 */
function cachedCopy(
  headers: Record<string, string>
): number | true | undefined {
  const age = Number(headers.age);
  if (Number.isFinite(age) && age > 0) return age;
  const hit = ["x-vercel-cache", "cf-cache-status", "x-nextjs-cache", "x-cache"]
    .map(name => headers[name]?.toUpperCase() ?? "")
    .some(value => value.includes("HIT") || value.includes("STALE"));
  return hit ? true : undefined;
}

/** What a row's value is shown as, for one crawler or for Nextly. */
function shown(row: RowKey, value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return row === "image" ? fileOf(value) : value;
}

/** A group of crawlers that received the same thing different from Nextly. */
interface Group {
  number: number;
  keys: CrawlerKey[];
  row: RowKey | "fetch" | "imageFormat";
  received?: string;
  /** Each crawler's answer headers, for whether a saved copy was served. */
  headers: Record<string, string>[];
  /** For a fetch that went wrong: what it was answered, or its own words. */
  status?: number;
  failure?: string;
  noindex?: NoindexFrom;
  /** For links told differently alone: whether Googlebot was told not to follow them. */
  nofollow?: boolean;
}

const NAME = CRAWLER_NAMES;

/** What a status says about why the crawler saw none of the page. */
function statusText(status: number, names: string): string {
  if (status === 401 || status === 403 || status === 429) {
    return `The site, or a firewall in front of it, turned the crawler away, so it saw none of the page's values. Let ${names} through in the firewall or bot protection.`;
  }
  if (status === 404 || status === 410) {
    return "The site has no page at this address. Check the address, and that the page is published.";
  }
  if (status >= 500) {
    return "The site failed while serving the page. Try again; if it happens again, the site's logs for this address say why.";
  }
  return "The crawler saw none of the page's values.";
}

/** Why a value differs, where a host's saved copy explains it. */
function cachedText(group: Group): string | undefined {
  const ages = group.headers.map(cachedCopy).filter(age => age !== undefined);
  if (ages.length === 0) return undefined;
  const oldest = ages.reduce<number | true>(
    (most, age) =>
      typeof most === "number" && typeof age === "number"
        ? Math.max(most, age)
        : typeof most === "number"
          ? most
          : age,
    true
  );
  const saved =
    oldest === true
      ? "a copy it had saved"
      : `a copy it saved ${ago(oldest)} ago`;
  return `The host served ${saved}, before the last change. It's replaced when that copy expires or the page is published again.`;
}

/** The words of a difference in a text value, the title or description. */
/** Why an automatic value may rightly differ: something above it set its own. */
function setAbove(what: string): string {
  return `A Page Builder design or the page's route can set the ${what}, and theirs wins over the automatic one, so this is expected where the page sets its own.`;
}

function textDifference(
  group: Group,
  stored: string | undefined,
  names: string,
  what: "title" | "description",
  automatic: boolean
): Said {
  const cached = cachedText(group);
  // A saved copy the host served is replaced in its own time: nothing to fix.
  const expected = cached === undefined ? {} : { expected: true as const };
  if (group.received === undefined) {
    return {
      title: `${names} received no ${what}.`,
      text: `Nextly holds “${stored ?? ""}”, but the page's head has none. ${cached ?? "The page's route may not build its head from Nextly."}`,
      ...expected,
    };
  }
  if (stored === undefined) {
    return {
      title: `${names} received a ${what} Nextly doesn't hold.`,
      text: `The page served “${group.received}”. ${cached ?? "It comes from the page's route, its Page Builder design or the site's layout, not from Nextly."}`,
      ...expected,
    };
  }
  if (automatic && cached === undefined) {
    return {
      title: `${names} received a different ${what}.`,
      text: `Nextly's automatic ${what} is “${stored}”; the page served “${group.received}”. ${setAbove(what)}`,
      expected: true,
    };
  }
  return {
    ...expected,
    title: `${names} received a different ${what}.`,
    text: `Nextly holds “${stored}”; the page served “${group.received}”. ${
      cached ??
      (what === "title"
        ? "The page's route sets its own, or a title template in the site's layout changes it."
        : "The page's route sets its own.")
    }`,
  };
}

/** A difference's heading and its explanation, and whether it is expected. */
interface Said {
  title: string;
  text: string;
  expected?: true | undefined;
}

/** The words of a crawler's fetch that went wrong. */
function fetchSaid(group: Group, names: string): Said {
  if (group.failure !== undefined) {
    return { title: `${names} received nothing.`, text: group.failure };
  }
  const status = group.status ?? 0;
  const verb = group.keys.length === 1 ? "was" : "were";
  return {
    title: `${names} ${verb} answered ${status}.`,
    text: statusText(status, names),
  };
}

/** The words of a different title or description. */
function cardTextSaid(
  group: Group,
  stored: StoredHead | undefined,
  names: string,
  row: "title" | "description"
): Said {
  const card = row === "title" ? stored?.cardTitle : stored?.cardDescription;
  const page = group.keys.some(readsPage);
  const own = page ? stored?.[row] : card;
  // Whether the value compared was worked out automatically: the card's own
  // where the card is compared, since it can be set apart from the page's.
  const cardRow = row === "title" ? "cardTitle" : "cardDescription";
  const automatic = page
    ? stored?.automatic?.[row]
    : (stored?.automatic?.[cardRow] ?? stored?.automatic?.[row]);
  return textDifference(group, own, names, row, automatic === true);
}

/** The words of a different share image. */
function imageSaid(
  group: Group,
  stored: StoredHead | undefined,
  names: string
): Said {
  const own = stored?.image === undefined ? "none" : fileOf(stored.image.url);
  const cached = cachedText(group);
  if (group.received === undefined) {
    return {
      title: `${names} received no share image.`,
      text: `Nextly holds ${own}, but the page's head names none. ${cached ?? "The page's route may not build its head from Nextly."}`,
    };
  }
  const automatic = stored?.automatic?.image === true;
  const expected =
    cached !== undefined || automatic ? { expected: true as const } : {};
  const why =
    cached ??
    (automatic
      ? setAbove("share image")
      : "An image file named opengraph-image or twitter-image beside the page's route replaces the one Nextly holds.");
  return {
    ...expected,
    title: `${names} received a different share image.`,
    text: `${automatic && cached === undefined ? `Nextly's automatic share image is ${own}` : `Nextly holds ${own}`}; the page served ${group.received}. ${why}`,
  };
}

/** The words of a different official address. */
function canonicalSaid(
  group: Group,
  stored: StoredHead | undefined,
  names: string
): Said {
  const own = stored?.canonical ?? "none";
  if (group.received === undefined) {
    return {
      title: `${names} received no official address.`,
      text: `Nextly holds ${own}, but the page's head names none, so search engines choose for themselves which address to credit.`,
    };
  }
  return {
    title: `${names} received another official address.`,
    text: `Nextly holds ${own}; the page named ${group.received}. Search engines may credit ${group.received} instead of this page.`,
  };
}

/** The words of a search listing Googlebot was told differently. */
function robotsSaid(group: Group): Said {
  if (group.nofollow !== undefined) {
    return group.nofollow
      ? {
          title: "Googlebot was told not to follow this page's links.",
          text: "Nextly lets its links be followed, but the page said nofollow. The page's route, the site's layout or the X-Robots-Tag header sets it.",
        }
      : {
          title: "Googlebot wasn't told to leave this page's links unfollowed.",
          text: "Nextly says nofollow, but the page's head doesn't. The page's route may not build its head from Nextly.",
        };
  }
  if (group.noindex === undefined) {
    return {
      title: "Googlebot wasn't told to keep this page out of search.",
      text: "Nextly hides it, but the page's head has no noindex, so Google may list it. The page's route may not build its head from Nextly.",
    };
  }
  return {
    title: "Googlebot was told not to list this page.",
    text:
      group.noindex === "header"
        ? "Nextly lists it, but the X-Robots-Tag header said noindex. The site's host or a proxy in front of it adds that header; remove it for this address."
        : "Nextly lists it, but the page's robots tag said noindex. The page's route or the site's layout sets that tag.",
  };
}

/** The words of one group's difference, by what differs. */
function saidOf(
  group: Group,
  stored: StoredHead | undefined,
  names: string
): Said {
  switch (group.row) {
    case "fetch":
      return fetchSaid(group, names);
    case "title":
    case "description":
      return cardTextSaid(group, stored, names, group.row);
    case "image":
      return imageSaid(group, stored, names);
    case "canonical":
      return canonicalSaid(group, stored, names);
    case "robots":
      return robotsSaid(group);
    case "locale":
      return cardFactSaid(group, stored?.locale, names, "language");
    case "siteName":
      return cardFactSaid(group, stored?.siteName, names, "site name");
    case "imageFormat":
      return imageFormatSaid(group, names);
  }
}

/** The words of a card's language or site name another than Nextly's. */
function cardFactSaid(
  group: Group,
  own: string | undefined,
  names: string,
  what: "language" | "site name"
): Said {
  if (group.received === undefined) {
    return {
      title: `${names} received no ${what}.`,
      text: `Nextly holds ${own ?? "none"}, but the page's head states none. The page's route may not build its head from Nextly.`,
    };
  }
  return {
    title: `${names} received another ${what}.`,
    text: `Nextly holds ${own ?? "none"}; the page stated ${group.received}. The page's route or the site's layout sets its own.`,
  };
}

/** The words of a share image the networks named don't display. */
function imageFormatSaid(group: Group, names: string): Said {
  const format = group.received ?? "";
  const one = group.keys.length === 1;
  return {
    title: `${names} ${one ? "shows" : "show"} no picture for this page.`,
    // Said letter by letter, as a file type is: "an SVG", "an AVIF".
    text: `Its share image is ${/^[AEFHILMNORSX]/.test(format) ? "an" : "a"} ${format}, which ${one ? "it doesn't" : "they don't"} display, so the card appears with text only.`,
  };
}

/**
 * The networks that don't display a share image of each file type: an SVG
 * on no network's card, an AVIF not on X's.
 */
const NOT_DISPLAYED: Readonly<Record<string, readonly CrawlerKey[]>> = {
  svg: ["facebook", "x", "linkedin"],
  avif: ["x"],
};

/** The file type of `url` where `key` doesn't display it on a card. */
function notDisplayed(url: string, key: CrawlerKey): string | undefined {
  const format = imageFormatOf(url);
  if (format === undefined) return undefined;
  return NOT_DISPLAYED[format]?.includes(key) === true
    ? format.toUpperCase()
    : undefined;
}

/** The rows a shared card shows, where LinkedIn's kept card matters. */
const CARD_ROWS: ReadonlySet<Group["row"]> = new Set([
  "title",
  "description",
  "image",
]);

/** The words of one difference, and the action that helps where one does. */
function explained(
  group: Group,
  stored: StoredHead | undefined,
  input: { address: string; editHref?: string | undefined }
): ReceivedDifference {
  const { address, editHref } = input;
  const names = inSentence(group.keys.map(key => NAME[key]));
  const said = saidOf(group, stored, names);
  if (group.row === "imageFormat" && editHref !== undefined) {
    return {
      number: group.number,
      ...said,
      action: { label: "Make a share image", href: editHref },
    };
  }
  if (!CARD_ROWS.has(group.row) || !group.keys.includes("linkedin")) {
    return { number: group.number, ...said };
  }
  return {
    number: group.number,
    ...(said.expected === true ? { expected: true } : {}),
    title: said.title,
    text: `${said.text} Once it's fixed, LinkedIn keeps its old card for about a week; its Post Inspector refreshes it.`,
    action: {
      label: "Open LinkedIn Post Inspector",
      href: `https://www.linkedin.com/post-inspector/inspect/${encodeURIComponent(address)}`,
    },
  };
}

/** What Nextly holds for `row`, as `key` should have received it. */
function expectedOf(
  row: Exclude<RowKey, "robots">,
  key: CrawlerKey,
  stored: StoredHead
): string | undefined {
  switch (row) {
    case "title":
      return tidy(readsPage(key) ? stored.title : stored.cardTitle);
    case "description":
      return tidy(readsPage(key) ? stored.description : stored.cardDescription);
    case "image":
      return stored.image?.url;
    case "canonical":
      return stored.canonical;
    case "locale":
      return stored.locale;
    case "siteName":
      return tidy(stored.siteName);
  }
}

/** How a crawler that shows the card shows the value, where it is the same. */
function sameNote(
  row: RowKey,
  key: CrawlerKey,
  stored: StoredHead
): string | undefined {
  if (readsPage(key) || (row !== "title" && row !== "description")) {
    return undefined;
  }
  if (key === "x") return "X doesn't display it";
  const page = tidy(row === "title" ? stored.title : stored.description);
  const card = tidy(
    row === "title" ? stored.cardTitle : stored.cardDescription
  );
  if (page === undefined || card === undefined || page === card)
    return undefined;
  if (page.startsWith(card))
    return `without “${page.slice(card.length).trim()}”`;
  return `as “${card}”`;
}

/** Each crawler's reading of the page, where it received one to read. */
interface Reading {
  key: CrawlerKey;
  fetched: Fetched;
  seen?: Seen;
  headers: Record<string, string>;
}

/** The groups of crawlers whose fetch went wrong, numbered from `next`. */
function fetchGroups(
  readings: readonly Reading[],
  groups: Map<string, Group>
): void {
  for (const reading of readings) {
    const { fetched, key } = reading;
    if (fetched.kind === "received" && fetched.status < 400) continue;
    const id =
      fetched.kind === "failed"
        ? `fetch|${fetched.message}`
        : `fetch|${fetched.status}`;
    const group = groups.get(id) ?? {
      number: groups.size + 1,
      keys: [],
      row: "fetch" as const,
      headers: [],
      ...(fetched.kind === "failed"
        ? { failure: fetched.message }
        : { status: fetched.status }),
    };
    group.keys.push(key);
    groups.set(id, group);
  }
}

/** The robots rules a crawler was given, as the Head table writes them. */
function robotsText(seen: Pick<Seen, "noindex" | "nofollow">): string {
  return `${seen.noindex === false ? "index" : "noindex"}, ${seen.nofollow ? "nofollow" : "follow"}`;
}

/** A cell that differs, numbered by the group it falls in. */
function different(group: Group, received: string | undefined): ReceivedCell {
  return received === undefined
    ? { kind: "different", difference: group.number }
    : { kind: "different", difference: group.number, received };
}

/** Googlebot's search listing, beside whether Nextly lists the page. */
function robotsCell(
  seen: Seen,
  stored: StoredHead,
  reading: Reading,
  groups: Map<string, Group>
): ReceivedCell {
  const listedSame = (seen.noindex === false) === stored.listed;
  const followSame = !seen.nofollow === (stored.followed !== false);
  if (listedSame && followSame) return { kind: "same" };
  const received = robotsText(seen);
  // A listing told differently is said first; links alone after it.
  const extra = !listedSame
    ? seen.noindex === false
      ? {}
      : { noindex: seen.noindex }
    : { nofollow: seen.nofollow };
  return different(
    groupFor(groups, "robots", received, reading, extra),
    received
  );
}

/** A value, beside what Nextly holds for it as this crawler reads it. */
function valueCell(
  row: Exclude<RowKey, "robots">,
  seen: Seen,
  stored: StoredHead,
  reading: Reading,
  groups: Map<string, Group>
): ReceivedCell {
  const expected = expectedOf(row, reading.key, stored);
  const got =
    row === "image" || row === "canonical" ? seen[row] : tidy(seen[row]);
  // A picture a network doesn't display shows on no card, whether it is the
  // one Nextly holds or one the route served instead.
  const format =
    row === "image" && got !== undefined
      ? notDisplayed(got, reading.key)
      : undefined;
  if (format !== undefined) {
    // Served as Nextly holds it, and still not on the card.
    return different(
      groupFor(groups, "imageFormat", format, reading, {}),
      `No picture shown: ${NAME[reading.key]} doesn't display ${format}`
    );
  }
  if (got === expected) {
    const note = sameNote(row, reading.key, stored);
    return note === undefined ? { kind: "same" } : { kind: "same", note };
  }
  const value = shown(row, got);
  return different(
    groupFor(
      groups,
      row,
      value,
      reading,
      {},
      basisOf(row, reading.key, stored)
    ),
    value
  );
}

/**
 * What a crawler's title or description is judged against: the value it
 * should have received and whether that was worked out, the page's for a
 * crawler reading the page and the card's for one reading the card. The
 * same for every crawler where the two agree.
 */
function basisOf(row: RowKey, key: CrawlerKey, stored: StoredHead): string {
  if (row !== "title" && row !== "description") return "";
  const cardRow = row === "title" ? "cardTitle" : "cardDescription";
  const page = readsPage(key);
  const automatic = page
    ? stored.automatic?.[row]
    : (stored.automatic?.[cardRow] ?? stored.automatic?.[row]);
  return JSON.stringify([expectedOf(row, key, stored), automatic === true]);
}

/** One crawler's cell for a row, grouping the difference where there is one. */
function cellFor(
  row: RowKey,
  reading: Reading,
  stored: StoredHead | undefined,
  groups: Map<string, Group>
): ReceivedCell {
  const { key, seen } = reading;
  if (row === "robots" && key !== "googlebot") return { kind: "not-used" };
  // The card's language and the site's name are the card's alone.
  if ((row === "locale" || row === "siteName") && readsPage(key)) {
    return { kind: "not-used" };
  }
  if (seen === undefined) return { kind: "none" };
  if (stored === undefined) {
    const value = row === "robots" ? robotsText(seen) : shown(row, seen[row]);
    return value === undefined
      ? { kind: "received" }
      : { kind: "received", received: value };
  }
  return row === "robots"
    ? robotsCell(seen, stored, reading, groups)
    : valueCell(row, seen, stored, reading, groups);
}

/** The group of crawlers that received `received` for `row`, made where new. */
function groupFor(
  groups: Map<string, Group>,
  row: Group["row"],
  received: string | undefined,
  reading: Reading,
  extra: Pick<Group, "noindex" | "nofollow">,
  basis = ""
): Group {
  // Crawlers judged against different values, or values of different
  // origins, are kept apart though they received the same thing.
  const id = `${row}|${basis}|${received ?? ""}|${received === undefined ? "none" : "some"}`;
  const group = groups.get(id) ?? {
    number: groups.size + 1,
    keys: [],
    row,
    headers: [],
    ...(received === undefined ? {} : { received }),
    ...extra,
  };
  group.keys.push(reading.key);
  group.headers.push(reading.headers);
  groups.set(id, group);
  return group;
}

/**
 * What each crawler received, compared with `stored`, what Nextly holds for
 * the page at `address`: nothing is compared where it holds no page there.
 */
export function compareReceived(input: {
  address: string;
  /** Where the page's SEO is edited, for a difference fixed there. */
  editHref?: string;
  stored?: StoredHead;
  fetched: Record<CrawlerKey, Fetched>;
}): Comparison {
  const readings: Reading[] = CRAWLERS.map(({ key }) => {
    const fetched = input.fetched[key];
    if (fetched.kind !== "received" || fetched.status >= 400) {
      return { key, fetched, headers: {} };
    }
    const head = readHead(fetched.html);
    return {
      key,
      fetched,
      headers: fetched.headers,
      seen: seenBy(key, head, fetched.headers, fetched.url),
    };
  });
  const groups = new Map<string, Group>();
  fetchGroups(readings, groups);
  const rows = Object.fromEntries(
    RECEIVED_ROWS.map(({ key: row }) => [
      row,
      Object.fromEntries(
        readings.map(reading => [
          reading.key,
          cellFor(row, reading, input.stored, groups),
        ])
      ),
    ])
  ) as Comparison["rows"];
  const fetchNumber = new Map<CrawlerKey, number>();
  for (const group of groups.values()) {
    if (group.row !== "fetch") continue;
    for (const key of group.keys) fetchNumber.set(key, group.number);
  }
  const crawlers: CrawlerResult[] = readings.map(({ key, fetched }) => {
    const number = fetchNumber.get(key);
    return {
      key,
      name: NAME[key],
      ...(fetched.kind === "received" ? { status: fetched.status } : {}),
      ms: fetched.ms,
      redirected: fetched.redirects.length > 0,
      ...(fetched.kind === "failed"
        ? { failure: fetched.message, reason: fetched.reason }
        : {}),
      ...(number === undefined ? {} : { difference: number }),
    };
  });
  return {
    crawlers,
    rows,
    differences: [...groups.values()].map(group =>
      explained(group, input.stored, input)
    ),
  };
}

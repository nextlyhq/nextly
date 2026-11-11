/**
 * What each crawler received, beside what Nextly holds for the page: one
 * cell per value and crawler, and every difference numbered once and said in
 * plain words, with its likely cause.
 *
 * Each crawler reads the values it uses: Googlebot the page's title,
 * description, share image, official address and robots rules; LinkedIn,
 * X and Slack the shared card, falling back to the page's own title and
 * description as they do. What Nextly holds is compared with what the page
 * served each one; a value the crawler does not use is said so, not compared.
 *
 * @module received/compare
 */
import {
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
  /** Where Googlebot was told not to list it, or false where it was not. */
  noindex: NoindexFrom | false;
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
  if (header === undefined) return false;
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
    if (forGoogle && (rule === "noindex" || rule === "none")) return true;
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
  const noindex: Seen["noindex"] = headerNoindex(headers["x-robots-tag"])
    ? "header"
    : tagNoindex
      ? "tag"
      : false;
  const canonical = absolute(head.canonical, url);
  if (key === "googlebot") {
    return {
      ...defined("title", head.title),
      ...defined("description", head.description),
      ...defined("image", absolute(head.og.image, url)),
      ...defined("canonical", canonical),
      noindex,
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
    noindex,
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
  row: RowKey | "fetch";
  received?: string;
  /** Each crawler's answer headers, for whether a saved copy was served. */
  headers: Record<string, string>[];
  /** For a fetch that went wrong: what it was answered, or its own words. */
  status?: number;
  failure?: string;
  noindex?: NoindexFrom;
}

const NAME: Record<CrawlerKey, string> = Object.fromEntries(
  CRAWLERS.map(crawler => [crawler.key, crawler.name])
) as Record<CrawlerKey, string>;

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
function textDifference(
  group: Group,
  stored: string | undefined,
  names: string,
  what: "title" | "description"
): { title: string; text: string } {
  const cached = cachedText(group);
  if (group.received === undefined) {
    return {
      title: `${names} received no ${what}.`,
      text: `Nextly holds “${stored ?? ""}”, but the page's head has none. ${cached ?? "The page's route may not build its head from Nextly."}`,
    };
  }
  if (stored === undefined) {
    return {
      title: `${names} received a ${what} Nextly doesn't hold.`,
      text: `The page served “${group.received}”. ${cached ?? "It comes from the page's route or the site's layout, not from Nextly."}`,
    };
  }
  return {
    title: `${names} received a different ${what}.`,
    text: `Nextly holds “${stored}”; the page served “${group.received}”. ${
      cached ??
      (what === "title"
        ? "The page's route sets its own, or a title template in the site's layout changes it."
        : "The page's route sets its own.")
    }`,
  };
}

/** A difference's heading and its explanation. */
interface Said {
  title: string;
  text: string;
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
  const own = group.keys.includes("googlebot") ? stored?.[row] : card;
  return textDifference(group, own, names, row);
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
  return {
    title: `${names} received a different share image.`,
    text: `Nextly holds ${own}; the page served ${group.received}. ${cached ?? "An image file named opengraph-image or twitter-image beside the page's route replaces the one Nextly holds."}`,
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
  }
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
  address: string
): ReceivedDifference {
  const names = inSentence(group.keys.map(key => NAME[key]));
  const said = saidOf(group, stored, names);
  if (!CARD_ROWS.has(group.row) || !group.keys.includes("linkedin")) {
    return { number: group.number, ...said };
  }
  return {
    number: group.number,
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
      return tidy(key === "googlebot" ? stored.title : stored.cardTitle);
    case "description":
      return tidy(
        key === "googlebot" ? stored.description : stored.cardDescription
      );
    case "image":
      return stored.image?.url;
    case "canonical":
      return stored.canonical;
  }
}

/** How a crawler that shows the card shows the value, where it is the same. */
function sameNote(
  row: RowKey,
  key: CrawlerKey,
  stored: StoredHead
): string | undefined {
  if (key === "googlebot" || (row !== "title" && row !== "description")) {
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

/** How a search listing is said. */
function listedText(noindex: Seen["noindex"]): string {
  return noindex === false ? "Listed in search" : "Hidden from search";
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
  if ((seen.noindex === false) === stored.listed) return { kind: "same" };
  const received = listedText(seen.noindex);
  const extra = seen.noindex === false ? {} : { noindex: seen.noindex };
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
  if (got === expected) {
    const note = sameNote(row, reading.key, stored);
    return note === undefined ? { kind: "same" } : { kind: "same", note };
  }
  const value = shown(row, got);
  return different(groupFor(groups, row, value, reading, {}), value);
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
  if (seen === undefined) return { kind: "none" };
  if (stored === undefined) {
    const value =
      row === "robots" ? listedText(seen.noindex) : shown(row, seen[row]);
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
  row: RowKey,
  received: string | undefined,
  reading: Reading,
  extra: Pick<Group, "noindex">
): Group {
  const id = `${row}|${received ?? ""}|${received === undefined ? "none" : "some"}`;
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
      ...(fetched.kind === "failed" ? { failure: fetched.message } : {}),
      ...(number === undefined ? {} : { difference: number }),
    };
  });
  return {
    crawlers,
    rows,
    differences: [...groups.values()].map(group =>
      explained(group, input.stored, input.address)
    ),
  };
}

/**
 * The W3C Feed Validation Service's rules for RSS 2.0 that a feed of this
 * plugin can break, each named by the message the validator gives for it
 * (https://validator.w3.org/feed/docs/), checked over the feed as an XML
 * parser reads it: jsdom's, which refuses XML that is not well formed, as
 * the validator does.
 *
 * A test helper only: it returns every rule broken, so a test asserting none
 * can say which.
 */

const ATOM = "http://www.w3.org/2005/Atom";
const DC = "http://purl.org/dc/elements/1.1/";

/** The elements RSS 2.0 defines in a channel and in an item (`UndefinedElement`). */
const CHANNEL_ELEMENTS = new Set([
  "title",
  "link",
  "description",
  "language",
  "copyright",
  "managingEditor",
  "webMaster",
  "pubDate",
  "lastBuildDate",
  "category",
  "generator",
  "docs",
  "cloud",
  "ttl",
  "image",
  "rating",
  "textInput",
  "skipHours",
  "skipDays",
  "item",
]);
const ITEM_ELEMENTS = new Set([
  "title",
  "link",
  "description",
  "author",
  "category",
  "comments",
  "enclosure",
  "guid",
  "pubDate",
  "source",
]);

/** RFC 822's date, as RSS 2.0 takes it (`InvalidRFC2822Date`). */
const RFC_822 =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} (GMT|UT|[+-]\d{4})$/;

/** A language tag (`InvalidLanguage`). */
const LANGUAGE = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;

/** Whether `value` is a whole http(s) address (`InvalidURLAttribute`, `InvalidLink`). */
function wholeAddress(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** The children of `parent` with no namespace, which RSS 2.0's own are. */
const own = (parent: Element): Element[] =>
  [...parent.children].filter(child => child.namespaceURI === null);

/** The text of `parent`'s first own child named `name`. */
function textOf(parent: Element, name: string): string | undefined {
  return own(parent)
    .find(child => child.localName === name)
    ?.textContent?.trim();
}

/** Every rule a date element under `parent` breaks. */
function dateProblems(parent: Element, name: string, where: string): string[] {
  const value = textOf(parent, name);
  if (value === undefined) return [];
  return RFC_822.test(value) && !Number.isNaN(Date.parse(value))
    ? []
    : [`InvalidRFC2822Date: ${where} ${name} "${value}"`];
}

/** Every rule one item breaks. */
function itemProblems(item: Element, at: number, guids: Set<string>): string[] {
  const where = `item ${at}`;
  const problems: string[] = [];
  for (const child of own(item)) {
    if (!ITEM_ELEMENTS.has(child.localName)) {
      problems.push(`UndefinedElement: ${where} <${child.localName}>`);
    }
  }
  if (
    textOf(item, "title") === undefined &&
    textOf(item, "description") === undefined
  ) {
    problems.push(`ItemMustContainTitleOrDescription: ${where}`);
  }
  const link = textOf(item, "link");
  if (link !== undefined && !wholeAddress(link)) {
    problems.push(`InvalidLink: ${where} "${link}"`);
  }
  const guid = own(item).find(child => child.localName === "guid");
  if (guid === undefined) {
    problems.push(`MissingGuid: ${where}`);
  } else {
    const value = guid.textContent?.trim() ?? "";
    if (value === "") problems.push(`MissingGuid: ${where}`);
    if (guids.has(value))
      problems.push(`DuplicateValue: ${where} guid "${value}"`);
    guids.add(value);
    // A guid that does not say otherwise is a permalink, which must be an address.
    if (guid.getAttribute("isPermaLink") !== "false" && !wholeAddress(value)) {
      problems.push(`InvalidPermalink: ${where} "${value}"`);
    }
  }
  problems.push(...dateProblems(item, "pubDate", where));
  for (const category of own(item).filter(
    child => child.localName === "category"
  )) {
    if ((category.textContent ?? "").trim() === "") {
      problems.push(`NotBlank: ${where} category`);
    }
  }
  for (const creator of item.getElementsByTagNameNS(DC, "creator")) {
    if ((creator.textContent ?? "").trim() === "") {
      problems.push(`NotBlank: ${where} dc:creator`);
    }
  }
  return problems;
}

/**
 * Every rule `xml` breaks, as a feed served at `self`; none for a valid one.
 * Read with `parser`: the DOM's own where there is one, else one a suite
 * without a DOM gives (jsdom's).
 */
export function rssProblems(
  xml: string,
  self: string,
  parser: Pick<DOMParser, "parseFromString"> = new DOMParser()
): string[] {
  const document = parser.parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    return ["NotWellFormed: the feed is not well-formed XML"];
  }
  const rss = document.documentElement;
  if (rss.localName !== "rss" || rss.getAttribute("version") !== "2.0") {
    return ['InvalidRSSVersion: the root is not <rss version="2.0">'];
  }
  const channels = own(rss).filter(child => child.localName === "channel");
  const [channel] = channels;
  if (channels.length !== 1 || channel === undefined) {
    return ["MissingChannel: the feed has no single <channel>"];
  }
  const problems: string[] = [];
  for (const name of ["title", "link", "description"]) {
    if (textOf(channel, name) === undefined) {
      problems.push(`MissingElement: channel <${name}>`);
    }
  }
  for (const child of own(channel)) {
    if (!CHANNEL_ELEMENTS.has(child.localName)) {
      problems.push(`UndefinedElement: channel <${child.localName}>`);
    }
  }
  const link = textOf(channel, "link");
  if (link !== undefined && !wholeAddress(link)) {
    problems.push(`InvalidLink: channel "${link}"`);
  }
  const selfLinks = [...channel.getElementsByTagNameNS(ATOM, "link")].filter(
    element => element.getAttribute("rel") === "self"
  );
  const selfLink = selfLinks[0];
  if (selfLink === undefined) {
    problems.push('MissingAtomSelfLink: channel has no atom:link rel="self"');
  } else {
    if (selfLink.getAttribute("href") !== self) {
      problems.push(
        `SelfDoesntMatchLocation: "${selfLink.getAttribute("href") ?? ""}" is not "${self}"`
      );
    }
    if (selfLink.getAttribute("type") !== "application/rss+xml") {
      problems.push("InvalidMediaType: atom:link type");
    }
  }
  const language = textOf(channel, "language");
  if (language !== undefined && !LANGUAGE.test(language)) {
    problems.push(`InvalidLanguage: "${language}"`);
  }
  problems.push(...dateProblems(channel, "lastBuildDate", "channel"));
  problems.push(...dateProblems(channel, "pubDate", "channel"));
  const guids = new Set<string>();
  own(channel)
    .filter(child => child.localName === "item")
    .forEach((item, at) => problems.push(...itemProblems(item, at, guids)));
  return problems;
}

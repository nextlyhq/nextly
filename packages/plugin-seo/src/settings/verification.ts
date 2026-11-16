/**
 * The codes other services ask a site to place in its home page's head to
 * prove the site is theirs: one box each for Google, Bing, Pinterest, Yandex
 * and Baidu, and any other service as a name and a code.
 *
 * What a person pastes is read here, by the screen as they paste and by the
 * stored value's rule as it saves (`verification-stored`), so the two never
 * disagree. Only the code is kept: a pasted tag gives its code up and is
 * dropped, and anything that is not a code or one `<meta>` tag is refused
 * with the reason. Nothing pasted is ever written back out as it was pasted.
 *
 * It imports nothing, so the admin's bundle reads it without server code.
 *
 * @module settings/verification
 */

/** The services with a box of their own, by key. */
export type VerificationServiceKey =
  | "google"
  | "bing"
  | "pinterest"
  | "yandex"
  | "baidu";

/** One service with a box of its own. */
export interface VerificationService {
  readonly key: VerificationServiceKey;
  readonly name: string;
  /** The `name` of the `<meta>` tag the service reads its code from. */
  readonly metaName: string;
  /**
   * What the service calls its way of verifying by a meta tag, where it
   * names one, for the sentence that says which way to choose.
   */
  readonly tagOption?: string;
}

/** The services with a box of their own, in the order the screen lists them. */
export const VERIFICATION_SERVICES: readonly VerificationService[] = [
  {
    key: "google",
    name: "Google",
    metaName: "google-site-verification",
    tagOption: "HTML tag",
  },
  {
    key: "bing",
    name: "Bing",
    metaName: "msvalidate.01",
    tagOption: "HTML Meta Tag",
  },
  {
    key: "pinterest",
    name: "Pinterest",
    metaName: "p:domain_verify",
    tagOption: "Add HTML tag",
  },
  {
    key: "yandex",
    name: "Yandex",
    metaName: "yandex-verification",
    tagOption: "Meta tag",
  },
  { key: "baidu", name: "Baidu", metaName: "baidu-site-verification" },
];

/** The most other services the screen offers room for, and a save keeps. */
export const MAX_OTHER_SERVICES = 20;

/**
 * A code as services hand them out: letters, numbers and the few marks
 * their codes use (`_` and `-` in Google's, `=` and `/` in a base64 one). A
 * quote, `<`, `>`, `&` or a space is never part of one, so a code that
 * passes cannot end its attribute whatever writes it.
 */
const CODE = /^[A-Za-z0-9_\-.:=+/]{1,256}$/;

/** A meta tag's name: a letter first, then letters, numbers and `. _ : -`. */
const META_NAME = /^[A-Za-z][A-Za-z0-9._:-]{0,99}$/;

/**
 * The names Nextly writes in every page's head itself, from the page's SEO
 * or the framework, so a second tag of the same name would contradict it.
 */
const NAMES_NEXTLY_WRITES: ReadonlySet<string> = new Set([
  "description",
  "robots",
  "googlebot",
  "googlebot-news",
  "bingbot",
  "keywords",
  "viewport",
  "title",
  "author",
  "creator",
  "publisher",
  "generator",
  "application-name",
  "referrer",
  "theme-color",
  "color-scheme",
  "format-detection",
]);

/** The prefixes of the social card's tags, which Nextly writes too. */
const PREFIXES_NEXTLY_WRITES = ["og:", "twitter:", "article:"];

const REFUSED_MARKUP =
  "Only a code or a <meta> tag can go here. Scripts and other HTML are refused.";
const REFUSED_CODE =
  "That isn't a code. A code is letters and numbers, copied from the service.";

/** The service whose meta name `name` is, whatever its case. */
function serviceNamed(name: string): VerificationService | undefined {
  const lower = name.toLowerCase();
  return VERIFICATION_SERVICES.find(service => service.metaName === lower);
}

/** The service with the box `key`. */
export function serviceOf(key: VerificationServiceKey): VerificationService {
  const service = VERIFICATION_SERVICES.find(each => each.key === key);
  if (service === undefined) throw new RangeError(`No service ${key}.`);
  return service;
}

/** Whether `name` is one Nextly writes in every page's head itself. */
function nextlyWrites(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    NAMES_NEXTLY_WRITES.has(lower) ||
    PREFIXES_NEXTLY_WRITES.some(prefix => lower.startsWith(prefix))
  );
}

/** The sentence refusing a name Nextly writes itself. */
function writtenByNextly(name: string): string {
  return `Nextly already writes the ${name.toLowerCase()} tag. This box is for verification tags only.`;
}

/** Whether `code` is one a service could have handed out. */
export function isCode(code: string): boolean {
  return CODE.test(code);
}

/** What a box makes of what was pasted into it. */
export type PastedRead =
  /** Nothing in the box. */
  | { kind: "empty" }
  /**
   * A code for this box: as pasted, or taken from a whole tag (`tag`) or a
   * DNS record (`dns`), which the screen says it did.
   */
  | { kind: "code"; code: string; from?: "tag" | "dns" }
  /** Another service's tag, which belongs in that service's box. */
  | { kind: "elsewhere"; service: VerificationServiceKey; code: string }
  /** A tag of a service with no box, which belongs under Other services. */
  | { kind: "other"; name: string; code: string }
  /** Not something a box takes, and why, in a sentence. */
  | { kind: "refused"; message: string };

/** One `<meta>` tag read from what was pasted, or why it is not one. */
type TagRead =
  | { kind: "tag"; name: string; content: string }
  | { kind: "refused"; message: string };

/** Each attribute of a tag, as `name=value`, by lower-case name. */
const ATTRIBUTE =
  /\s+([A-Za-z_:][A-Za-z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/gy;

/** The attributes between a tag's name and its end, or null where any is not one. */
function attributesOf(inside: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  ATTRIBUTE.lastIndex = 0;
  let at = 0;
  while (at < inside.length) {
    ATTRIBUTE.lastIndex = at;
    const match = ATTRIBUTE.exec(inside);
    if (match === null) break;
    const [whole, name = "", double, single, bare] = match;
    attributes.set(name.toLowerCase(), double ?? single ?? bare ?? "");
    at += whole.length;
  }
  // What is left is the tag's own end, a space or a `/`, and nothing else.
  return /^\s*\/?$/.test(inside.slice(at)) ? attributes : null;
}

/**
 * The one `<meta>` tag `text` is, read as crawlers read a tag: its name and
 * its content. Anything else that starts with `<` is refused: a script, a
 * link, two tags, a tag that sets anything but a name and content.
 */
function readTag(text: string): TagRead {
  if (!/^<meta\b/i.test(text))
    return { kind: "refused", message: REFUSED_MARKUP };
  const end = text.indexOf(">");
  if (end === -1) {
    return {
      kind: "refused",
      message: "That tag is cut off. Copy the whole tag again.",
    };
  }
  if (end !== text.length - 1)
    return { kind: "refused", message: REFUSED_MARKUP };
  const attributes = attributesOf(text.slice("<meta".length, end));
  if (attributes === null || attributes.has("http-equiv")) {
    return { kind: "refused", message: REFUSED_MARKUP };
  }
  const name = attributes.get("name")?.trim() ?? "";
  if (name === "") {
    return {
      kind: "refused",
      message: "That tag is missing its name. Copy the whole tag again.",
    };
  }
  const content = attributes.get("content")?.trim();
  if (content === undefined || content === "") {
    return {
      kind: "refused",
      message: "That tag is missing its code. Copy the whole tag again.",
    };
  }
  return { kind: "tag", name, content };
}

/** What a whole tag pasted into `box` makes. */
function fromTag(
  tag: { name: string; content: string },
  box?: VerificationServiceKey
): PastedRead {
  if (!isCode(tag.content)) return { kind: "refused", message: REFUSED_CODE };
  const service = serviceNamed(tag.name);
  if (service !== undefined) {
    return service.key === box
      ? { kind: "code", code: tag.content, from: "tag" }
      : { kind: "elsewhere", service: service.key, code: tag.content };
  }
  const named = readOtherName(tag.name);
  if (named?.kind === "refused") return named;
  return { kind: "other", name: tag.name, code: tag.content };
}

/**
 * A DNS record as services show it (`google-site-verification=…`, or
 * `yandex-verification: …`), with or without its quotes: the name before
 * the `=` or `:` and the code after it. Undefined for anything else.
 */
function dnsRecordOf(text: string): { name: string; code: string } | undefined {
  const unquoted = text.replace(/^"(.*)"$/s, "$1").trim();
  const match = /^([A-Za-z][A-Za-z0-9._-]*)\s*[=:]\s*(\S+)$/.exec(unquoted);
  if (match === null) return undefined;
  const [, name = "", code = ""] = match;
  return serviceNamed(name) === undefined ? undefined : { name, code };
}

/** The sentence refusing a file name, saying which way to verify to choose. */
function fileRefusal(box: VerificationServiceKey | undefined): string {
  const service = box === undefined ? undefined : serviceOf(box);
  const option = service?.tagOption;
  const choose =
    service === undefined
      ? "choose the meta tag way to verify and paste what it shows."
      : option === undefined
        ? `choose the meta tag way to verify on ${service.name} and paste what it shows.`
        : `choose "${option}" on ${service.name} and paste what it shows.`;
  return `That's a file name. This box takes the meta tag: ${choose}`;
}

/**
 * What pasting `input` into a box makes: the box of the service `box`, or,
 * with no box, the code box under Other services.
 */
export function readPasted(
  input: string,
  box?: VerificationServiceKey
): PastedRead {
  const text = input.trim();
  if (text === "") return { kind: "empty" };
  if (text.startsWith("<")) {
    const tag = readTag(text);
    return tag.kind === "tag" ? fromTag(tag, box) : tag;
  }
  const record = dnsRecordOf(text);
  if (record !== undefined) {
    if (!isCode(record.code)) return { kind: "refused", message: REFUSED_CODE };
    const service = serviceNamed(record.name);
    return service === undefined || service.key === box
      ? { kind: "code", code: record.code, from: "dns" }
      : { kind: "elsewhere", service: service.key, code: record.code };
  }
  if (/^[\w.-]+\.(?:html?|txt|xml)$/i.test(text)) {
    return { kind: "refused", message: fileRefusal(box) };
  }
  return isCode(text)
    ? { kind: "code", code: text }
    : { kind: "refused", message: REFUSED_CODE };
}

/** What a name typed under Other services is, where it is not one to keep. */
export type OtherNameRead =
  | { kind: "elsewhere"; service: VerificationServiceKey }
  | { kind: "refused"; message: string };

/**
 * Why `input` cannot name another service's tag, or the service whose own
 * box it belongs in; null where it can. A blank name is null: whether a
 * tag needs one is the row's question, not the name's.
 */
export function readOtherName(input: string): OtherNameRead | null {
  const name = input.trim();
  if (name === "") return null;
  if (!META_NAME.test(name)) {
    return {
      kind: "refused",
      message:
        "A tag's name is letters, numbers and . _ : - only, starting with a letter.",
    };
  }
  if (nextlyWrites(name)) {
    return { kind: "refused", message: writtenByNextly(name) };
  }
  const service = serviceNamed(name);
  return service === undefined
    ? null
    : { kind: "elsewhere", service: service.key };
}

/** Where the settings screen asks whether the live home page carries the codes. */
export const VERIFICATION_CHECK_ROUTE_PATH = "/settings/verification-check";

/** One production address's home page, as the check read it. */
export interface CheckedHomePage {
  /** The production address, such as `https://example.com`. */
  address: string;
  /** Whether its home page was read. */
  read: boolean;
  /** Why it was not, in a sentence, where it was not. */
  message?: string;
}

/** What the check answers: the saved tags, and where each was found. */
export interface VerificationCheckBody {
  /** When the home pages were read, as an ISO time. */
  checkedAt: string;
  /** Each production address's home page. */
  homePages: CheckedHomePage[];
  /**
   * Each saved tag, by its meta name in lower case, with the addresses
   * whose home page carries it with the saved code.
   */
  tags: { name: string; foundAt: string[] }[];
}

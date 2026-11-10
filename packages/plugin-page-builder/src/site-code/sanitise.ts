/**
 * Turning the HTML a person pastes as site code into stored entries.
 *
 * Parsed with parse5, a parser that follows the HTML standard, with scripting
 * on as a browser parses: so what is judged is what a browser would build, not
 * what the text looks like. Each element is turned into an entry and judged by
 * the rules (`rules`); anything off the list is refused with a reason naming
 * it, never quietly stripped, so what is stored is what the person saw.
 * Comments are dropped, and the person is told.
 *
 * Text is normalised to LF line endings and NFC before parsing, because a
 * browser hashes the text with LF line endings: the hash taken at save is the
 * one a Content Security Policy is checked against.
 *
 * @module site-code/sanitise
 * @experimental
 */
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

import {
  SITE_CODE_LIMITS,
  siteCodeEntryProblem,
  type SiteCodeEntry,
  type SiteCodeSlot,
} from "./rules";

type ChildNode = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

/** What pasting HTML into a slot comes to. */
export interface SanitisedSiteCode {
  /** The entries to store; empty when anything was refused. */
  readonly entries: readonly SiteCodeEntry[];
  /** Why the paste can't be stored, one reason each; empty when it can. */
  readonly refusals: readonly string[];
  /** What was changed without refusing it (comments dropped). */
  readonly notes: readonly string[];
}

/** Text as a browser hashes it: LF line endings, composed characters. */
export function normaliseSiteCodeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").normalize("NFC");
}

/**
 * An element's attributes, as one record; the first of a repeated name wins.
 * Without a prototype, so an attribute named `__proto__` is kept, and judged,
 * rather than dropped unseen.
 */
function attrsOf(element: Element): Record<string, string> {
  const attrs: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const { name, value } of element.attrs) {
    if (!Object.hasOwn(attrs, name)) attrs[name] = value;
  }
  return attrs;
}

/** An element's text children joined, and whether it held any element. */
function textOf(element: Element): { text: string; nested: boolean } {
  let text = "";
  let nested = false;
  for (const child of element.childNodes) {
    if (child.nodeName === "#text") text += (child as { value: string }).value;
    else nested = true;
  }
  return { text, nested };
}

/**
 * A no-script fallback's one element, parsed again as a browser without
 * scripting builds it: with scripting on, its content is only text.
 */
function fallbackOf(text: string): SiteCodeEntry | string {
  const parsed = parseFragment(text, { scriptingEnabled: false });
  const elements = parsed.childNodes.filter(
    node => node.nodeName !== "#text" || !isBlank(node)
  );
  const [only] = elements;
  if (elements.length !== 1 || only === undefined || !isElement(only)) {
    return "a <noscript> may hold only one <img> or <iframe>";
  }
  if (only.tagName !== "img" && only.tagName !== "iframe") {
    return `a <noscript> may hold only an <img> or an <iframe>, not <${only.tagName}>`;
  }
  if (only.childNodes.length > 0) {
    return `the <${only.tagName}> in a <noscript> holds nothing`;
  }
  return {
    tag: "noscript",
    child: {
      tag: only.tagName === "iframe" ? "iframe" : "img",
      attrs: attrsOf(only),
    },
  };
}

/** Whether a node is an element. */
function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

/** Whether a text node holds only whitespace. */
function isBlank(node: ChildNode): boolean {
  return (node as { value?: string }).value?.trim() === "";
}

/** One parsed element as an entry, or why it can't be one. */
function entryOf(element: Element): SiteCodeEntry | string {
  const tag = element.tagName;
  const attrs = attrsOf(element);
  const { text, nested } = textOf(element);
  if (tag === "noscript") {
    if (nested) return "a <noscript> may hold only one <img> or <iframe>";
    return fallbackOf(text);
  }
  if (nested) return `<${tag}> may not hold other elements`;
  if (tag === "script") {
    return text === ""
      ? { tag: "script", attrs }
      : { tag: "script", attrs, text };
  }
  if (tag === "style") return { tag: "style", attrs, text };
  if (tag === "meta" || tag === "link") {
    return text === "" ? { tag, attrs } : `<${tag}> holds no text`;
  }
  return `<${tag}> isn't allowed`;
}

/** What each parsed node of a paste comes to. */
interface Judged {
  readonly entries: SiteCodeEntry[];
  readonly refusals: string[];
  comments: number;
}

/** One top-level node judged: an entry, a refusal, a comment, or blank text. */
function judge(node: ChildNode, slot: SiteCodeSlot, into: Judged): void {
  if (node.nodeName === "#comment") {
    into.comments += 1;
    return;
  }
  if (!isElement(node)) {
    if (!isBlank(node))
      into.refusals.push("Text outside an element isn't allowed.");
    return;
  }
  const entry = entryOf(node);
  const problem =
    typeof entry === "string" ? entry : siteCodeEntryProblem(entry, slot);
  if (problem === undefined && typeof entry !== "string") {
    into.entries.push(entry);
  } else {
    into.refusals.push(`<${node.tagName}>: ${problem ?? "isn't allowed"}.`);
  }
}

/** The note telling the person how many comments were left out. */
function commentNotes(comments: number): string[] {
  if (comments === 0) return [];
  return [
    `${comments} HTML ${comments === 1 ? "comment was" : "comments were"} left out.`,
  ];
}

/**
 * The HTML a person pasted into `slot`, as entries to store, or the reasons it
 * can't be stored. Every element is judged, so one paste reports every
 * problem at once.
 */
export function sanitiseSiteCode(
  html: string,
  slot: SiteCodeSlot
): SanitisedSiteCode {
  if (html.length > SITE_CODE_LIMITS.slotChars) {
    return {
      entries: [],
      refusals: [
        `This is longer than ${SITE_CODE_LIMITS.slotChars} characters, the most one place may hold.`,
      ],
      notes: [],
    };
  }
  const parsed = parseFragment(normaliseSiteCodeText(html), {
    scriptingEnabled: true,
  });
  const judged: Judged = { entries: [], refusals: [], comments: 0 };
  for (const node of parsed.childNodes) judge(node, slot, judged);
  const { entries, refusals } = judged;
  if (entries.length > SITE_CODE_LIMITS.entriesPerSlot) {
    refusals.push(
      `This holds ${entries.length} elements; one place may hold at most ${SITE_CODE_LIMITS.entriesPerSlot}.`
    );
  }
  return {
    entries: refusals.length === 0 ? entries : [],
    refusals,
    notes: commentNotes(judged.comments),
  };
}

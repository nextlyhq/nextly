/**
 * Stored site code in plain words: what Settings shows for each place before
 * the code itself is opened, such as "A script from www.googletagmanager.com,
 * an inline script, a verification tag". Read from the judged entries, never
 * from the text as written, so it names what is stored and rendered.
 *
 * @module site-code/describe
 * @experimental
 */
import {
  siteCodeLinkRelations,
  siteCodeScriptKind,
  type SiteCodeEntry,
} from "./rules";

/** One kind of element, in the singular and for several of it. */
interface Words {
  readonly one: string;
  readonly many: (count: number) => string;
}

/** Words whose plural only adds an `s` to the noun after the count. */
function counted(article: string, noun: string, rest = ""): Words {
  return {
    one: `${article} ${noun}${rest}`,
    many: count => `${count} ${noun}s${rest}`,
  };
}

/** Where a URL loads from: its host, or this site for a path on it. */
function hostOf(url: string | undefined): string {
  if (url === undefined) return "this site";
  try {
    return new URL(url).host;
  } catch {
    // A path on the site: the rules let only those and https: URLs through.
    return "this site";
  }
}

/**
 * The meta names that verify the site to a search engine or a platform, by
 * their ending: `google-site-verification`, `p:domain_verify`,
 * `msvalidate.01`.
 */
const VERIFICATION_META = /(?:verification|verify|validate\.01)$/;

/** A meta tag, by what it is for. */
function metaWords(attrs: Readonly<Record<string, string>>): Words {
  const name = (attrs.name ?? attrs.property ?? "").trim().toLowerCase();
  if (VERIFICATION_META.test(name)) return counted("a", "verification tag");
  return name === ""
    ? counted("a", "meta tag")
    : counted("a", "meta tag", ` (${name})`);
}

/** A link, by its first relation that says what it is for. */
function linkWords(attrs: Readonly<Record<string, string>>): Words {
  const relations = siteCodeLinkRelations(attrs.rel);
  const from = ` from ${hostOf(attrs.href)}`;
  if (relations.includes("stylesheet")) {
    return counted("a", "stylesheet", from);
  }
  if (relations.includes("icon") || relations.includes("apple-touch-icon")) {
    return counted("an", "icon");
  }
  if (relations.includes("manifest")) return counted("a", "web app manifest");
  if (relations.includes("alternate")) return counted("an", "alternate link");
  if (relations.includes("preconnect") || relations.includes("dns-prefetch")) {
    return counted("a", "connection hint", ` for ${hostOf(attrs.href)}`);
  }
  return counted("a", "preload", from);
}

/** One entry, as the kind of thing it is. */
function wordsOf(entry: SiteCodeEntry): Words {
  switch (entry.tag) {
    case "script": {
      const kind = siteCodeScriptKind(entry.attrs.type);
      if (kind === "data") return counted("a", "structured data block");
      if (entry.attrs.src !== undefined) {
        return counted("a", "script", ` from ${hostOf(entry.attrs.src)}`);
      }
      return counted("an", "inline script");
    }
    case "style":
      return counted("an", "inline style block");
    case "meta":
      return metaWords(entry.attrs);
    case "link":
      return linkWords(entry.attrs);
    case "noscript": {
      const what = entry.child.tag === "iframe" ? "frame" : "pixel";
      return counted(
        "a",
        `no-script ${what}`,
        ` from ${hostOf(entry.child.attrs.src)}`
      );
    }
  }
}

/**
 * The entries of one place in plain words, in the order they first appear,
 * with like ones counted together ("2 inline scripts"); the first word is
 * capitalised, as the start of a line. Empty when the place holds nothing.
 */
export function describeSiteCode(entries: readonly SiteCodeEntry[]): string[] {
  const groups = new Map<string, { words: Words; count: number }>();
  for (const entry of entries) {
    const words = wordsOf(entry);
    const group = groups.get(words.one);
    if (group === undefined) groups.set(words.one, { words, count: 1 });
    else group.count += 1;
  }
  const phrases = [...groups.values()].map(({ words, count }) =>
    count === 1 ? words.one : words.many(count)
  );
  const [first, ...rest] = phrases;
  return first === undefined
    ? []
    : [first.charAt(0).toUpperCase() + first.slice(1), ...rest];
}

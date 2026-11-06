/**
 * Site code and the site's Content Security Policy.
 *
 * The host app owns its policy: Nextly sets no header on the site's pages. So
 * this reads a policy rather than writing one, and answers three questions:
 * - what the site code needs of a policy (`siteCodeFacts`): the hash of each
 *   inline script and style, and the origins it loads scripts, styles,
 *   images, fonts and frames from;
 * - whether a policy lets it run (`checkSiteCodeAgainstCsp`), so a person is
 *   told before saving code the site would block;
 * - how to add what it needs to a policy without harming it
 *   (`mergeSiteCodeIntoCsp`), for the host's proxy.
 *
 * The rules followed are CSP Level 3's: a directive falls back to its parent
 * (`script-src-elem` to `script-src` to `default-src`); a hash or nonce in a
 * list cancels `'unsafe-inline'`; `'strict-dynamic'` ignores host sources.
 * What scripts load once running (their own requests) can't be seen here.
 *
 * @module site-code/csp
 * @experimental
 */
import { parse, walk, type CssNode, type WalkContext } from "css-tree";

import type { SiteCodeEntry, SiteCodeSlot } from "./rules";

/** A parsed policy: each directive's sources, the first of a repeated one kept. */
export type CspPolicy = ReadonlyMap<string, readonly string[]>;

/** A policy header as directives and their sources, read as browsers read it. */
export function parseCsp(header: string): CspPolicy {
  const directives = new Map<string, readonly string[]>();
  for (const part of header.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name === undefined || name === "") continue;
    const directive = name.toLowerCase();
    if (!directives.has(directive)) directives.set(directive, sources);
  }
  return directives;
}

/** A policy as a header again, directives in the order they were read. */
function serialiseCsp(policy: CspPolicy): string {
  return [...policy]
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

/** What a resource is fetched as, which decides the directive judging it. */
type ResourceKind = "script" | "style" | "img" | "font" | "frame";

/** Each kind's directive, then the ones it falls back to, most specific first. */
const FALLBACKS: Readonly<Record<ResourceKind, readonly string[]>> = {
  script: ["script-src-elem", "script-src", "default-src"],
  style: ["style-src-elem", "style-src", "default-src"],
  img: ["img-src", "default-src"],
  font: ["font-src", "default-src"],
  frame: ["frame-src", "child-src", "default-src"],
};

/** The directive that judges `kind`, and its sources; none means unrestricted. */
function governing(
  policy: CspPolicy,
  kind: ResourceKind
):
  | { readonly directive: string; readonly sources: readonly string[] }
  | undefined {
  for (const directive of FALLBACKS[kind]) {
    const sources = policy.get(directive);
    if (sources !== undefined) return { directive, sources };
  }
  return undefined;
}

/** Whether a source is a hash (`'sha256-…'`). */
function isHash(source: string): boolean {
  return /^'sha(256|384|512)-/i.test(source);
}

/** Whether a source is a nonce (`'nonce-…'`). */
function isNonce(source: string): boolean {
  return /^'nonce-/i.test(source);
}

/**
 * How a list treats inline code: by nonce, by hash, any, or none. For
 * scripts `'strict-dynamic'` cancels `'unsafe-inline'` as a nonce or hash
 * does, so such a list lets no inline script run by that alone.
 */
function inlineMode(
  sources: readonly string[],
  script: boolean
): "nonce" | "hash" | "unsafe-inline" | "none" {
  if (sources.some(isNonce)) return "nonce";
  if (sources.some(isHash)) return "hash";
  if (script && sources.includes("'strict-dynamic'")) return "none";
  return sources.includes("'unsafe-inline'") ? "unsafe-inline" : "none";
}

/**
 * Whether a list lets inline code with `hash` run. A nonce or hash in the list
 * cancels `'unsafe-inline'`; a nonce lets it run only where the site passes
 * its nonce to the code.
 */
function allowsInline(
  sources: readonly string[],
  hash: string,
  siteNonce: boolean,
  script: boolean
): boolean {
  if (sources.includes("'none'")) return false;
  const mode = inlineMode(sources, script);
  if (mode === "unsafe-inline") return true;
  if (sources.includes(`'${hash}'`)) return true;
  return mode === "nonce" && siteNonce;
}

/** A host source's parts, read as CSP Level 3 reads one. */
const HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\*|\d+))?(\/[^?#]*)?$/i;

/** The default port of a scheme a URL may name. */
function defaultPort(protocol: string): string {
  return protocol === "http:" ? "80" : protocol === "https:" ? "443" : "";
}

/** Whether a host source's host matches a URL's host. */
function hostMatches(pattern: string, host: string): boolean {
  if (pattern === "*") return true;
  // `*.example.com` matches its subdomains, never example.com itself.
  if (pattern.startsWith("*."))
    return host.endsWith(pattern.slice(1).toLowerCase());
  return pattern.toLowerCase() === host;
}

/** Whether a host source's path matches a URL's path. */
function pathMatches(pattern: string | undefined, path: string): boolean {
  if (pattern === undefined || pattern === "/") return true;
  return pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern;
}

/** Whether one host source allows a URL. */
function hostSourceMatches(source: string, url: URL): boolean {
  const parts = HOST_SOURCE.exec(source);
  if (parts === null) return false;
  const [, scheme, host = "", port, path] = parts;
  // `http:` in a source allows the https: upgrade of the same host.
  const schemeOk =
    scheme === undefined
      ? url.protocol === "https:" || url.protocol === "http:"
      : `${scheme.toLowerCase()}:` === url.protocol ||
        (scheme.toLowerCase() === "http" && url.protocol === "https:");
  const urlPort = url.port === "" ? defaultPort(url.protocol) : url.port;
  const portOk =
    port === "*" || (port === undefined ? url.port === "" : port === urlPort);
  return (
    schemeOk &&
    hostMatches(host, url.hostname) &&
    portOk &&
    pathMatches(path, url.pathname)
  );
}

/** Whether one source allows a URL, the site's own origin standing for 'self'. */
function sourceMatches(source: string, url: URL, siteOrigin: string): boolean {
  const lower = source.toLowerCase();
  if (lower === "'self'") return url.origin === siteOrigin;
  if (lower === "*")
    return url.protocol === "https:" || url.protocol === "http:";
  if (/^[a-z][a-z0-9+.-]*:$/.test(lower)) return url.protocol === lower;
  if (lower.startsWith("'")) return false;
  return hostSourceMatches(source, url);
}

/** What a loaded resource carries that a strict policy may trust. */
interface LoadTrust {
  /** The site passes its nonce to site code. */
  readonly siteNonce: boolean;
  /** The resource's `integrity` value, whose hash a list may name. */
  readonly integrity?: string;
}

/**
 * Whether a list lets a resource at `url` load. Under `'strict-dynamic'` a
 * script's host sources are ignored: it loads by the site's nonce, or by a
 * hash naming its integrity.
 */
function allowsUrl(
  sources: readonly string[],
  url: URL,
  siteOrigin: string,
  trust: LoadTrust & { readonly script: boolean }
): boolean {
  if (sources.includes("'none'")) return false;
  if (trust.script && sources.includes("'strict-dynamic'")) {
    if (trust.siteNonce && sources.some(isNonce)) return true;
    const integrity = trust.integrity?.split(/\s+/) ?? [];
    return integrity.some(hash => sources.includes(`'${hash}'`));
  }
  return sources.some(source => sourceMatches(source, url, siteOrigin));
}

/** One inline text, hashed as CSP hashes it: SHA-256 of its UTF-8, base64. */
export async function cspHash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  let binary = "";
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return `sha256-${btoa(binary)}`;
}

/** One resource site code loads: what it is fetched as, and from where. */
interface Load {
  readonly kind: ResourceKind;
  readonly url: string;
  readonly integrity?: string;
}

/** One piece of inline code site code runs. */
interface Inline {
  readonly kind: "script" | "style";
  readonly text: string;
}

/** What a stylesheet loads: `@import` as a style, `url()` as an image or font. */
function stylesheetLoads(text: string): Load[] {
  const loads: Load[] = [];
  let ast: CssNode;
  try {
    ast = parse(text);
  } catch {
    return loads;
  }
  walk(ast, {
    // The walk's context names the at-rule a url() sits in.
    enter(this: WalkContext, node: CssNode) {
      if (node.type !== "Url") return;
      const inFontFace = this.atrule?.name.toLowerCase() === "font-face";
      const isImport = this.atrule?.name.toLowerCase() === "import";
      loads.push({
        kind: isImport ? "style" : inFontFace ? "font" : "img",
        url: node.value,
      });
    },
  });
  return loads;
}

/** What a link loads, by its relation (a preload by its `as`). */
const LINK_KINDS: ReadonlyMap<string, ResourceKind> = new Map([
  ["stylesheet", "style"],
  ["icon", "img"],
  ["apple-touch-icon", "img"],
  ["modulepreload", "script"],
]);
const PRELOAD_KINDS: ReadonlyMap<string, ResourceKind> = new Map([
  ["script", "script"],
  ["style", "style"],
  ["font", "font"],
  ["image", "img"],
]);

/** What a link loads, by its relation; nothing for hints and alternates. */
function linkLoad(attrs: Readonly<Record<string, string>>): Load | undefined {
  const href = attrs.href;
  if (href === undefined) return undefined;
  const kind =
    attrs.rel === "preload"
      ? PRELOAD_KINDS.get(attrs.as ?? "")
      : LINK_KINDS.get(attrs.rel ?? "");
  return kind === undefined
    ? undefined
    : withIntegrity({ kind, url: href }, attrs);
}

/** A load with the integrity its element names, when it names one. */
function withIntegrity(
  load: Load,
  attrs: Readonly<Record<string, string>>
): Load {
  const integrity = attrs.integrity;
  return integrity === undefined ? load : { ...load, integrity };
}

/** What one entry loads and runs inline. */
interface Parts {
  readonly loads: Load[];
  readonly inline: Inline[];
}

const NOTHING: Parts = { loads: [], inline: [] };

/** What a script loads by `src`, or runs inline; JSON-LD is data, never run. */
function scriptParts(
  attrs: Readonly<Record<string, string>>,
  text?: string
): Parts {
  if (attrs.src !== undefined) {
    return {
      loads: [withIntegrity({ kind: "script", url: attrs.src }, attrs)],
      inline: [],
    };
  }
  return attrs.type === "application/ld+json"
    ? NOTHING
    : { loads: [], inline: [{ kind: "script", text: text ?? "" }] };
}

/** What one entry loads and runs inline. */
function partsOf(entry: SiteCodeEntry): Parts {
  switch (entry.tag) {
    case "script":
      return scriptParts(entry.attrs, entry.text);
    case "style":
      return {
        loads: stylesheetLoads(entry.text),
        inline: [{ kind: "style", text: entry.text }],
      };
    case "link": {
      const load = linkLoad(entry.attrs);
      return load === undefined ? NOTHING : { loads: [load], inline: [] };
    }
    case "noscript": {
      const { tag, attrs } = entry.child;
      const kind = tag === "iframe" ? "frame" : "img";
      return attrs.src === undefined
        ? NOTHING
        : { loads: [{ kind, url: attrs.src }], inline: [] };
    }
    case "meta":
      return NOTHING;
  }
}

/** A URL as site code may write it, read against the site's own origin. */
function urlOf(raw: string, siteOrigin: string): URL | undefined {
  try {
    return new URL(raw, siteOrigin);
  } catch {
    return undefined;
  }
}

/** What site code needs of a policy, gathered once from its entries. */
export interface SiteCodeFacts {
  /** The hashes of its inline scripts, as CSP sources (`sha256-…`). */
  readonly scriptHashes: readonly string[];
  /** The hashes of its inline styles. */
  readonly styleHashes: readonly string[];
  /** The origins it loads from, by what it loads, each once. */
  readonly origins: Readonly<Record<ResourceKind, readonly string[]>>;
}

/** What site code needs of a policy: its inline hashes and the origins it loads. */
export async function siteCodeFacts(
  entries: readonly SiteCodeEntry[],
  siteOrigin: string
): Promise<SiteCodeFacts> {
  const hashes = { script: new Set<string>(), style: new Set<string>() };
  const origins: Record<ResourceKind, Set<string>> = {
    script: new Set(),
    style: new Set(),
    img: new Set(),
    font: new Set(),
    frame: new Set(),
  };
  for (const entry of entries) {
    const { loads, inline } = partsOf(entry);
    for (const code of inline) hashes[code.kind].add(await cspHash(code.text));
    for (const load of loads) {
      const url = urlOf(load.url, siteOrigin);
      // The site's own origin is 'self', which a policy names on its own.
      if (url !== undefined && url.origin !== siteOrigin) {
        origins[load.kind].add(url.origin);
      }
    }
  }
  return {
    scriptHashes: [...hashes.script],
    styleHashes: [...hashes.style],
    origins: {
      script: [...origins.script],
      style: [...origins.style],
      img: [...origins.img],
      font: [...origins.font],
      frame: [...origins.frame],
    },
  };
}

/** One way site code would be blocked by the site's policy. */
export interface CspFinding {
  readonly slot: SiteCodeSlot;
  /** The entry, by its place in its slot. */
  readonly index: number;
  /** The directive that would block it. */
  readonly directive: string;
  readonly message: string;
  /** `warning` for a Report-Only policy, which reports and blocks nothing. */
  readonly level: "error" | "warning";
}

/** What checking site code against a policy comes to. */
export type CspCheck =
  | { readonly checked: false; readonly reason: string }
  | { readonly checked: true; readonly findings: readonly CspFinding[] };

/** The policy site code is checked against, and what it knows of the site. */
export interface CspCheckInput {
  /** The policy header; absent when no policy is known. */
  readonly policy?: string;
  /** Whether the policy is Report-Only, which blocks nothing. */
  readonly reportOnly?: boolean;
  /** The site's own origin, which `'self'` and site paths stand for. */
  readonly siteOrigin: string;
  /** Whether the site passes its nonce to site code. */
  readonly siteNonce?: boolean;
}

/** One way an entry would be blocked: the directive, and why. */
interface Blocked {
  readonly directive: string;
  readonly message: string;
}

/** The inline code a policy would block. */
async function inlineFindings(
  inline: readonly Inline[],
  policy: CspPolicy,
  siteNonce: boolean
): Promise<Blocked[]> {
  const findings: Blocked[] = [];
  for (const code of inline) {
    const rule = governing(policy, code.kind);
    if (rule === undefined) continue;
    const hash = await cspHash(code.text);
    if (allowsInline(rule.sources, hash, siteNonce, code.kind === "script")) {
      continue;
    }
    findings.push({
      directive: rule.directive,
      message: `this inline ${code.kind} is blocked: add its hash, or 'unsafe-inline' where no hash or nonce is used`,
    });
  }
  return findings;
}

/** What a policy would block of what an entry loads. */
function loadFindings(
  loads: readonly Load[],
  policy: CspPolicy,
  input: CspCheckInput
): Blocked[] {
  const findings: Blocked[] = [];
  for (const load of loads) {
    const rule = governing(policy, load.kind);
    const url = urlOf(load.url, input.siteOrigin);
    if (rule === undefined || url === undefined) continue;
    const trust = {
      siteNonce: input.siteNonce === true,
      script: load.kind === "script",
      ...(load.integrity === undefined ? {} : { integrity: load.integrity }),
    };
    if (allowsUrl(rule.sources, url, input.siteOrigin, trust)) continue;
    findings.push({
      directive: rule.directive,
      message: `${url.origin} is blocked for ${load.kind === "img" ? "images" : `${load.kind}s`}`,
    });
  }
  return findings;
}

/** The findings for one entry against a parsed policy. */
async function entryFindings(
  entry: SiteCodeEntry,
  policy: CspPolicy,
  input: CspCheckInput
): Promise<Blocked[]> {
  const { loads, inline } = partsOf(entry);
  return [
    ...(await inlineFindings(inline, policy, input.siteNonce === true)),
    ...loadFindings(loads, policy, input),
  ];
}

/**
 * How site code would fare under the site's policy: each entry it would block,
 * by slot and place, with the directive and why. With no policy known it says
 * so, rather than reporting nothing found.
 */
export async function checkSiteCodeAgainstCsp(
  input: CspCheckInput,
  slots: Readonly<Record<SiteCodeSlot, readonly SiteCodeEntry[]>>
): Promise<CspCheck> {
  if (input.policy === undefined || input.policy.trim() === "") {
    return {
      checked: false,
      reason:
        "No Content Security Policy is known for this site; nothing was checked.",
    };
  }
  const policy = parseCsp(input.policy);
  const level = input.reportOnly === true ? "warning" : "error";
  const findings: CspFinding[] = [];
  for (const slot of ["head", "body"] as const) {
    for (const [index, entry] of slots[slot].entries()) {
      for (const found of await entryFindings(entry, policy, input)) {
        findings.push({ slot, index, level, ...found });
      }
    }
  }
  return { checked: true, findings };
}

/** A kind's own directive: `script-src` and `style-src` cover both uses. */
function ownDirective(kind: ResourceKind): string {
  return kind === "script" || kind === "style"
    ? `${kind}-src`
    : (FALLBACKS[kind][0] ?? "default-src");
}

/** Whether a directive judging `kind` is a fallback shared with other kinds. */
function isFallback(kind: ResourceKind, directive: string): boolean {
  return (
    directive === "default-src" ||
    (kind === "frame" && directive === "child-src")
  );
}

/** The sources to add for one kind, by how its directive treats inline code. */
function sourcesToAdd(
  kind: ResourceKind,
  sources: readonly string[],
  hashes: readonly string[],
  origins: readonly string[]
): string[] {
  const strict = sources.includes("'strict-dynamic'");
  const mode = inlineMode(sources, kind === "script");
  // A nonce covers inline code already; a hash added to a list relying on
  // 'unsafe-inline' would cancel it and block every other inline script.
  const addHashes = mode === "hash" || mode === "none";
  return [
    ...(addHashes ? hashes.map(hash => `'${hash}'`) : []),
    // Under 'strict-dynamic' host sources are ignored, so none are added.
    ...(strict || sources.includes("*") ? [] : origins),
  ].filter(source => !sources.includes(source));
}

/**
 * The host's policy with what site code needs added, and nothing that would
 * harm it: hashes only where the policy already relies on hashes (or allows
 * no inline code at all), never where it relies on `'unsafe-inline'` or a
 * nonce; host origins only where `'strict-dynamic'` doesn't ignore them. A
 * kind no directive restricts is left alone.
 */
export function mergeSiteCodeIntoCsp(
  header: string,
  facts: SiteCodeFacts
): string {
  const policy = new Map(parseCsp(header));
  const hashesOf: Readonly<Record<ResourceKind, readonly string[]>> = {
    script: facts.scriptHashes,
    style: facts.styleHashes,
    img: [],
    font: [],
    frame: [],
  };
  for (const kind of Object.keys(FALLBACKS) as ResourceKind[]) {
    const rule = governing(policy, kind);
    if (rule === undefined) continue;
    const added = sourcesToAdd(
      kind,
      rule.sources,
      hashesOf[kind],
      facts.origins[kind]
    );
    if (added.length === 0) continue;
    // Added to the directive that governs the kind; where that is a fallback
    // (`default-src`, or `child-src` for frames), to the kind's own, made from
    // the fallback's sources, so nothing else the fallback governs is widened.
    const own = isFallback(kind, rule.directive)
      ? ownDirective(kind)
      : rule.directive;
    const base = policy.get(own) ?? rule.sources;
    policy.set(own, [...base.filter(source => source !== "'none'"), ...added]);
  }
  return serialiseCsp(policy);
}

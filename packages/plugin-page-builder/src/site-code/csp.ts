/**
 * Site code and the site's Content Security Policy.
 *
 * The host app owns its policy: Nextly sets no header on the site's pages. So
 * this reads a policy rather than writing one, and answers three questions:
 * - what the site code needs of a policy (`siteCodeFacts`): the hash of each
 *   inline script, style and no-script style attribute, and every resource it
 *   loads (scripts, styles, images, fonts, frames and a manifest);
 * - whether a policy lets it run (`checkSiteCodeAgainstCsp`), so a person is
 *   told before saving code the site would block;
 * - how to add what it needs to a policy without harming it
 *   (`mergeSiteCodeIntoCsp`), for the host's proxy.
 *
 * The rules followed are CSP Level 3's: a directive falls back to its parent
 * (`script-src-elem` to `script-src` to `default-src`); a hash or nonce in a
 * list cancels `'unsafe-inline'`, and for scripts so does `'strict-dynamic'`,
 * which also ignores host sources; `'none'` counts only alone. What scripts
 * load once running (their own requests) can't be seen here.
 *
 * @module site-code/csp
 * @experimental
 */
import { isGatedSiteCode, SITE_CODE_BOOTSTRAP } from "./bootstrap";
import { cssFetches, type CssFetch } from "./css-urls";
import {
  siteCodeLinkRelations,
  siteCodeScriptKind,
  type SiteCodeAttrs,
  type SiteCodeEntry,
  type SiteCodeSlot,
} from "./rules";

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

/**
 * Every policy a header carries: a header may hold several, separated by
 * commas, and a browser enforces each.
 */
function parsePolicies(header: string): CspPolicy[] {
  return header
    .split(",")
    .filter(policy => policy.trim() !== "")
    .map(parseCsp);
}

/** A policy as a header again, directives in the order they were read. */
function serialiseCsp(policy: CspPolicy): string {
  return [...policy]
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

/** What a resource is fetched as, which decides the directive judging it. */
export type SiteCodeResourceKind =
  | "script"
  | "style"
  | "img"
  | "font"
  | "frame"
  | "manifest";

/**
 * What inline code is: a script's or a style's text, or a style attribute
 * (on a no-script pixel, applied only when scripting is off).
 */
export type SiteCodeInlineKind = "script" | "style" | "style-attr";

/** A kind of resource or of inline code, each judged by its own directives. */
type Kind = SiteCodeResourceKind | SiteCodeInlineKind;

/** Each kind's directive, then the ones it falls back to, most specific first. */
const FALLBACKS: Readonly<Record<Kind, readonly string[]>> = {
  script: ["script-src-elem", "script-src", "default-src"],
  style: ["style-src-elem", "style-src", "default-src"],
  "style-attr": ["style-src-attr", "style-src", "default-src"],
  img: ["img-src", "default-src"],
  font: ["font-src", "default-src"],
  frame: ["frame-src", "child-src", "default-src"],
  manifest: ["manifest-src", "default-src"],
};

/** The directive that judges `kind`, and its sources; none means unrestricted. */
function governing(
  policy: CspPolicy,
  kind: Kind
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

/** Whether a list holds a keyword, in any case. */
function holds(sources: readonly string[], keyword: string): boolean {
  return sources.some(source => source.toLowerCase() === keyword);
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
  if (script && holds(sources, "'strict-dynamic'")) return "none";
  return holds(sources, "'unsafe-inline'") ? "unsafe-inline" : "none";
}

/**
 * A hash source as CSP compares it: the algorithm in any case, the digest in
 * base64 whether written as base64 or base64url, padding aside.
 */
function hashKey(source: string): string | undefined {
  const match = /^'?(sha256|sha384|sha512)-([A-Za-z0-9+/=_-]+)'?$/i.exec(
    source
  );
  if (match === null) return undefined;
  const [, algorithm = "", digest = ""] = match;
  return `${algorithm.toLowerCase()}-${digest
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/, "")}`;
}

/** Whether a list names `hash` (`sha256-…`), compared as CSP compares it. */
function namesHash(sources: readonly string[], hash: string): boolean {
  const key = hashKey(hash);
  return key !== undefined && sources.some(source => hashKey(source) === key);
}

/**
 * Whether a list lets inline code with `hash` run. A nonce or hash in the list
 * cancels `'unsafe-inline'`; a nonce lets an element run only where the site
 * passes its nonce to the code. A style attribute takes no nonce, and is
 * matched by hash only under `'unsafe-hashes'`.
 */
function allowsInline(
  sources: readonly string[],
  hash: string,
  siteNonce: boolean,
  kind: SiteCodeInlineKind
): boolean {
  const mode = inlineMode(sources, kind === "script");
  if (mode === "unsafe-inline") return true;
  if (kind === "style-attr") {
    return holds(sources, "'unsafe-hashes'") && namesHash(sources, hash);
  }
  if (namesHash(sources, hash)) return true;
  return mode === "nonce" && siteNonce;
}

/** A host source's parts, read as CSP Level 3 reads one. */
const HOST_SOURCE =
  /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\*|\d+))?(\/[^?#]*)?$/i;

/** An IPv4 address written as a host. */
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The default port of a scheme a URL may name. */
function defaultPort(protocol: string): string {
  return protocol === "http:" ? "80" : protocol === "https:" ? "443" : "";
}

/**
 * Whether a host source's host matches a URL's host. An IP address matches
 * nothing but the loopback address, as CSP Level 3 matches hosts.
 */
function hostMatches(pattern: string, host: string): boolean {
  if (pattern === "*") return true;
  if (IPV4.test(pattern)) return pattern === "127.0.0.1" && host === pattern;
  // `*.example.com` matches its subdomains, never example.com itself.
  if (pattern.startsWith("*.")) {
    return host.endsWith(pattern.slice(1).toLowerCase());
  }
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

/**
 * Whether `'self'` allows a URL: the site's own origin, or its secure
 * upgrade (an `http:` site loading the same host over `https:`, each on its
 * default port, or the same port), as CSP Level 3 matches it.
 */
function selfMatches(url: URL, siteOrigin: string): boolean {
  if (url.origin === siteOrigin) return true;
  const site = new URL(siteOrigin);
  return (
    site.protocol === "http:" &&
    url.protocol === "https:" &&
    url.hostname === site.hostname &&
    (url.port === site.port || (site.port === "" && url.port === ""))
  );
}

/**
 * Whether one source allows a URL, the site's own origin standing for
 * 'self'. A keyword matches no URL, so `'none'` beside other sources is
 * ignored, as browsers ignore it, and alone matches nothing.
 */
function sourceMatches(source: string, url: URL, siteOrigin: string): boolean {
  const lower = source.toLowerCase();
  if (lower === "'self'") return selfMatches(url, siteOrigin);
  if (lower === "*") {
    return url.protocol === "https:" || url.protocol === "http:";
  }
  if (/^[a-z][a-z0-9+.-]*:$/.test(lower)) return url.protocol === lower;
  if (lower.startsWith("'")) return false;
  return hostSourceMatches(source, url);
}

/**
 * The hashes in an `integrity` value a policy can name: those of the
 * algorithms CSP knows, without their options.
 */
function integrityHashes(integrity: string | undefined): string[] {
  return (integrity ?? "")
    .split(/\s+/)
    .map(token => token.split("?")[0] ?? "")
    .filter(token => /^sha(256|384|512)-[A-Za-z0-9+/=_-]+$/.test(token));
}

/** Whether a list names every hash a script's integrity holds. */
function integrityMatches(
  sources: readonly string[],
  integrity: string | undefined
): boolean {
  const hashes = integrityHashes(integrity);
  return hashes.length > 0 && hashes.every(hash => namesHash(sources, hash));
}

/** One resource site code loads: what it is fetched as, and from where. */
export interface SiteCodeLoad {
  readonly kind: SiteCodeResourceKind;
  /** The URL as written: `https:`, or a path on the site. */
  readonly url: string;
  readonly integrity?: string;
  /**
   * Loaded by an element the loader builds and passes the site's nonce to (a
   * script's `src`, a stylesheet link); never a fetch a stylesheet makes,
   * which carries no nonce.
   */
  readonly nonceable?: true;
}

/** What a load is judged with besides the policy. */
interface LoadContext {
  /** The site's own origin, which `'self'` and site paths stand for. */
  readonly siteOrigin: string;
  /** Whether the site passes its nonce to site code. */
  readonly siteNonce: boolean;
}

/**
 * Whether a list lets a load at `url` happen. A script or style the site
 * passes its nonce to loads under a list naming a nonce; a script whose
 * integrity the list names in full loads too. Under `'strict-dynamic'` a
 * script's host sources are ignored.
 */
function allowsLoad(
  sources: readonly string[],
  load: SiteCodeLoad,
  url: URL,
  context: LoadContext
): boolean {
  if (load.nonceable === true && context.siteNonce && sources.some(isNonce)) {
    return true;
  }
  if (load.kind === "script") {
    if (integrityMatches(sources, load.integrity)) return true;
    if (holds(sources, "'strict-dynamic'")) return false;
  }
  return sources.some(source => sourceMatches(source, url, context.siteOrigin));
}

/** One inline text, hashed as CSP hashes it: SHA-256 of its UTF-8, base64. */
export async function cspHash(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return `sha256-${btoa(binary)}`;
}

/** One piece of inline code site code runs. */
interface Inline {
  readonly kind: SiteCodeInlineKind;
  readonly text: string;
}

/** What a stylesheet fetch loads, as a resource. */
const FETCH_KINDS: Readonly<Record<CssFetch["via"], SiteCodeResourceKind>> = {
  import: "style",
  font: "font",
  image: "img",
};

/** What a link loads, by its relation (a preload by its `as`). */
const LINK_KINDS: ReadonlyMap<string, SiteCodeResourceKind> = new Map([
  ["stylesheet", "style"],
  ["icon", "img"],
  ["apple-touch-icon", "img"],
  ["modulepreload", "script"],
  ["manifest", "manifest"],
]);
const PRELOAD_KINDS: ReadonlyMap<string, SiteCodeResourceKind> = new Map([
  ["script", "script"],
  ["style", "style"],
  ["font", "font"],
  ["image", "img"],
]);

/** A load with the integrity its element names, when it names one. */
function withIntegrity(load: SiteCodeLoad, attrs: SiteCodeAttrs): SiteCodeLoad {
  const integrity = attrs.integrity;
  return integrity === undefined ? load : { ...load, integrity };
}

/** What a link loads, by its relation; nothing for hints and alternates. */
function linkLoad(attrs: SiteCodeAttrs): SiteCodeLoad | undefined {
  const href = attrs.href;
  if (href === undefined) return undefined;
  const relations = siteCodeLinkRelations(attrs.rel);
  const kind = relations.includes("preload")
    ? PRELOAD_KINDS.get((attrs.as ?? "").trim().toLowerCase())
    : relations
        .map(relation => LINK_KINDS.get(relation))
        .find(found => found !== undefined);
  if (kind === undefined) return undefined;
  // A stylesheet link is built by the loader, which passes it the nonce.
  const load = withIntegrity({ kind, url: href }, attrs);
  return relations.includes("stylesheet") ? { ...load, nonceable: true } : load;
}

/** What one entry loads and runs inline. */
interface Parts {
  readonly loads: SiteCodeLoad[];
  readonly inline: Inline[];
}

const NOTHING: Parts = { loads: [], inline: [] };

/** What a script loads by `src`, or runs inline; JSON-LD is data, never run. */
function scriptParts(attrs: SiteCodeAttrs, text?: string): Parts {
  if (siteCodeScriptKind(attrs.type) === "data") return NOTHING;
  if (attrs.src !== undefined) {
    return {
      loads: [
        {
          ...withIntegrity({ kind: "script", url: attrs.src }, attrs),
          nonceable: true,
        },
      ],
      inline: [],
    };
  }
  return { loads: [], inline: [{ kind: "script", text: text ?? "" }] };
}

/**
 * What a no-script pixel loads, and its style attribute, which applies when
 * scripting is off and is judged as inline style.
 */
function fallbackParts(child: {
  readonly tag: "img" | "iframe";
  readonly attrs: SiteCodeAttrs;
}): Parts {
  const { src, style } = child.attrs;
  const own: SiteCodeLoad[] =
    src === undefined
      ? []
      : [{ kind: child.tag === "iframe" ? "frame" : "img", url: src }];
  // The style attribute applies, and fetches what it names, as a sheet does.
  const styled: SiteCodeLoad[] =
    style === undefined
      ? []
      : cssFetches(style, "declarationList").map(fetch => ({
          kind: FETCH_KINDS[fetch.via],
          url: fetch.url,
        }));
  return {
    loads: [...own, ...styled],
    inline: style === undefined ? [] : [{ kind: "style-attr", text: style }],
  };
}

/** What one entry loads and runs inline. */
function partsOf(entry: SiteCodeEntry): Parts {
  switch (entry.tag) {
    case "script":
      return scriptParts(entry.attrs, entry.text);
    case "style":
      return {
        loads: cssFetches(entry.text).map(fetch => ({
          kind: FETCH_KINDS[fetch.via],
          url: fetch.url,
        })),
        inline: [{ kind: "style", text: entry.text }],
      };
    case "link": {
      const load = linkLoad(entry.attrs);
      return load === undefined ? NOTHING : { loads: [load], inline: [] };
    }
    case "noscript":
      return fallbackParts(entry.child);
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
  /** The site's own origin, which `'self'` and site paths stand for. */
  readonly siteOrigin: string;
  /** The hashes of its inline code, as CSP sources (`sha256-…`), by kind. */
  readonly hashes: Readonly<Record<SiteCodeInlineKind, readonly string[]>>;
  /** Every resource it loads, each once, as written. */
  readonly loads: readonly SiteCodeLoad[];
}

/** What site code needs of a policy: its inline hashes and what it loads. */
export async function siteCodeFacts(
  entries: readonly SiteCodeEntry[],
  siteOrigin: string
): Promise<SiteCodeFacts> {
  const hashes: Record<SiteCodeInlineKind, Set<string>> = {
    script: new Set(),
    style: new Set(),
    "style-attr": new Set(),
  };
  const loads = new Map<string, SiteCodeLoad>();
  for (const entry of entries) {
    const parts = partsOf(entry);
    for (const code of parts.inline) {
      hashes[code.kind].add(await cspHash(code.text));
    }
    for (const load of parts.loads) {
      loads.set(`${load.kind} ${load.url} ${load.integrity ?? ""}`, load);
    }
  }
  // The loader that starts gated code is an inline script of its own.
  if (entries.some(isGatedSiteCode)) {
    hashes.script.add(await cspHash(SITE_CODE_BOOTSTRAP));
  }
  return {
    siteOrigin,
    hashes: {
      script: [...hashes.script],
      style: [...hashes.style],
      "style-attr": [...hashes["style-attr"]],
    },
    loads: [...loads.values()],
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

/** Why a policy blocks inline code of `kind`, in words. */
const INLINE_BLOCKED: Readonly<Record<SiteCodeInlineKind, string>> = {
  script:
    "this inline script is blocked: add its hash, or 'unsafe-inline' where no hash or nonce is used",
  style:
    "this inline style is blocked: add its hash, or 'unsafe-inline' where no hash or nonce is used",
  "style-attr":
    "this no-script fallback's style attribute is blocked when scripting is off: add 'unsafe-hashes' and its hash",
};

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
    if (allowsInline(rule.sources, hash, siteNonce, code.kind)) continue;
    findings.push({
      directive: rule.directive,
      message: INLINE_BLOCKED[code.kind],
    });
  }
  return findings;
}

/** A kind as people say it, for a finding's words. */
const KIND_WORDS: Readonly<Record<SiteCodeResourceKind, string>> = {
  script: "scripts",
  style: "styles",
  img: "images",
  font: "fonts",
  frame: "frames",
  manifest: "a manifest",
};

/** What a policy would block of what an entry loads. */
function loadFindings(
  loads: readonly SiteCodeLoad[],
  policy: CspPolicy,
  context: LoadContext
): Blocked[] {
  const findings: Blocked[] = [];
  for (const load of loads) {
    const rule = governing(policy, load.kind);
    const url = urlOf(load.url, context.siteOrigin);
    if (rule === undefined || url === undefined) continue;
    if (allowsLoad(rule.sources, load, url, context)) continue;
    findings.push({
      directive: rule.directive,
      message: `${url.origin} is blocked for ${KIND_WORDS[load.kind]}`,
    });
  }
  return findings;
}

/** The findings for one entry against a parsed policy. */
async function entryFindings(
  entry: SiteCodeEntry,
  policy: CspPolicy,
  context: LoadContext
): Promise<Blocked[]> {
  const { loads, inline } = partsOf(entry);
  return [
    ...(await inlineFindings(inline, policy, context.siteNonce)),
    ...loadFindings(loads, policy, context),
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
  const level: CspFinding["level"] =
    input.reportOnly === true ? "warning" : "error";
  const context = {
    siteOrigin: input.siteOrigin,
    siteNonce: input.siteNonce === true,
  };
  // Every policy the header carries is enforced, so each is checked; a block
  // two policies make alike is said once.
  const findings = new Map<string, CspFinding>();
  for (const policy of parsePolicies(input.policy)) {
    for (const finding of await policyFindings(policy, slots, context, level)) {
      findings.set(JSON.stringify(finding), finding);
    }
  }
  return { checked: true, findings: [...findings.values()] };
}

/** Every way one policy blocks the code: each entry's own, and the loader's. */
async function policyFindings(
  policy: CspPolicy,
  slots: Readonly<Record<SiteCodeSlot, readonly SiteCodeEntry[]>>,
  context: LoadContext,
  level: CspFinding["level"]
): Promise<CspFinding[]> {
  const found: CspFinding[] = [];
  for (const slot of ["head", "body"] as const) {
    for (const [index, entry] of slots[slot].entries()) {
      for (const blocked of await entryFindings(entry, policy, context)) {
        found.push({ slot, index, level, ...blocked });
      }
    }
  }
  const loader = firstGated(slots);
  const blocked =
    loader === undefined ? undefined : await loaderBlocked(policy, context);
  if (loader !== undefined && blocked !== undefined) {
    found.push({ ...loader, level, ...blocked });
  }
  return found;
}

/** The first entry the loader starts, which a block of the loader is told on. */
function firstGated(
  slots: Readonly<Record<SiteCodeSlot, readonly SiteCodeEntry[]>>
): { slot: SiteCodeSlot; index: number } | undefined {
  for (const slot of ["head", "body"] as const) {
    const index = slots[slot].findIndex(isGatedSiteCode);
    if (index !== -1) return { slot, index };
  }
  return undefined;
}

/** How a policy blocks the loader that starts gated code, if it does. */
async function loaderBlocked(
  policy: CspPolicy,
  context: LoadContext
): Promise<Blocked | undefined> {
  const rule = governing(policy, "script");
  if (rule === undefined) return undefined;
  const hash = await cspHash(SITE_CODE_BOOTSTRAP);
  if (allowsInline(rule.sources, hash, context.siteNonce, "script")) {
    return undefined;
  }
  return {
    directive: rule.directive,
    message: `the loader that starts site code is blocked: add its hash ('${hash}'), or pass the site's nonce to <SiteCode>`,
  };
}

/** Each kind's own directive, which an addition goes to over a fallback. */
const OWN_DIRECTIVE: Readonly<Record<Kind, string>> = {
  script: "script-src-elem",
  style: "style-src-elem",
  "style-attr": "style-src-attr",
  img: "img-src",
  font: "font-src",
  frame: "frame-src",
  manifest: "manifest-src",
};

/**
 * Whether the directive judging `kind` is a fallback that governs other uses
 * too: `default-src` for every kind; `script-src`, which workers fall back to
 * as well; `style-src`, which governs style attributes and elements alike;
 * and `child-src` for frames, which governs workers too.
 */
function isFallback(kind: Kind, directive: string): boolean {
  return (
    directive === "default-src" ||
    (kind === "script" && directive === "script-src") ||
    ((kind === "style" || kind === "style-attr") &&
      directive === "style-src") ||
    (kind === "frame" && directive === "child-src")
  );
}

/**
 * Add `sources` to the directive judging `kind`; where that is a fallback, to
 * the kind's own directive, made from the fallback's sources, so nothing else
 * the fallback governs is widened.
 */
function addTo(
  policy: Map<string, readonly string[]>,
  kind: Kind,
  sources: readonly string[]
): void {
  const rule = governing(policy, kind);
  if (rule === undefined || sources.length === 0) return;
  const own = isFallback(kind, rule.directive)
    ? OWN_DIRECTIVE[kind]
    : rule.directive;
  const base = (policy.get(own) ?? rule.sources).filter(
    source => source.toLowerCase() !== "'none'"
  );
  const added = [...new Set(sources)].filter(source => !base.includes(source));
  policy.set(own, [...base, ...added]);
}

/** The sources letting inline code of `kind` run that the policy blocks. */
function inlineNeeds(
  policy: CspPolicy,
  kind: SiteCodeInlineKind,
  hashes: readonly string[],
  siteNonce: boolean
): string[] {
  const rule = governing(policy, kind);
  if (rule === undefined) return [];
  const blocked = hashes.filter(
    hash => !allowsInline(rule.sources, hash, siteNonce, kind)
  );
  if (blocked.length === 0) return [];
  const named = blocked.map(hash => `'${hash}'`);
  return kind === "style-attr" ? ["'unsafe-hashes'", ...named] : named;
}

/**
 * The sources letting one blocked load happen: its integrity's hashes for a
 * script under `'strict-dynamic'` (no host is honoured there, and one without
 * integrity needs the site's nonce instead), else `'self'` for the site's own
 * origin or the load's origin. Nothing for a load already allowed.
 */
function loadNeeds(
  policy: CspPolicy,
  load: SiteCodeLoad,
  context: LoadContext
): string[] {
  const rule = governing(policy, load.kind);
  const url = urlOf(load.url, context.siteOrigin);
  if (rule === undefined || url === undefined) return [];
  if (allowsLoad(rule.sources, load, url, context)) return [];
  if (load.kind === "script" && holds(rule.sources, "'strict-dynamic'")) {
    return integrityHashes(load.integrity).map(hash => `'${hash}'`);
  }
  return [url.origin === context.siteOrigin ? "'self'" : url.origin];
}

/**
 * The host's policy with what site code needs added, and nothing more: only
 * what the policy blocks now is added, so a load it already allows (under a
 * path-scoped source, say) adds nothing. Hashes are added only where inline
 * code is blocked, which never happens under a list relying on
 * `'unsafe-inline'`, so it is never cancelled. A kind no directive restricts
 * is left alone. Pass `siteNonce` when the site hands its nonce to site code.
 *
 * Additions for scripts and styles go to `script-src-elem` and
 * `style-src-elem`, made from what they fell back to, so workers and style
 * attributes gain nothing. Browsers from before those directives (Chrome 75,
 * Firefox 108 and Safari 15.4) read only the fallback and so don't see them.
 */
export function mergeSiteCodeIntoCsp(
  header: string,
  facts: SiteCodeFacts,
  options: { readonly siteNonce?: boolean } = {}
): string {
  const context = {
    siteOrigin: facts.siteOrigin,
    siteNonce: options.siteNonce === true,
  };
  // Each policy the header carries is enforced on its own, so each is given
  // what it blocks.
  return parsePolicies(header)
    .map(parsed => serialiseCsp(mergedPolicy(parsed, facts, context)))
    .join(", ");
}

/** One policy with what site code needs that it blocks added. */
function mergedPolicy(
  parsed: CspPolicy,
  facts: SiteCodeFacts,
  context: LoadContext
): CspPolicy {
  const policy = new Map(parsed);
  for (const kind of ["script", "style", "style-attr"] as const) {
    const needs = inlineNeeds(
      policy,
      kind,
      facts.hashes[kind],
      context.siteNonce
    );
    addTo(policy, kind, needs);
  }
  for (const load of facts.loads) {
    addTo(policy, load.kind, loadNeeds(policy, load, context));
  }
  return policy;
}

/**
 * Filesystem mount scanner for OpenAPI generation.
 *
 * Derives the API surface a user's app actually mounts by reading its
 * `route.ts` files under the app-router directory STATICALLY — never importing
 * them, so no user code runs. For each route it records the mount path, which
 * nextly surface it mounts, and which HTTP verbs it exports. That triple is the
 * ground truth the generator turns into operations; deriving it from the
 * filesystem keeps the spec in sync without a hand-maintained mount list.
 *
 * Why a narrow tokenizer and not a TS parser: `typescript` is not a runtime
 * dependency a plugin can assume, and the route-handler convention is a bounded
 * surface (re-exported verb identifiers plus a nextly import specifier). We
 * strip comments and walk that surface only. Files that reference nextly but
 * match no known shape fail with a clear reason, and the `mounts` option on the
 * plugin is the explicit override for anything this scan cannot express.
 *
 * Node-only (`node:fs`, `node:path`): the plugin's routes run on the server.
 *
 * @module scan
 * @since alpha
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ============================================================
// Types
// ============================================================

/**
 * HTTP verbs a Next.js App Router route handler may export. UPPERCASE export
 * names Next matches to requests; the generator lowercases them for OpenAPI
 * operation keys.
 */
export type RouteVerb =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Canonical verb order, so emitted operations are deterministic. */
const ROUTE_VERBS: readonly RouteVerb[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

const ROUTE_VERB_SET: ReadonlySet<string> = new Set(ROUTE_VERBS);

function isRouteVerb(name: string): name is RouteVerb {
  return ROUTE_VERB_SET.has(name);
}

/**
 * Which nextly surface a scanned route mounts. The discriminator drives how the
 * generator expands one mount into operations.
 */
export type RouteSource =
  /**
   * The catch-all dynamic handler (`createDynamicHandlers` from
   * `nextly/runtime`). One mount stands for the whole descriptor-driven
   * catch-all surface; the generator expands it from the admin REST
   * introspection seam.
   */
  | { kind: "dynamic-catchall" }
  /**
   * The media factory (`createMediaHandlers` from `nextly/api/media-handlers`).
   * Mounted twice in the standard app — auth'd CRUD under `/admin/api/media`
   * and a GET-only public surface under `/api/media` — distinguished only by
   * which verbs the route file re-exports.
   */
  | { kind: "media" }
  /**
   * A direct re-export of one of the `nextly/api/<subpath>` handlers
   * (e.g. `nextly/api/health`, `nextly/api/versions`).
   */
  | { kind: "api-subpath"; subpath: string };

/** Result of classifying a single route file's source. */
export type RouteClassification =
  | { kind: "nextly"; source: RouteSource; verbs: RouteVerb[] }
  | { kind: "unrecognized"; reason: string }
  /** A route file with no nextly reference — a user-owned route, not our surface. */
  | { kind: "non-nextly" };

/** A scanned route, fully resolved to a mount path. */
export interface ScannedRoute {
  /** Absolute path to the `route.ts` file. Absent for mounts added via a
   * `mounts` override, which declare a surface with no source file. */
  filePath?: string;
  /** Mount path relative to the app-router root, e.g. `/admin/api/[[...params]]`. */
  mountPath: string;
  /** The nextly surface this route mounts. */
  source: RouteSource;
  /** HTTP verbs this route file exports (canonical order). */
  verbs: RouteVerb[];
}

/** The full output of scanning an app directory. */
export interface ScanResult {
  routes: ScannedRoute[];
  /** Files referencing nextly in a shape the scan cannot classify. */
  unrecognized: { filePath: string; reason: string }[];
}

// ============================================================
// Comment stripping
// ============================================================

/**
 * Remove single-line and block comments while leaving string and template
 * literals intact (import specifiers live in strings and must survive). Comment
 * removal is mandatory before pattern matching: real route files carry JSDoc
 * examples that contain a fake `export { GET } from "nextly/api/..."`, which a
 * naive scan would double-count. Newlines inside removed comments are preserved
 * so file-relative positions stay meaningful.
 *
 * Known limitation: regex literals containing `//` or `/*` sequences can confuse
 * the slash disambiguation. Route handlers do not use such patterns, and any
 * file that does falls through to the `mounts` override.
 */
function stripComments(code: string): string {
  let out = "";
  let i = 0;
  let quote: '"' | "'" | "`" | null = null;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === "\\") {
        // Keep an escaped char literally so an escaped quote cannot close the string.
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      const nl = code.indexOf("\n", i);
      if (nl === -1) break;
      i = nl; // the newline is emitted on the next iteration
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      if (end === -1) break;
      for (let j = i; j < end + 2; j += 1) if (code[j] === "\n") out += "\n";
      i = end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// ============================================================
// Exported-name extraction
// ============================================================

/**
 * Collect every identifier this module exports, across the route-handler
 * conventions nextly's templates and docs use:
 * - `export { A, B as C }` (and `export { A } from "..."`)
 * - `export const { A, B } = ...` (destructure)
 * - `export const A = ..., B = ...` (plain, one or comma-separated)
 * Only the shape is parsed; values are irrelevant to which verbs are exported.
 */
function extractExportedNames(code: string): string[] {
  const names = new Set<string>();

  for (const m of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      // `A as B` exports B - the EXPORTED name is what Next matches to a
      // request verb, so take the last segment of a rename.
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  for (const m of code.matchAll(/\bexport\s+const\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(",")) {
      // A destructure rename (`A: B`) binds B - the bound name is the verb.
      const segments = part.trim().split(/\s*:\s*/);
      const name = (segments[1] ?? segments[0]).trim();
      if (name) names.add(name);
    }
  }
  for (const m of code.matchAll(/\bexport\s+const\s+([^=;{]+)/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return [...names];
}

function verbsOf(code: string): RouteVerb[] {
  const present = new Set(extractExportedNames(code).filter(isRouteVerb));
  // Canonical order, filtered to those actually exported.
  return ROUTE_VERBS.filter(v => present.has(v));
}

// ============================================================
// Classification (pure; no filesystem)
// ============================================================

/**
 * Classify a single route file's source into a nextly surface + exported verbs.
 * Pure so the parser can be unit-tested with strings, independent of the
 * filesystem walk. Returns `non-nextly` for user-owned routes (skipped), and
 * `unrecognized` with a reason when a file references nextly in a shape the scan
 * cannot express.
 */
export function classifyRouteSource(code: string): RouteClassification {
  const src = stripComments(code);

  // Catch-all: the dynamic handler from nextly/runtime. Requiring a CALL (not
  // just an import) keeps a file that merely names the factory from being
  // misread; the verbs come from whatever the file re-exports.
  if (
    /\bcreateDynamicHandlers\s*\(/.test(src) &&
    /from\s*["']nextly\/runtime["']/.test(src)
  ) {
    return {
      kind: "nextly",
      source: { kind: "dynamic-catchall" },
      verbs: verbsOf(src),
    };
  }
  // Media factory. Mounted twice in the standard app; the verbs exported here
  // are what tell the auth'd CRUD mount apart from the GET-only public one.
  // Requiring a call lets an uncalled import fall through to `unrecognized`.
  if (
    /\bcreateMediaHandlers\s*\(/.test(src) &&
    /from\s*["']nextly\/api\/media-handlers["']/.test(src)
  ) {
    return { kind: "nextly", source: { kind: "media" }, verbs: verbsOf(src) };
  }
  // A direct re-export of a nextly/api/<subpath> handler. The subpath names the
  // surface; the verbs are those re-exported from it.
  const sub = src.match(/from\s*["']nextly\/api\/([^"']+)["']/);
  if (sub) {
    const subpath = sub[1];
    if (subpath === "media-handlers") {
      // Referenced the media module without calling its factory — not a shape we
      // can safely expand, so surface it rather than guess.
      return {
        kind: "unrecognized",
        reason:
          "imports nextly/api/media-handlers but does not call createMediaHandlers; " +
          "declare this mount explicitly via the apiDocsPlugin `mounts` option if it is intentional",
      };
    }
    return {
      kind: "nextly",
      source: { kind: "api-subpath", subpath },
      verbs: verbsOf(src),
    };
  }
  // Referenced nextly somewhere we do not model — flag rather than ignore.
  const anyNextly = src.match(/from\s*["']nextly(?:\/[^"']*)?["']/);
  if (anyNextly) {
    return {
      kind: "unrecognized",
      reason: `${anyNextly[0]} is not a known OpenAPI surface`,
    };
  }
  return { kind: "non-nextly" };
}

// ============================================================
// Mount-path derivation
// ============================================================

const ROUTE_FILE_RE = /[/\\]route\.(?:ts|tsx|js|jsx)$/;

function isRouteFile(name: string): boolean {
  return ROUTE_FILE_RE.test(name.replace(/\\/g, "/"));
}

/**
 * Derive the URL mount path from a route file's path. The app-router root is the
 * last `/app/` segment (covers both `app/` and `src/app/`), route-group segments
 * `(name)` are removed (they are not part of the URL), and the trailing
 * `/route.<ext>` is dropped. Catch-all/dynamic segments (`[[...x]]`, `[x]`) are
 * preserved verbatim — interpreting them into OpenAPI path templates is the
 * generator's job, not the scan's.
 */
export function deriveMountPath(filePath: string): string {
  const norm = filePath.replace(/\\/g, "/");
  const appIdx = norm.lastIndexOf("/app/");
  if (appIdx === -1) {
    throw new Error(
      `cannot derive a mount path: ${filePath} is not under an app/ directory`
    );
  }
  let route = norm
    .slice(appIdx + "/app/".length)
    .replace(/\/route\.(?:ts|tsx|js|jsx)$/, "");
  // Drop route-group segments — present in the filesystem, absent from the URL.
  route = route
    .split("/")
    .filter(seg => !(seg.startsWith("(") && seg.endsWith(")")))
    .join("/");
  return "/" + route;
}

// ============================================================
// Filesystem walk
// ============================================================

/** Directories that never contain route files worth scanning. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  ".turbo",
  ".cache",
]);

/** Discover app-router roots under a project (both `app/` and `src/app/`). */
function discoverAppDirs(projectRoot: string): string[] {
  const candidates = [
    join(projectRoot, "src", "app"),
    join(projectRoot, "app"),
  ];
  return candidates.filter(d => existsSync(d));
}

function walkRoutes(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // unreadable directory — skip rather than abort the whole scan.
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkRoutes(full, out);
    } else if (isRouteFile(full)) {
      out.push(full);
    }
  }
}

export interface ScanOptions {
  /**
   * Explicit app-router roots to scan instead of auto-discovering `app/` and
   * `src/app/`. Mainly for tests and for `mounts` overrides that point at a
   * non-standard layout.
   */
  appDirs?: string[];
}

/**
 * Scan an app directory for mounted nextly routes. Reads each `route.*` file,
 * classifies it, and resolves its mount path. Files that reference nextly in an
 * unrecognized shape are collected in `unrecognized` rather than aborting the
 * scan, so a single odd file does not block generation of the rest.
 */
export function scanAppDirectory(
  projectRoot: string,
  options?: ScanOptions
): ScanResult {
  const appDirs = options?.appDirs ?? discoverAppDirs(projectRoot);
  const routeFiles: string[] = [];
  for (const dir of appDirs) walkRoutes(dir, routeFiles);

  const routes: ScannedRoute[] = [];
  const unrecognized: { filePath: string; reason: string }[] = [];
  for (const filePath of routeFiles.sort()) {
    // An unreadable route file (permissions, a race with an editor) is surfaced
    // as unrecognized rather than aborting the scan: one bad file must not
    // block documentation of every other mount.
    let code: string;
    try {
      code = readFileSync(filePath, "utf8");
    } catch (err) {
      const rel = relative(projectRoot, filePath).split(sep).join("/");
      unrecognized.push({
        filePath: rel,
        reason: `could not read the route file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
      continue;
    }
    const cls = classifyRouteSource(code);
    if (cls.kind === "non-nextly") continue;
    if (cls.kind === "unrecognized") {
      // Normalize to project-relative so the message reads cleanly on both OSes.
      const rel = relative(projectRoot, filePath).split(sep).join("/");
      unrecognized.push({ filePath: rel, reason: cls.reason });
      continue;
    }
    routes.push({
      filePath,
      mountPath: deriveMountPath(filePath),
      source: cls.source,
      verbs: cls.verbs,
    });
  }
  return { routes, unrecognized };
}

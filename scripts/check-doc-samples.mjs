#!/usr/bin/env node
/**
 * Compile every TypeScript sample this site publishes against the `nextly` it
 * actually depends on.
 *
 * Published code is a claim like any other, and it was the least true thing on
 * the site: every sample used `result.docs`, which the Direct API has never
 * had; every one called `getNextly()` with no config, which cannot populate the
 * registry that `find` needs; and the homepage's demo destructured `data` from
 * a result that has neither. Prose that is wrong is embarrassing. A tutorial
 * that is wrong wastes a reader's afternoon and then loses them.
 *
 * Nothing else can catch this. `check-types` compiles the site's own source,
 * and these samples are string literals to it. So they are extracted and
 * compiled as real files, against the installed package rather than a copy of
 * its API written down somewhere.
 *
 * Samples are not expected to run: they reference `./collections/Posts` and
 * other files a reader would have. Module resolution failures for relative
 * imports are therefore ignored, and nothing else is.
 *
 * Only samples that IMPORT something are compiled. The rest are fragments that
 * illustrate a shape rather than a file a reader can paste, and a bare object
 * literal is not a program: it parses as a block with labels, so compiling one
 * reports syntax errors that say nothing about whether the API is real. The
 * count of skipped fragments is printed, so the gap is visible rather than
 * quietly assumed to be zero.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * A fenced block in Markdown, or in a Markdown string inside a template literal.
 *
 * The language token may be followed by metadata on the same line, as in
 * a fence opening with `typescript title="src/db.ts"`. Requiring a newline
 * straight after the token dropped 46 of the 327 TypeScript fences in the
 * documentation without saying so, which is the failure this whole check exists
 * to prevent: a smaller number that still reads like a clean one.
 *
 * Both delimiters are LINE-ORIENTED, and the closer must be at least as long as
 * the opener, which is what Markdown itself requires. An unanchored closer
 * stopped the capture at three backticks appearing inside a string or a comment,
 * so the audit compiled a truncated sample, could report a parse error the page
 * does not have, and silently dropped the rest of the block. It also read a
 * four-backtick fence — the form a page uses when its content contains a fence —
 * as a three-backtick one.
 */
// One pattern per representation, chosen by the surface, so an escaped
// delimiter can never close a raw fence or the other way round. A single
// pattern that accepted either form read `` ```\` `` inside a comment as a
// closer and truncated the block there.
//
// `\r` is tolerated around the closer: a checkout with CRLF endings leaves one
// after the delimiter, and without this every fence but the last in such a file
// is dropped from the gate and the audit without a word.
//
// A CONTAINER PREFIX is allowed before either delimiter and stripped from the
// body. A blockquoted fence is ordinary Markdown, and `plugins/admin-ui.mdx`
// has two; anchoring on whitespace alone dropped both from the gate and the
// audit, which the loose pattern this replaced had at least found.
const RAW_FENCE =
  /(?:^|\n)([ \t]*(?:>[ \t]*)*)(```+)(\w*)[^\n]*\n([\s\S]*?)\r?\n[ \t]*(?:>[ \t]*)*\2`*[ \t\r]*(?=\n|$)/g;
const ESCAPED_FENCE =
  /(?:^|\n)([ \t]*(?:>[ \t]*)*)((?:\\`){3,})(\w*)[^\n]*\n([\s\S]*?)\r?\n[ \t]*(?:>[ \t]*)*\2(?:\\`)*[ \t\r]*(?=\n|$)/g;

/**
 * Take the blockquote markers off a body, and only when it had them.
 *
 * Stripping unconditionally would eat a `>` that opens a line of real code.
 */
const stripContainer = (body, prefix) =>
  prefix.includes(">")
    ? body
        .split("\n")
        .map(line => line.replace(/^[ \t]*>[ \t]?/, ""))
        .join("\n")
    : body;

/** Unescape what a TypeScript template literal escapes. */
const unescapeTemplate = s =>
  s.replaceAll("\\`", "`").replaceAll("\\${", "${").replaceAll("\\\\", "\\");

/** Is this sample TypeScript we can compile, rather than shell or output? */
const isTypeScript = lang =>
  lang === "typescript" || lang === "ts" || lang === "tsx";

/** JSX needs a .tsx extension or the parser reads `<` as a type argument. */
const looksLikeJsx = code => /<\/[A-Za-z]|\/>/.test(code);

export function extractFrom(kind, text, file) {
  const out = [];
  const push = (code, index, lang) => {
    const trimmed = code.trim();
    if (trimmed) out.push({ file, index, code: trimmed, lang });
  };
  if (kind === "fenced-in-template-literal" || kind === "markdown-dir") {
    // A Markdown FILE is not a template literal, so its backslashes are already
    // what the reader sees. Unescaping them anyway rewrote the source before
    // compiling it: `/\\\\/` became the unterminated `/\\/`, which reports a
    // syntax error the page does not have and takes the whole sample out of
    // semantic checking behind it.
    const literal = kind === "fenced-in-template-literal";
    for (const m of text.matchAll(literal ? ESCAPED_FENCE : RAW_FENCE)) {
      // 1 is the container prefix, 2 the delimiter, 3 the language token,
      // 4 the body.
      if (!isTypeScript(m[3])) continue;
      const body = stripContainer(m[4], m[1]);
      push(literal ? unescapeTemplate(body) : body, out.length, m[3]);
    }
  } else if (kind === "template-literal-consts") {
    // Exported const NAME = `...`; where the body is TypeScript, not Markdown.
    for (const m of text.matchAll(/export const (\w+) = `([\s\S]*?)`;/g)) {
      const code = unescapeTemplate(m[2]);
      if (/\b(import|export|const|function)\b/.test(code)) push(code, m[1]);
    }
  } else if (kind === "index-code") {
    // indexCode: "..." — a JSON-escaped single-line string.
    for (const m of text.matchAll(/indexCode:\s*("(?:[^"\\]|\\.)*")/g)) {
      try {
        push(JSON.parse(m[1]), out.length);
      } catch {
        push(m[1], out.length);
      }
    }
  }
  return out;
}

/**
 * Which extension a sample has to be compiled under.
 *
 * A fence that SAYS tsx is compiled as tsx, whatever its body looks like. The
 * two parsers disagree on more than tags: `const id = <T>(x: T) => x;` is a
 * generic arrow in a .ts file and an unclosed element in a .tsx one, so a
 * sample advertised as tsx would have been checked under rules a reader
 * pasting it never gets.
 */
export const extensionFor = sample =>
  sample.lang === "tsx" || looksLikeJsx(sample.code) ? "tsx" : "ts";

/**
 * A file the sample quotes and the reader writes: ./collections/Posts, or the
 * same reached through the `@/` alias a Next.js app sets up.
 *
 * Named on its own because the gate and the audit want different things from
 * it. The gate drops it: those files are expected to be absent. The audit keeps
 * it long enough to mark the sample UNCHECKED, because TypeScript types the
 * bindings from an unresolved module as `any`, so a wrong call through them
 * produces no diagnostic and the sample reads as clean while never having been
 * read at all — which is what the audit already says about unresolved packages.
 */
export const READER_OWNED_FILE =
  /error TS2307: Cannot find module '(?:\.{1,2}|@)\//;

/**
 * A callback parameter left implicit because the value it maps over is untyped.
 *
 * The GATE ignores it: document fields are `unknown` until `nextly
 * generate:types` has run in the reader's project, so `posts.map((post) => …)`
 * over an untyped result reports this and a reader never sees it.
 *
 * The AUDIT does not, because the same code covers a plain
 * `function parse(value) {}`, which has nothing to do with generated types and
 * does fail for a reader on the strict setup these pages advertise. Nothing in
 * the diagnostic distinguishes the two, so the audit counts them on their own
 * line instead of guessing — the same answer it gives everywhere else it cannot
 * settle a question.
 */
export const IMPLICIT_ANY_PARAMETER =
  /error TS7006: Parameter '.*' implicitly has an 'any' type/;

export const SUPPLIED_BY_THE_READER = [
  READER_OWNED_FILE,
  // Document fields are `unknown` until `nextly generate:types` has run,
  // which happens in the reader's project, not here. Everything below is
  // that one cause wearing different error codes: `unknown` assigned into
  // JSX, `unknown` narrowed to `{}` by a truthiness check, and a callback
  // parameter left implicit because the value it maps over is untyped.
  //
  // None of these can hide a wrong API. A property this package does not
  // have is TS2339 against a NAMED type, an arity mistake is TS2554, and a
  // wrong option shape is TS2322 against a named type; the checker's own
  // test pins that by feeding it `result.docs` and requiring a failure.
  /error TS(?:2322: Type 'unknown' is not assignable|18046: '.*' is of type 'unknown')/,
  /error TS2339: Property '.*' does not exist on type '\{\}'/,
  IMPLICIT_ANY_PARAMETER,
];

/**
 * A whole module a reader could paste, rather than a shape being illustrated.
 *
 * Matches the keyword alone rather than a whole single-line statement: a
 * sample whose import list wraps is still a module, and requiring
 * `import ... from` on one line quietly excused several from compilation.
 *
 * ANY export makes it a module, not only a re-export. A page that splits an
 * example across fences ends with `export default defineConfig({...})` on its
 * own, and ten fences in the current tree do exactly that. Requiring a `from`
 * filed all ten as fragments, so the API mistakes inside them were never read;
 * the missing name they open with is what the continuation pass is for.
 */
export const isModule = code =>
  /^\s*import\b/m.test(code) || /^\s*export\b/m.test(code);

/**
 * The documentation this repository owns and publishes.
 *
 * nextly-site fetches these pages and can measure them, but its copy is
 * gitignored and refetched on every build, so a fix made there is overwritten
 * by the next deploy. This is where they can actually be fixed, so this is
 * where they are gated.
 */
export function collectDocSamples() {
  const root = join(ROOT, "docs");
  if (!existsSync(root)) return null;
  // `fetch-docs.mjs` removes the destination before copying, so an interrupted
  // fetch leaves a partial tree that looks exactly like a complete one. This
  // repository already has the post-condition for that; auditing a partial tree
  // would report plausible totals that are quietly short.
  const walk = dir =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".mdx")
          ? [join(dir, e.name)]
          : []
    );
  return walk(root).flatMap(full =>
    extractFrom(
      "markdown-dir",
      readFileSync(full, "utf-8"),
      relative(ROOT, full)
    )
  );
}

/**
 * Compile a set of samples and return the diagnostics worth reading.
 *
 * Shared by the gate and the documentation audit so both judge a sample the
 * same way; two compilers with two sets of filters would disagree and the
 * disagreement would be invisible.
 */
/**
 * Compile a set of samples and return the diagnostics worth reading.
 *
 * Uses the TypeScript compiler API rather than parsing `tsc` output, for two
 * reasons that both bit an earlier version. The API separates syntactic from
 * semantic diagnostics itself, where guessing from the error code does not:
 * TS1192, "module has no default export", is semantic despite its TS1xxx code,
 * and reading it as a parse error discarded a whole sample's real findings. And
 * a diagnostic carries the file it came from, so the sample that failed to
 * parse can be set aside on its own rather than taking its whole page with it.
 *
 * Two passes, because TypeScript stops at parse errors: one sample that does
 * not parse suppresses every semantic diagnostic in the program. Measured, not
 * assumed. One malformed block in the documentation was hiding 162 findings
 * behind a report of 7, which would have read as good news.
 *
 * Shared by the gate and the documentation audit so both judge a sample the
 * same way; two compilers with two sets of filters would disagree, and the
 * disagreement would be invisible.
 */
export function compile(samples, label, ignore = SUPPLIED_BY_THE_READER) {
  const first = compileOnce(samples, label, ignore);
  if (first.unparsed.length === 0) return first.diagnostics;
  // Only the samples that failed to parse, identified by the file TypeScript
  // named, not by the page they sit on.
  const broken = new Set(first.unparsed.map(d => d.origin));
  const rest = samples.filter(s => !broken.has(`${s.file}#${String(s.index)}`));
  return [
    ...first.unparsed.map(d => d.text),
    ...compileOnce(rest, `${label}-2`, ignore).diagnostics,
  ];
}

/**
 * Give the temporary compile directory the module tree a reader would have.
 *
 * Every entry of the repository's own `node_modules` is linked, so a sample
 * naming a real third-party dependency resolves, and every publishable package
 * in this workspace is linked under the name it publishes as, so `nextly` and
 * `@nextlyhq/*` resolve to the code in this commit.
 *
 * Linked as packages rather than mapped with `paths`, because a path mapping
 * would answer for a subpath the package does not export. The exports map is
 * exactly what a sample can get wrong: three snippets in the authentication
 * guide imported `nextly/lib/env`, which is not in it, and a reader following
 * them got ERR_PACKAGE_PATH_NOT_EXPORTED. A harness that bypassed the map
 * would have called those three fine.
 */
/**
 * Refuse to judge the documentation with the packages half-built.
 *
 * Samples resolve `nextly` through its exports map, which points at `dist`. A
 * tree that is absent, or being rewritten by a concurrent build, resolves the
 * runtime entry and not its types, and TypeScript then reports every import as
 * implicitly `any`: one run mid-build produced 182 of those and called them
 * findings against the pages. The pages were not the problem, and a check that
 * names the wrong cause is worse than one that does not run.
 */
function requireBuiltPackages() {
  const types = join(ROOT, "packages", "nextly", "dist", "index.d.ts");
  if (existsSync(types)) return;
  console.error(
    "doc samples: packages/nextly/dist/index.d.ts is missing, so the samples " +
      "cannot resolve the types they are checked against.\n" +
      "  Build first: pnpm turbo build --filter='./packages/*'\n" +
      "  Nothing was checked, and no finding here would have been about the docs."
  );
  process.exit(1);
}

function linkResolutionTree(dir) {
  const modules = join(dir, "node_modules");
  mkdirSync(modules, { recursive: true });
  for (const entry of readdirSync(join(ROOT, "node_modules"))) {
    if (entry === ".bin") continue;
    symlinkSync(join(ROOT, "node_modules", entry), join(modules, entry), "dir");
  }
  // pnpm keeps type packages under `.pnpm/`, so the workspace root has no
  // `@types` at all and `types: ["node"]` resolved to nothing: every run
  // reported "Cannot find type definition file for 'node'" as though a page
  // were at fault. Taken from the package that declares the dependency, which
  // is where a reader's install would also find it.
  for (const owner of ["nextly", "admin"]) {
    const types = join(ROOT, "packages", owner, "node_modules", "@types");
    if (!existsSync(types) || existsSync(join(modules, "@types"))) continue;
    symlinkSync(types, join(modules, "@types"), "dir");
  }
  for (const dirent of readdirSync(join(ROOT, "packages"), {
    withFileTypes: true,
  })) {
    if (!dirent.isDirectory()) continue;
    const source = join(ROOT, "packages", dirent.name);
    let manifest;
    try {
      manifest = JSON.parse(
        readFileSync(join(source, "package.json"), "utf-8")
      );
    } catch {
      continue;
    }
    // A package nobody can install is not a package a sample may import.
    if (manifest.private || !manifest.name) continue;
    const target = join(modules, manifest.name);
    mkdirSync(join(target, ".."), { recursive: true });
    rmSync(target, { recursive: true, force: true });
    symlinkSync(source, target, "dir");
  }
}

function compileOnce(samples, label, ignore = SUPPLIED_BY_THE_READER) {
  const dir = mkdtempSync(join(tmpdir(), `nextly-${label}-`));
  // Flattened temp names are unreadable in a diagnostic, so keep the way back
  // to the file a person can open.
  const origin = new Map();
  const fileNames = [];
  try {
    // A counter, not the path with its punctuation replaced. That mapping is
    // not injective — `guides/foo-bar.mdx` and `guides/foo/bar.mdx` both become
    // `guides_foo_bar_mdx` — so two samples could land on one filename, the
    // second overwriting the first while both were counted as compiled. The
    // readable part is kept as a prefix, and the number makes it unique.
    let n = 0;
    for (const s of samples) {
      n += 1;
      const readable = s.file.replace(/[^\w]/g, "_");
      const full = join(
        dir,
        `${readable}__${String(s.index)}__${String(n)}.${extensionFor(s)}`
      );
      origin.set(full, `${s.file}#${String(s.index)}`);
      // `export {}` makes every file a module, whatever it contains. A file
      // with no import or export is a SCRIPT, and every script in one Program
      // shares a global scope: a declaration on one page could satisfy a
      // missing name on another, or change its inferred type, and two pages
      // declaring the same name produced clashes this then discarded as
      // harness artefacts. Appended, so no diagnostic's line number moves.
      writeFileSync(full, `${s.code}\n\nexport {};\n`);
      fileNames.push(full);
    }
    linkResolutionTree(dir);

    const program = ts.createProgram(fileNames, {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      // Named explicitly, because `typeRoots` otherwise resolves by walking up
      // from the process's directory rather than from the files being
      // compiled, and this workspace keeps type packages under `.pnpm/` with
      // no `@types` at the root. Without it every run reported "Cannot find
      // type definition file for 'node'" as a finding against the docs.
      typeRoots: [join(dir, "node_modules", "@types")],
      // Node's globals, and nothing else. These samples are Next.js and Node
      // files: they read `process.env.DATABASE_URL`, which every reader's
      // project types and this harness did not, so the audit reported `process`
      // as an error a reader would hit when the reader is the one person who
      // never sees it. Named rather than left open, because `types` with no
      // entry pulls in every @types package this site happens to install and
      // would start excusing globals a reader's project does not have.
      types: ["node"],
    });

    const render = d => {
      const where = origin.get(d.file?.fileName) ?? d.file?.fileName ?? "?";
      const line =
        d.file && d.start !== undefined
          ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
          : 0;
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      return {
        origin: where,
        text: `${where}:${String(line)}  error TS${String(d.code)}: ${message}`,
      };
    };

    const keep = d => !ignore.some(re => re.test(d.text));

    // The compiler's own complaints about its setup, which neither of the two
    // collections below carries. A production-only install without @types/node
    // reports TS2688 here and nothing anywhere else, so an otherwise simple
    // sample would compile to an empty diagnostics list and the gate would
    // report success having loaded neither the Node types it asked for nor the
    // standard library.
    const setup = [
      ...program.getOptionsDiagnostics(),
      ...program.getGlobalDiagnostics(),
    ]
      .map(render)
      .filter(keep);

    // The API's own split. Nothing here guesses from the error code.
    const unparsed = program.getSyntacticDiagnostics().map(render).filter(keep);
    const diagnostics = [
      ...setup.map(d => d.text),
      ...unparsed.map(d => d.text),
      ...program
        .getSemanticDiagnostics()
        .map(render)
        .filter(keep)
        .map(d => d.text),
    ];
    return { unparsed, diagnostics };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** An import this compilation could not resolve. */
export const UNRESOLVED_IMPORT = /error TS2307: Cannot find module '([^']+)'/;

/** An undefined name, which may or may not be a defect. */
export const MISSING_NAME = /error TS2304: Cannot find name '([^']+)'/;

/** The package part of a specifier: @nextlyhq/plugin-sdk/testing -> @nextlyhq/plugin-sdk. */
export const packageOf = specifier => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

/** The subpath part, as an exports-map key: ./testing, or "." for the root. */
export const subpathOf = specifier => {
  const pkg = packageOf(specifier);
  const rest = specifier.slice(pkg.length);
  return rest === "" ? "." : `.${rest}`;
};

/**
 * Does this exact specifier resolve for a reader?
 *
 * Two questions, not one. A docs sample importing @nextlyhq/plugin-sdk names
 * something real that this site has no reason to install, and reporting it as
 * broken would bury the genuine defects. A typo like @nextlyhq/plugin-skd names
 * nothing, and a reader hits that too. And installing a package does not make
 * an unexported subpath resolve, so @nextlyhq/plugin-sdk/typo is a defect even
 * though its package is real: the subpath is checked against the published
 * exports map, which is what Node consults.
 *
 * A registry that cannot be reached returns null, and null is counted as a
 * finding rather than read as "resolves". Silently excusing every unresolved
 * import the moment the network is down is the worse failure.
 */
/**
 * Does a pattern key answer this subpath?
 *
 * Node substitutes the `*`, and it applies the key only when the request
 * matches the text on BOTH sides of it: `./features/*` answers
 * `./features/anything` and nothing else. Reading any key that merely contains
 * a `*` as answering everything excused `pkg/not-a-feature`, which is exactly
 * the unresolvable import a reader would hit.
 */
export const patternAnswers = (key, subpath) => {
  const star = key.indexOf("*");
  if (star === -1) return false;
  const prefix = key.slice(0, star);
  const suffix = key.slice(star + 1);
  return (
    subpath.startsWith(prefix) &&
    subpath.endsWith(suffix) &&
    subpath.length >= prefix.length + suffix.length
  );
};

/**
 * What the published exports map says about one subpath: true, false, or null
 * for "this manifest cannot answer".
 *
 * A `null` TARGET is Node's way of blocking a path that a broader pattern would
 * otherwise expose, so a key matching with a null target is a refusal, not a
 * hit.
 */
/**
 * Does a target reach an ES import, or is it blocked?
 *
 * A target is a string, `null`, or a set of conditions, and the conditions can
 * nest. `{"import": null, "require": "./x.cjs"}` deliberately blocks the ESM
 * import while leaving `require` working, so a sample that writes
 * `import ... from "pkg/feature"` still fails after installing the package.
 * Reading only the outer object as non-null excused exactly that.
 *
 * These samples are ES modules, so `import` wins over `require`, and `default`
 * answers when neither is named.
 */
/**
 * The conditions an ES import in Node actually matches.
 *
 * `node-addons` is one of them under the default loader, which matters in both
 * directions: a target that blocks it first is blocked, and a package exposing
 * only that target resolves. Leaving it out excused the first and condemned the
 * second.
 *
 * `require` is deliberately absent: a target offering only `require` does not
 * answer an `import`. So is `module`, which is a bundler convention Node does
 * not resolve, and treating it as active would excuse a target Node refuses.
 */
const ACTIVE_CONDITIONS = new Set(["node-addons", "node", "import", "default"]);

export function targetReachesAnImport(target) {
  if (target === null || target === undefined) return false;
  if (typeof target === "string") return true;
  // A fallback array: the first entry that works answers.
  if (Array.isArray(target)) return target.some(targetReachesAnImport);
  if (typeof target !== "object") return false;
  // IN MANIFEST ORDER, which is the order Node applies. A fixed priority reads
  // `{ "import": "./esm.js", "node": null }` as blocked, when `import` comes
  // first and answers, so a working package would have been reported as a
  // defect. The first ACTIVE key decides, and an inactive one is skipped rather
  // than ending the search.
  for (const [condition, value] of Object.entries(target)) {
    if (ACTIVE_CONDITIONS.has(condition)) return targetReachesAnImport(value);
  }
  return false;
}

export function exportsMapAnswers(exports, subpath) {
  // `"exports": "./index.js"` is sugar for `{ ".": "./index.js" }`: the root
  // and nothing else.
  if (typeof exports === "string") return subpath === ".";
  // Without an exports map the old resolution rules apply, and those still
  // require the file to be there: `pkg/not-a-real-file` fails after installing
  // `pkg`. Deciding that needs the package's contents, which the manifest does
  // not carry, so this answers unknown rather than yes. Unknown is reported.
  if (!exports || typeof exports !== "object") return null;
  const keys = Object.keys(exports);
  // Conditions-only sugar (`{ "import": ..., "require": ... }`) describes the
  // root, so it answers the root and no subpath — and it answers the root only
  // if the conditions do. `{ "import": null, "require": "./index.cjs" }` blocks
  // an ES import of the package name itself.
  if (!keys.some(k => k.startsWith("."))) {
    return subpath === "." && targetReachesAnImport(exports);
  }
  // The root is a key like any other. A package exporting only subpaths —
  // `{ "./config": "./config.js" }` — throws ERR_PACKAGE_PATH_NOT_EXPORTED on
  // its own name, and answering the root unconditionally moved that import into
  // the excused bucket where nobody would see it.
  if (keys.includes(subpath)) return targetReachesAnImport(exports[subpath]);
  if (subpath === ".") return false;
  // Node's own precedence: the longest base before the `*` wins, and between
  // two keys with the same base the longer key wins. Sorting on the position of
  // the `*` alone leaves `"./foo/*"` and `"./foo/*.js"` in manifest order, so a
  // broad key listed first would answer a path the specific key blocks.
  const matching = keys
    .filter(k => patternAnswers(k, subpath))
    .sort((a, b) => b.indexOf("*") - a.indexOf("*") || b.length - a.length);
  if (matching.length === 0) return false;
  // A blocked pattern is a refusal, and that much the manifest can settle.
  if (!targetReachesAnImport(exports[matching[0]])) return false;
  // Matching a pattern is not proof that the file behind it exists. A key
  // substitutes text — `./*` turns `pkg/not-real` into `./dist/not-real.js` —
  // and Node still fails when nothing is there, so a typo under a wildcard
  // resolves here and throws for the reader. The manifest does not list the
  // tarball's contents, so this answers unknown, which is reported rather than
  // excused. An exact key is different: the package named that subpath itself.
  return null;
}

/**
 * How long to wait on the registry before calling the answer unknown.
 *
 * A registry that accepts the connection and then stalls has no rejection for
 * the catch below to see, and the audit is a serial loop, so one stalled
 * request holds the whole report open with nothing printed. An abort lands in
 * the same catch and is reported as unknown, which is the honest answer.
 */
export const REGISTRY_TIMEOUT_MS = 10_000;

const registryCache = new Map();
export async function resolvesForAReader(
  specifier,
  fetchImpl = fetch,
  cache = registryCache
) {
  const pkg = packageOf(specifier);
  if (!cache.has(pkg)) {
    let manifest;
    try {
      const res = await fetchImpl(
        `https://registry.npmjs.org/${pkg.replace("/", "%2f")}/latest`,
        { signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS) }
      );
      manifest = res.ok ? await res.json() : res.status === 404 ? false : null;
    } catch {
      manifest = null;
    }
    cache.set(pkg, manifest);
  }
  const manifest = cache.get(pkg);
  if (manifest === null) return null;
  if (manifest === false) return false;

  return exportsMapAnswers(manifest.exports, subpathOf(specifier));
}

/**
 * Was this name defined by an earlier block on the same page?
 *
 * Compiling each block on its own is what makes the API claims checkable, and
 * the cost is that a block picking up a variable the page declared above it
 * reports an undefined name. That is a documentation shape rather than a wrong
 * API, but only when the page really did declare it: treating every TS2304 as
 * a continuation would hide a genuine typo or a missing import, which is one of
 * the things this audit exists to find.
 */
export function declaredEarlier(name, file, index, samples) {
  return samples.some(
    s => s.file === file && s.index < index && declaresName(s.code, name)
  );
}

/**
 * Does this block declare that name?
 *
 * One implementation, used by both the question above and by
 * `inheritedNames()`. They were two regexes with different ideas of what counts,
 * and the difference was a defect: `declaredNamesIn` learned binding patterns
 * while this one still wanted an identifier straight after `const`, so a fence
 * declaring `const { nextly } = ...` was recognised as the source of `nextly`
 * and then not found when the rebuild went looking for it. The continuation was
 * never compiled.
 */
export function declaresName(code, name) {
  if (declaredNamesIn(code).includes(name)) return true;
  // An arrow or method bound without a declaration keyword: `handler: (req) =>`
  // in an object literal, or a property assignment. Not something
  // `declaredNamesIn` collects, because it is not a declaration, but a later
  // fence using the name is still continuing the page rather than inventing it.
  return new RegExp(`\\b${name}\\s*[:=]\\s*(?:async\\s*)?\\(`, "s").test(code);
}

/**
 * The names a fence declares, so a later fence can be seen to inherit them.
 *
 * Deliberately shallow: a declaration nested inside a function is not in scope
 * for the next fence, and reading one as if it were is how a missing name gets
 * excused. Anything this misses shows up as a name still missing after the
 * rebuild, which is reported rather than swallowed.
 */
export function declaredNamesIn(code) {
  const names = new Set();
  const add = n => {
    if (n) names.add(n);
  };
  // Modifiers are a run, in any order and any number: `export default async
  // function Foo`, `export abstract class Bar`, `declare const baz`. Naming only
  // `export` and `declare` lost every one of those, and the lookup this replaced
  // had found them, so unifying the two turned working pages into findings. The
  // separator after the keyword takes an asterisk so `function* gen` and
  // `function *gen` are both read.
  // Anchored at a line start OR after a semicolon, because
  // `const first = 1; const second = 2;` declares both and reading only the
  // first turned a page that was correct into a finding.
  for (const m of code.matchAll(
    /(?:^|;)[ \t]*(?:(?:export|default|declare|abstract|async)[ \t]+)*(?:const|let|var|function|class|interface|type|enum)\b[\s*]+([A-Za-z_$][\w$]*)/gm
  )) {
    add(m[1]);
  }
  // Binding patterns: `const { nextly } = await createClient()` and
  // `const [first] = rows` declare names too. Requiring an identifier straight
  // after the keyword recorded neither, so a later fence using the value looked
  // like it inherited nothing and was never compiled.
  for (const m of code.matchAll(
    /^\s*(?:export\s+)?(?:const|let|var)\s+([[{][^=]*?[\]}])\s*=/gm
  )) {
    const pattern = m[1];
    // `{ a, b: c, d = 1, ...rest }` binds a, c, d and rest; the key in `b: c`
    // is not a binding, so only what follows a colon counts.
    for (const part of pattern.replace(/^[[{]|[\]}]$/g, "").split(",")) {
      const piece = part.trim().replace(/^\.\.\./, "");
      if (!piece) continue;
      const renamed = piece.match(/:\s*([A-Za-z_$][\w$]*)/);
      add(renamed ? renamed[1] : piece.match(/^[A-Za-z_$][\w$]*/)?.[0]);
    }
  }
  // import defaults, namespaces and named bindings, with `as` aliases.
  for (const m of code.matchAll(/^\s*import\s+([^;]*?)\s+from\s/gms)) {
    // `import type { Foo }` and `import type Foo`: the keyword belongs to the
    // whole clause and is not a binding. Stripped here, before the braces
    // become commas, so that what survives inside them is only bindings.
    const clause = m[1].replace(/^type\s+/, "");
    for (const part of clause.replace(/[{}]/g, ",").split(",")) {
      // `import { type Foo }` binds Foo. Taking the first identifier recorded
      // `type` and lost the name, so a later fence using it was reported as a
      // missing name rather than rebuilt with its context: a false finding on a
      // common syntax. The keyword is dropped only when an identifier follows
      // it, because `import { type }` legally binds something called `type`.
      const piece = part.trim().replace(/^type\s+(?=[A-Za-z_$])/, "");
      if (!piece) continue;
      const alias = piece.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      add(alias ? alias[1] : piece.match(/^[A-Za-z_$][\w$]*/)?.[0]);
    }
  }
  return [...names];
}

/**
 * Which of an earlier fence's names does this one use?
 *
 * A fence that continues an example without repeating its imports is not a
 * standalone module, so compilation skipped it entirely — and
 * `api-reference/direct-api.mdx` is full of them, one calling the legacy
 * `result.docs` shape this whole check exists to catch. Compiling it alone
 * would only report the names it inherits; compiled with them, it says what it
 * does with them.
 */
export function inheritedNames(sample, samples) {
  // A continuation carries the example forward: it declares or assigns
  // something of its own. A bare expression does not, and `radio({ ... })` on a
  // field-catalogue page is a shape being illustrated, not a program a reader
  // pastes — it only looked like a continuation because it happens to mention
  // `option`, which an earlier fence imported. Compiling those reported the
  // page as full of undefined names it never claimed to define.
  if (
    !/^\s*(?:const|let|var|function|class)\s|^[^\n=]*\s=\s(?!=)/m.test(
      sample.code
    )
  ) {
    return [];
  }
  const earlier = samples.filter(
    s => s.file === sample.file && s.index < sample.index
  );
  const declared = new Set(earlier.flatMap(s => declaredNamesIn(s.code)));
  const used = new Set(
    [...sample.code.matchAll(/[A-Za-z_$][\w$]*/g)].map(m => m[0])
  );
  const own = new Set(declaredNamesIn(sample.code));
  return [...declared].filter(n => used.has(n) && !own.has(n));
}

/**
 * Rebuild a continuation block with the declarations it depends on.
 *
 * Checking that an earlier block declared the name is enough to know the
 * sample is not broken, and not enough to check what it does with it. A later
 * fence calling `adapter.connectTypo()` reports only that `adapter` is
 * undefined; with `adapter` unresolved TypeScript cannot say the member is
 * wrong, so suppressing the missing name suppressed the defect too.
 *
 * So the sample is compiled again with the earlier blocks that declare the
 * names it is missing, in page order. Only those blocks: prepending a whole
 * page would introduce duplicate declarations and report them as defects of
 * their own. The prepended line count is returned so diagnostics can be
 * reported against the reader's line numbers rather than the harness's.
 */
/**
 * Errors only this harness can produce, by joining blocks a reader reads apart.
 *
 * TS2300 is a duplicate identifier, TS2451 is a redeclared block-scoped
 * variable, and TS2528 is a second default export. All three require two blocks
 * in one file, which only happens here: a page that declares `const posts`
 * twice is showing the same example twice, and a reader meets each fence on its
 * own.
 */
export const CONCATENATION_ARTEFACT = /error TS(?:2300|2451|2528):/;

export function withEarlierContext(sample, missingNames, samples) {
  // The nearest declaring block per name, not every block that happens to
  // declare it. Pulling in several copies of the same declaration manufactures
  // duplicate-identifier errors that belong to this harness and to nobody's
  // page.
  const earlier = samples
    .filter(s => s.file === sample.file && s.index < sample.index)
    .sort((a, b) => b.index - a.index);
  const chosen = new Map();
  for (const name of missingNames) {
    const nearest = earlier.find(s =>
      declaredEarlier(name, s.file, s.index + 1, [s])
    );
    if (nearest) chosen.set(nearest.index, nearest);
  }
  const needed = [...chosen.values()].sort((a, b) => a.index - b.index);
  if (needed.length === 0) return null;
  const prefix = needed.map(s => s.code).join("\n\n");
  return {
    ...sample,
    code: `${prefix}\n\n${sample.code}`,
    prependedLines: prefix.split("\n").length + 1,
  };
}

/**
 * Sort diagnostics into what a reader would hit and what this harness caused.
 *
 * Pure and injectable so each rule can be tested on its own. Every branch here
 * was once a pattern match asserting something nobody had checked, and each of
 * those hid real defects.
 */
export async function classifyDocDiagnostics({
  diagnostics,
  samples,
  resolve = resolvesForAReader,
}) {
  const uninstalled = [];
  const continued = [];
  const real = [];
  const unchecked = [];
  // Imports of the reader's own files. Not findings, but the sample they sit in
  // was not really checked either.
  const readerFiles = [];
  // Implicit `any` on a parameter: a reader's generated types may or may not
  // answer it, and nothing in the diagnostic says which.
  const implicitAny = [];
  // A sample whose import did not resolve was not really checked: TypeScript
  // types the unresolved bindings as `any`, so a wrong call through them
  // produces no diagnostic at all. Counting such a sample as clean overstates
  // the audit, so the whole sample is named as unchecked instead.
  const uncheckedSamples = new Set();
  for (const line of diagnostics) {
    const missing = line.match(UNRESOLVED_IMPORT);
    if (missing) {
      // A file the reader writes. Neither the compiler nor the registry can see
      // it, so it is not a finding, but the rest of that sample was read
      // through bindings TypeScript had to type as `any`.
      if (READER_OWNED_FILE.test(line)) {
        readerFiles.push(line);
        uncheckedSamples.add(line.split("  ")[0].split(":")[0]);
        continue;
      }
      const resolves = await resolve(missing[1]);
      if (resolves === true) {
        uninstalled.push(line);
        uncheckedSamples.add(line.split("  ")[0].split(":")[0]);
      } else if (resolves === null) {
        unchecked.push(line);
        uncheckedSamples.add(line.split("  ")[0].split(":")[0]);
      } else {
        real.push(line);
      }
      continue;
    }
    if (IMPLICIT_ANY_PARAMETER.test(line)) {
      implicitAny.push(line);
      continue;
    }
    const name = line.match(MISSING_NAME);
    if (name) {
      const [file, idx] = line.split("  ")[0].split("#");
      const index = Number.parseInt(idx, 10);
      if (declaredEarlier(name[1], file, index, samples)) continued.push(line);
      else real.push(line);
      continue;
    }
    real.push(line);
  }
  // The summary says unknown answers are counted as findings. They were being
  // put in their own list and printed nowhere, so the code contradicted it.
  real.push(...unchecked);
  return {
    real,
    uninstalled,
    continued,
    unchecked,
    uncheckedSamples,
    readerFiles,
    implicitAny,
  };
}

/**
 * Move a context recompile's diagnostics back onto the reader's page.
 *
 * The recompiled file is the sample with earlier declarations pasted above it,
 * so its line numbers are the harness's, not the reader's, and everything above
 * the sample belongs to a block that was already compiled and judged on its
 * own. Reporting those a second time counts one defect twice and points at the
 * wrong fence.
 *
 * A diagnostic the first pass already reported is dropped for the same reason:
 * the recompile exists to surface what could not be seen before, not to repeat
 * what could.
 *
 * One thing in the prepended region is not merely a repeat, and comes back
 * named: an import that did not resolve. The declaration a sample inherited can
 * itself depend on a still-earlier fence — fence 0 imports `createAdapter`,
 * fence 1 declares `const adapter = createAdapter()`, fence 2 calls
 * `adapter.connectTypo()` — and only the nearest declaring fence is pasted in.
 * `adapter` is then typed `any`, the bad member call reports nothing, and the
 * sample reads as checked when nothing in it was read. The origins are returned
 * so the audit can name those samples unchecked, which is what it already says
 * about every other unresolved import.
 */
/** The identifier a duplicate-declaration diagnostic is about. */
export const clashingName = line =>
  line.match(/error TS(?:2300|2451|2528): [^']*'([^']+)'/)?.[1];

export function rebaseContextDiagnostics({ lines, prependedByOrigin }) {
  const out = [];
  const unresolvedInContext = new Set();
  // Names that clash because a declaration was PASTED IN. A clash the fence
  // already had with itself is the page's own defect and is reported.
  const clashesFromPasting = new Set();
  // An implicit `any` on a parameter of an INHERITED block. It says nothing
  // about whether the rebuild worked, so it must not make the sample unchecked,
  // and it is still a diagnostic somebody should see.
  const implicitAnyInContext = [];
  for (const line of lines) {
    const [where, ...rest] = line.split("  ");
    const cut = where.lastIndexOf(":");
    const origin = cut === -1 ? where : where.slice(0, cut);
    const prepended = prependedByOrigin.get(origin);
    if (prepended === undefined) {
      out.push(line);
      continue;
    }
    const lineNo = Number.parseInt(where.slice(cut + 1), 10);
    if (!Number.isFinite(lineNo) || lineNo <= prepended) {
      // An import that did not resolve, and a name that is still missing. Both
      // leave the inherited value typed `any`, which is the state that makes
      // the rebuild worthless; only the first was being caught. The pasted
      // declaration can depend on a still-earlier fence — fence 0 defines
      // `createAdapter`, fence 1 declares `const adapter = createAdapter()` —
      // and only the nearest one is pasted, so the failure is a missing NAME
      // rather than a missing module. The duplicate-identifier errors this
      // construction invents are not a reason to distrust anything.
      // ANYTHING but an artefact this construction invents. An unresolved
      // import and a missing name both leave the inherited value typed `any`;
      // a SYNTAX error in the pasted fence is worse, because `compile()` then
      // drops the whole rebuilt file from its semantic pass and the block's
      // own code is never read at all. Enumerating error codes missed that
      // third one, so the rule is the complement instead.
      if (CONCATENATION_ARTEFACT.test(line)) {
        const name = clashingName(line);
        if (name) clashesFromPasting.add(`${origin}\u0000${name}`);
      } else if (IMPLICIT_ANY_PARAMETER.test(line)) {
        implicitAnyInContext.push(line);
      } else {
        unresolvedInContext.add(origin);
      }
      continue;
    }
    out.push(`${origin}:${String(lineNo - prepended)}  ${rest.join("  ")}`);
  }
  return {
    lines: out,
    unresolvedInContext,
    clashesFromPasting,
    implicitAnyInContext,
  };
}

/**
 * What this audit compared, in one line.
 *
 * The documentation is fetched from the monorepo's `main` while this site pins
 * an exact `nextly`, and the two move independently: an API documented after
 * the pinned release reads here as a defect, and one removed after it can read
 * clean. Pinning the docs to the release would settle that and would also
 * change what a visitor reads on /docs, which is a decision about the site
 * rather than about this checker. So the report states its own basis, and a
 * finding can be weighed against it.
 */
export function auditBasis() {
  let pkg = "an unreadable nextly";
  try {
    pkg = `nextly ${String(JSON.parse(readFileSync(join(ROOT, "packages", "nextly", "package.json"), "utf-8")).version)}`;
  } catch {
    // Left as the unreadable wording: naming the version is the point, and
    // guessing one would be worse than admitting it could not be read.
  }
  return `the docs in this commit against ${pkg}`;
}

/** The page and the name a diagnostic is about: `page.mdx#3` and `adapter`. */
export const originOf = line => line.split("  ")[0].split(":")[0];
export const nameIn = line => line.match(MISSING_NAME)?.[1];

/**
 * Report on the documentation without gating on it.
 *
 * Never fails the run. These pages come from the monorepo and are overwritten
 * on the next fetch, so a red here would be a red this repository cannot clear,
 * and a check that cannot be cleared teaches people to ignore it.
 */
async function auditDocs() {
  let all;
  try {
    all = collectDocSamples();
  } catch (err) {
    console.log(
      `docs: the tree is present but incomplete, so nothing was audited.\n  ${String(err.message ?? err)}`
    );
    return;
  }
  if (all === null) {
    console.log(
      "docs: the docs/ directory is not present, so nothing was audited. " +
        "Run `node scripts/fetch-docs.mjs` first."
    );
    return;
  }
  // Only modules are COMPILED, because a bare object literal parses as a block
  // with labels and reports syntax errors that say nothing about the API. But
  // every block is SEARCHED when asking what an earlier fence declared: a page
  // that introduces a value in a fence with no import of its own, and uses it
  // in the next one, is a documentation shape, and reading it as an undefined
  // name would put a finding on the page that a reader never meets.
  const samples = all.filter(s => isModule(s.code));
  // Everything the gate ignores EXCEPT the reader's own files: those are kept
  // so the samples carrying them can be named unchecked rather than counted as
  // compiled clean.
  const AUDIT_IGNORES = SUPPLIED_BY_THE_READER.filter(
    re => re !== READER_OWNED_FILE && re !== IMPLICIT_ANY_PARAMETER
  );
  const firstPass = compile(samples, "docs", AUDIT_IGNORES);
  const { continued: continuations } = await classifyDocDiagnostics({
    diagnostics: firstPass,
    samples: all,
  });

  // A continuation is only harmless if the block does nothing wrong with what
  // it inherited, and that cannot be known while the value is unresolved. Each
  // one is compiled again with the declarations it needs.
  const byOrigin = new Map();
  for (const line of continuations) {
    const origin = line.split("  ")[0].split(":")[0];
    const name = line.match(MISSING_NAME)?.[1];
    if (name) byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), name]);
  }
  const rebuilt = [];
  // The names each rebuild was FOR, so a name that is still missing can be told
  // from an unrelated one the block simply gets wrong.
  const inheritedByOrigin = new Map();
  for (const [origin, names] of byOrigin) {
    const [file, idx] = origin.split("#");
    const sample = samples.find(
      s => s.file === file && s.index === Number.parseInt(idx, 10)
    );
    if (!sample) continue;
    const withContext = withEarlierContext(sample, names, all);
    if (withContext) {
      inheritedByOrigin.set(origin, names);
      rebuilt.push(withContext);
    }
  }

  // Fences that continue an example without repeating its imports. They are not
  // standalone modules, so nothing compiled them at all, and
  // `api-reference/direct-api.mdx` is full of them — one calling the legacy
  // `result.docs` shape this whole check exists to catch. Compiled with the
  // declarations they inherit, they say what they do with them.
  //
  // Only fences that actually use an earlier name qualify. A bare object
  // literal illustrating a shape inherits nothing and stays out, which is what
  // keeps this from compiling things that are not programs.
  const continuedWithoutImports = new Set();
  for (const sample of all) {
    if (isModule(sample.code)) continue;
    const names = inheritedNames(sample, all);
    if (names.length === 0) continue;
    const withContext = withEarlierContext(sample, names, all);
    if (!withContext) continue;
    const origin = `${sample.file}#${String(sample.index)}`;
    continuedWithoutImports.add(origin);
    inheritedByOrigin.set(origin, names);
    rebuilt.push(withContext);
  }
  const fromContext = [];
  // A name the rebuild could not resolve. Being declared earlier was only ever
  // a proxy for being available, and the proxy can be wrong: an earlier fence
  // may declare the name inside a function, or a comment may merely mention
  // `const adapter`. When the declaration is present and the name is still
  // missing, the excuse was wrong and the finding is a reader's.
  const stillMissing = [];
  // Samples whose inherited declaration itself failed to resolve something, so
  // the value they were rebuilt around is still `any` and nothing they do with
  // it was really checked.
  const notReallyRebuilt = new Set();
  // Implicit `any` seen only inside a pasted block, which no other pass reads.
  const fromInheritedBlocks = [];
  if (rebuilt.length > 0) {
    const {
      lines: rebased,
      unresolvedInContext,
      clashesFromPasting,
      implicitAnyInContext,
    } = rebaseContextDiagnostics({
      lines: compile(rebuilt, "docs-context", AUDIT_IGNORES),
      prependedByOrigin: new Map(
        rebuilt.map(s => [`${s.file}#${String(s.index)}`, s.prependedLines])
      ),
    });
    for (const origin of unresolvedInContext) notReallyRebuilt.add(origin);
    // Counted, but only the ones no compiled fence reported already: a
    // prepended MODULE was compiled on its own in the first pass, while an
    // import-free one was never compiled at all and this is the only place its
    // diagnostic appears. Matched on the message, since the location differs.
    const messageOf = line => line.split("  ").slice(1).join("  ");
    const seen = new Set(
      firstPass.filter(l => IMPLICIT_ANY_PARAMETER.test(l)).map(messageOf)
    );
    for (const line of implicitAnyInContext) {
      if (!seen.has(messageOf(line))) fromInheritedBlocks.push(line);
    }
    // Deduped against the first pass, because the recompile exists to surface
    // what could not be seen before, not to repeat what could. Except the
    // survivors above: their first-pass copy was filed as a continuation, so
    // dropping the rebuilt one as "already reported" would lose them entirely.
    const alreadyReported = new Set(firstPass);
    // Only the names the first pass EXCUSED. A sample can carry a genuine
    // undefined name beside a real continuation: the genuine one is already in
    // the actionable list, reappears here because the rebuild does not fix it,
    // and would be counted and printed a second time.
    const wasExcused = new Set(
      continuations.map(
        line => `${originOf(line)}\u0000${String(nameIn(line))}`
      )
    );
    for (const line of rebased) {
      if (MISSING_NAME.test(line)) {
        const origin = originOf(line);
        const name = String(nameIn(line));
        const inherited = (inheritedByOrigin.get(origin) ?? []).includes(name);
        if (wasExcused.has(`${origin}\u0000${name}`)) {
          // The first pass claimed an earlier block declares this name. The
          // declaration is now present and the name is still missing, so the
          // claim was wrong and the finding is a reader's.
          stillMissing.push(line);
        } else if (inherited) {
          // A name this block was rebuilt FOR, still missing: the rebuild did
          // not reconstruct the page, so the sample is named unchecked rather
          // than charged with a defect it may not have.
          notReallyRebuilt.add(origin);
        } else {
          // Neither. The block simply uses a name nothing on the page defines,
          // which is a reader's finding wherever it appears. Deduped below,
          // because a module fence would have reported it in the first pass
          // too.
          if (!alreadyReported.has(line)) fromContext.push(line);
        }
        continue;
      }
      // A reader meets each fence on its own and never concatenates them, so a
      // name declared twice ACROSS blocks, or two blocks each carrying a
      // default export, is a property of the harness rather than of the page.
      //
      // A fence that declares the same name twice WITHIN ITSELF is a different
      // thing, and an import-free one has no first pass to have reported it, so
      // discarding every duplicate hid a malformed block entirely. Only the
      // names that also clashed in the pasted region are the harness's.
      if (CONCATENATION_ARTEFACT.test(line)) {
        const name = clashingName(line);
        const pasted =
          name === undefined ||
          clashesFromPasting.has(`${originOf(line)}\u0000${name}`);
        if (pasted) continue;
        if (!alreadyReported.has(line)) fromContext.push(line);
        continue;
      }
      if (!alreadyReported.has(line)) fromContext.push(line);
    }
  }

  // One classification over everything, so a diagnostic the recompile surfaced
  // is sorted by the same rules as the rest. Pushing them straight into the
  // actionable list turned an import of a package that is published but absent
  // here — already excused in the first pass — into a reader-facing finding.
  const {
    real,
    uninstalled,
    continued,
    unchecked,
    uncheckedSamples,
    readerFiles,
    implicitAny,
  } = await classifyDocDiagnostics({
    diagnostics: [...firstPass, ...fromContext],
    samples: all,
  });

  // The survivors are actionable, and their first-pass copies stop counting as
  // continuations: the same page and the same name, whatever line each landed
  // on.
  const wrongExcuse = new Set(
    stillMissing.map(line => `${originOf(line)}\u0000${String(nameIn(line))}`)
  );
  real.push(...stillMissing);
  const stillContinued = continued.filter(
    line => !wrongExcuse.has(`${originOf(line)}\u0000${String(nameIn(line))}`)
  );
  for (const origin of notReallyRebuilt) uncheckedSamples.add(origin);

  const byFile = new Map();
  for (const line of real) {
    const file = line.split("#")[0];
    byFile.set(file, [...(byFile.get(file) ?? []), line]);
  }
  console.log(
    `\ndocs, ${auditBasis()}: ` +
      `${String(samples.length + continuedWithoutImports.size)} of ` +
      `${String(all.length)} samples compiled ` +
      `(${String(continuedWithoutImports.size)} of them fences that continue an ` +
      `earlier one without repeating its imports).\n` +
      `  ${String(real.length)} diagnostic(s) a reader would hit, across ` +
      `${String(byFile.size)} page(s).\n` +
      `  ${String(uninstalled.length)} import a package that is published but ` +
      `not installed here, which a reader would have.\n` +
      `  ${String(stillContinued.length)} use a name an earlier block on the same ` +
      `page declares, which is a documentation shape rather than a wrong API.` +
      (unchecked.length > 0
        ? `\n  of those findings, ${String(unchecked.length)} could not be ` +
          `checked against the registry and are reported rather than excused.`
        : "") +
      (implicitAny.length + fromInheritedBlocks.length > 0
        ? `\n  ${String(implicitAny.length + fromInheritedBlocks.length)} leave a parameter implicitly ` +
          `\`any\`, which a reader's generated types answer for a document ` +
          `field and do not answer for a plain function.`
        : "") +
      (readerFiles.length > 0
        ? `\n  ${String(readerFiles.length)} import a file the reader writes, ` +
          `such as ./collections/Posts, which is expected and is not a finding.`
        : "") +
      (uncheckedSamples.size > 0
        ? `\n  ${String(uncheckedSamples.size)} sample(s) had an import that ` +
          `did not resolve here, so the rest of those samples was not really ` +
          `checked: TypeScript types unresolved bindings as \`any\`.`
        : "")
  );
  // With the location, not just the message. These pages carry many fences
  // each, and several repeat the same mistake, so a bare list of messages
  // cannot be acted on without compiling every block again by hand — which
  // defeats the point of handing this to the monorepo. `#3:12` is the fourth
  // TypeScript fence on the page, line 12 within that fence.
  console.log("  locations read as #<TypeScript fence, from 0>:<line in it>");
  for (const [file, lines] of [...byFile].sort()) {
    console.log(`  ${file}`);
    for (const line of [...lines].sort()) {
      const [where, ...rest] = line.split("  ");
      const at = where.slice(where.indexOf("#"));
      console.log(`    ${at}  ${rest.join("  ")}`);
    }
  }

  // Returned as well as printed: the gate ratchets on exactly the findings this
  // report names, so a page cannot read clean here and fail there.
  return byFile;
}

/**
 * What each page is still allowed to get wrong.
 *
 * A hard gate would be red on every correct run today, because the pages
 * already carry findings, and a check that fails when nothing is wrong teaches
 * people to re-run reds instead of reading them. So the count ratchets: a page
 * may not get worse, and a page that gets better has to say so here, which is
 * how the number reaches zero and the entry disappears.
 *
 * The same shape as `eslint-bare-error-allowlist.json`, for the same reason.
 */
const BASELINE = join(ROOT, "scripts", "doc-samples-baseline.json");

const readBaseline = () => {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf-8"));
  } catch {
    return {};
  }
};

async function main() {
  // The audit's own classification, not a second cruder pass: a fence that
  // continues an earlier one, or imports a package a reader would have and this
  // checkout does not, is not something a reader meets, and counting those
  // would fill the baseline with the harness's own artefacts.
  requireBuiltPackages();
  const byFile = await auditDocs();
  const findings = [...byFile.values()].flat();
  // The build can finish or restart while this runs, so the post-condition is
  // asserted too: a workspace package reported as untyped means the tree moved
  // underneath the compile, not that a page is wrong.
  const untyped = findings.filter(line =>
    /error TS7016: Could not find a declaration file for module '(?:nextly|@nextlyhq\/)/.test(
      line
    )
  );
  if (untyped.length > 0) {
    console.error(
      `doc samples: ${String(untyped.length)} sample(s) report a workspace package as ` +
        "untyped, which means the build moved while this ran. Re-run against a " +
        "settled tree; none of these are findings about the docs."
    );
    process.exit(1);
  }
  const counted = Object.fromEntries(
    [...byFile].map(([file, lines]) => [file, lines.length])
  );

  if (process.argv.includes("--write-baseline")) {
    writeFileSync(BASELINE, `${JSON.stringify(counted, null, 2)}\n`);
    console.log(
      `doc samples: baseline written for ${String(Object.keys(counted).length)} page(s), ` +
        `${String(findings.length)} finding(s), ${auditBasis()}.`
    );
    return;
  }

  // One page at a time, for a reader working through a single file: the
  // whole-repository verdict is not useful while other pages are mid-edit, and
  // a person checking their own work should not have to read past everyone
  // else's. The baseline is still the whole repository's; only the comparison
  // narrows.
  const onlyIndex = process.argv.indexOf("--only");
  const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1];
  if (only) {
    const found = counted[only] ?? 0;
    const cap = readBaseline()[only] ?? 0;
    const lines = byFile.get(only) ?? [];
    console.log(`\n${only}: allowed ${String(cap)}, found ${String(found)}`);
    for (const line of lines) console.log(`  ${line}`);
    if (found > cap) {
      console.error("\nthis page got worse");
      process.exit(1);
    }
    if (found < cap) {
      console.log(
        `\n${String(cap - found)} fewer than the baseline: lower it to ${String(found)} ` +
          "in scripts/doc-samples-baseline.json (or remove the entry at zero)."
      );
    }
    return;
  }

  const allowed = readBaseline();
  const worse = [];
  const better = [];
  for (const [file, count] of Object.entries(counted)) {
    const cap = allowed[file] ?? 0;
    if (count > cap)
      worse.push(`${file}: allowed ${String(cap)}, found ${String(count)}`);
  }
  for (const [file, cap] of Object.entries(allowed)) {
    const count = counted[file] ?? 0;
    if (count < cap)
      better.push(`${file}: allowed ${String(cap)}, found ${String(count)}`);
  }

  if (worse.length > 0) {
    console.error(
      "\ndoc samples: these pages got worse. A sample a reader copies has to " +
        "run, so fix the finding rather than raising the number.\n"
    );
    for (const line of worse) console.error(`  ${line}`);
    for (const line of findings) {
      if (worse.some(w => line.startsWith(w.split(":")[0]))) {
        console.error(`    ${line}`);
      }
    }
    process.exit(1);
  }

  if (better.length > 0) {
    console.error(
      "\ndoc samples: these pages are better than the baseline says. Lower the " +
        "number in scripts/doc-samples-baseline.json, or remove the entry at " +
        "zero, so the gate starts protecting them.\n"
    );
    for (const line of better) console.error(`  ${line}`);
    process.exit(1);
  }

  if (process.argv.includes("--list")) {
    for (const line of findings) console.log(`  ${line}`);
  }
}

if (process.argv[1]?.endsWith("check-doc-samples.mjs")) await main();

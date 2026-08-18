import path from "path";
import { fileURLToPath } from "url";

import fs from "fs-extra";

import { buildNextConfigTemplate } from "../generators/next-config";
import type {
  DatabaseConfig,
  PackageManager,
  ProjectApproach,
  ProjectType,
} from "../types";

import { binaryRunner, scriptRunner } from "./package-manager-commands";

/**
 * Templates whose `nextly.config.ts` registers `formBuilderPlugin`. The
 * plugin (and its admin imports) only ship with these scaffolds — every
 * other template gets a leaner package.json and an admin page without the
 * plugin imports so dev never fails with "Cannot find package
 * '@nextlyhq/plugin-form-builder'".
 */
const PROJECT_TYPES_WITH_FORM_BUILDER: ReadonlySet<ProjectType> = new Set([
  "blog",
]);

/**
 * The version range every font package is scaffolded at.
 *
 * One range because they are released together, and a project mixing lines would ship two copies
 * of the same face.
 *
 * Safe to state here rather than carry per-template because the layouts import the package ROOT
 * (`@fontsource-variable/inter`) rather than a file inside it. There is no asset path that a
 * different release line could rename out from under the import, so a skew cannot produce a
 * missing-file build failure.
 *
 * What it would NOT cover, stated so the limit is visible rather than discovered: a template
 * importing a SUBPATH such as `.../wght.css`, or one needing a different MAJOR. No template does
 * either, so the range stays a constant until one does — at which point it belongs with the
 * template rather than here.
 */
const FONT_PACKAGE_RANGE = "^5.3.0";

/** Matches a font package specifier wherever a template imports one. */
const FONT_PACKAGE_PATTERN = /@fontsource(?:-variable)?\/[a-z0-9-]+/g;

/**
 * The font packages a scaffold of `projectType` actually needs.
 *
 * READ from the template sources rather than listed here. A hand-kept list is a
 * second answer to a question the templates already answer, and the two only
 * agree until someone changes a face: a template importing a package the
 * scaffold never installs fails at `next build` with a module it cannot
 * resolve, and one installing a package nothing imports ships dead bytes.
 *
 * The type's own directory is read as well as `base`'s, because a template that
 * overrides `layout.tsx` chooses its own faces — reading only `base` would
 * install Geist for a scaffold that renders in Inter.
 *
 * The caller passes the directories it is about to COPY, rather than this
 * resolving its own. A downloaded or `--local-template` source is a different
 * tree from the published one, and reading the wrong tree would install the
 * fonts of templates the project never receives.
 */
export async function collectFontDependencies(
  templateDirs: readonly string[]
): Promise<string[]> {
  const effective = await effectiveTemplateFiles(templateDirs);

  const found = new Set<string>();
  for (const file of effective.values()) {
    const contents = await fs.readFile(file, "utf8");
    for (const match of contents.matchAll(FONT_PACKAGE_PATTERN)) {
      found.add(match[0]);
    }
  }

  return [...found].sort();
}

/**
 * The files a scaffold of these template directories actually RECEIVES, keyed by their path
 * inside the project.
 *
 * Merged by relative path with the later directory winning, because that is what the copy does: a
 * template overriding `src/app/layout.tsx` REPLACES base's rather than adding to it. Taking the
 * union instead would describe a project nobody receives — a blank scaffold declaring the faces of
 * a layout that was overwritten.
 *
 * Shared rather than recomputed per question. Every property derived from "what does this scaffold
 * contain" has to agree about which files those are, and two walks written months apart would not.
 */
async function effectiveTemplateFiles(
  templateDirs: readonly string[]
): Promise<Map<string, string>> {
  const effective = new Map<string, string>();
  for (const root of templateDirs) {
    if (!root || !(await fs.pathExists(root))) continue;
    for (const file of await walkSourceFiles(root)) {
      effective.set(path.relative(root, file), file);
    }
  }
  return effective;
}

/** Where a template puts the Pagefind index builder, if it ships one. */
const SEARCH_INDEX_SCRIPT = path.join("scripts", "build-search-index.mjs");

/**
 * Whether the scaffolded PROJECT has the Pagefind index builder.
 *
 * Read from the finished project directory rather than from the templates it was assembled out
 * of, and the distinction is the whole point. A template can ship a file that the copy never
 * carries across — which is exactly what happened to the blog's `scripts/` — and a decision taken
 * from the source tree then writes a build step naming a file the project does not have.
 *
 * Asking the target makes the two impossible to disagree: whatever answers here is what `node`
 * will resolve at build time, because it is the same directory.
 *
 * Must therefore be called AFTER every copy, which is where `generatePackageJson` already sits.
 */
export async function projectHasSearchIndexScript(
  targetDir: string
): Promise<boolean> {
  return fs.pathExists(path.join(targetDir, SEARCH_INDEX_SCRIPT));
}

/**
 * Every file under `root` that could carry an import specifier.
 *
 * Async, and through the same `fs-extra` surface the rest of this module uses,
 * so a caller that substitutes the filesystem substitutes this too.
 */
async function walkSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...(await walkSourceFiles(full)));
    } else if (/\.(?:tsx?|jsx?|mjs|cjs|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function projectUsesFormBuilder(projectType: ProjectType): boolean {
  return PROJECT_TYPES_WITH_FORM_BUILDER.has(projectType);
}

/** The npm dist-tag a scaffold installs `nextly` + `@nextlyhq/*` from. */
export type NextlyDistTag = "latest" | "alpha";

/**
 * Templates that render CMS content through `nextly/runtime` cache helpers
 * (`cachedFind` / `nextlyTags`) install `nextly` + `@nextlyhq/*` from the
 * `alpha` dist-tag rather than `latest`. Those helpers ship on the active
 * alpha channel, and during the alpha the conservative `latest` tag can lag
 * behind it — a content scaffold pinned to `latest` would then install a
 * `nextly` missing the helpers its pages import, and fail to build. Non-content
 * scaffolds (blank, plugin) stay on `latest`.
 */
const CONTENT_TEMPLATE_TYPES: ReadonlySet<ProjectType> = new Set([
  "blog",
  // The plugin template installs `@nextlyhq/eslint-plugin` for the design-token
  // rules, and that package exists on `alpha` only — `latest` is the conservative
  // tag and lags the active release line. Pinned to `latest` a plugin scaffold
  // would resolve a version of it that predates the rules, exactly as a content
  // scaffold would resolve a `nextly` missing the helpers its pages import.
  "plugin",
]);

/**
 * The npm dist-tag a scaffold of `projectType` installs `nextly` + `@nextlyhq/*`
 * from: content templates track `alpha` (see {@link CONTENT_TEMPLATE_TYPES}),
 * everything else tracks `latest`.
 */
export function templateNextlyChannel(projectType: ProjectType): NextlyDistTag {
  return CONTENT_TEMPLATE_TYPES.has(projectType) ? "alpha" : "latest";
}

// ============================================================
// Text File Extensions (for placeholder replacement)
// ============================================================

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".env",
  ".md",
  ".css",
  ".html",
  ".mjs",
  ".cjs",
]);

/**
 * Files to skip during template copy.
 */
const SKIP_FILES = new Set([".DS_Store", "Thumbs.db", ".gitkeep"]);

/**
 * Files a template stores under one name and a project must receive under another, as
 * `[shipped, inProject]`.
 *
 * Two unrelated reasons converge on the same mechanism, which is why there is one table rather
 * than a rename per case:
 *
 * `.gitignore` — npm removes it from every tarball it packs, always, and with no way to opt out;
 * a `files` entry does not bring it back. A template storing it under its real name therefore
 * keeps it in a checkout — which is what `--local-template` reads, and what everyone working on
 * this repository uses — and loses it in the published CLI, which is what every user runs. The
 * consequence is not cosmetic: a scaffold writes a real `.env`, so the first `git add .` in a new
 * project commits it.
 *
 * `AGENTS.md` / `CLAUDE.md` — a coding agent reads these as instructions for whatever directory
 * it finds them in. Stored under their real names they are live instructions for THIS repository,
 * so an agent maintaining the template would follow scaffold guidance — an unresolved
 * `{{databaseDialect}}` and commands meant for a generated standalone app — instead of the
 * monorepo's own. The suffix keeps the source inert until it reaches a project.
 *
 * Storing a file under a name the tool restores on copy is what `create-next-app` and
 * `create-vite` do, for the first of those reasons.
 */
/**
 * How a restored file combines with one the project ALREADY has at that name.
 *
 * Scaffolding does not always start from an empty directory: the installer targets the current
 * directory, and it offers "ignore files and continue" on a non-empty one. So the destination can
 * hold a `.gitignore` the developer wrote, or an `AGENTS.md` full of their own notes. Replacing
 * either destroys work that the tool has no claim on — and for the guide it would also break the
 * promise the guide itself makes, that anything outside its managed block is preserved.
 *
 * Every strategy therefore keeps what is already there and adds only what the scaffold
 * contributes. None of them can remove a line the developer wrote.
 */
type MergeStrategy = "managed-block" | "append-missing-lines";

/**
 * What to do when the destination name is a link rather than a regular file.
 *
 * The two cases are opposite, and treating them alike is what makes this a per-entry choice:
 *
 * - `preserve` — writing through the link would edit its referent, which may be a shared file
 *   outside the project. The developer arranged the link deliberately; leave it and skip.
 * - `materialize` — git does NOT follow a symlinked `.gitignore` at all (it reads the link, not
 *   its target), so preserving one means the scaffold's patterns never take effect. Measured:
 *   with `.gitignore` a symlink to a file containing `.env*`, `git check-ignore -v .env` reports
 *   no match; as a regular file it matches. Since a scaffold writes a real `.env`, preserving the
 *   link would leave it committable — the exact failure this table exists to prevent. So the link
 *   is replaced by a regular file carrying its former contents plus the scaffold's, and the
 *   referent is left untouched.
 */
type LinkPolicy = "preserve" | "materialize";

/**
 * Files a template stores under one name and a project must receive under another.
 *
 * Two unrelated reasons converge on the same mechanism, which is why there is one table rather
 * than a rename per case:
 *
 * `.gitignore` — npm removes it from every tarball it packs, always, and with no way to opt out;
 * a `files` entry does not bring it back. A template storing it under its real name therefore
 * keeps it in a checkout — which is what `--local-template` reads, and what everyone working on
 * this repository uses — and loses it in the published CLI, which is what every user runs. The
 * consequence is not cosmetic: a scaffold writes a real `.env`, so the first `git add .` in a new
 * project commits it.
 *
 * `AGENTS.md` / `CLAUDE.md` — a coding agent reads these as instructions for whatever directory
 * it finds them in. Stored under their real names they are live instructions for THIS repository,
 * so an agent maintaining the template would follow scaffold guidance — an unresolved
 * `{{databaseDialect}}` and commands meant for a generated standalone app — instead of the
 * monorepo's own. The suffix keeps the source inert until it reaches a project.
 *
 * Storing a file under a name the tool restores on copy is what `create-next-app` and
 * `create-vite` do, for the first of those reasons.
 */
const RENAMED_ON_COPY: ReadonlyArray<{
  readonly shipped: string;
  readonly inProject: string;
  readonly merge: MergeStrategy;
  readonly onLink: LinkPolicy;
}> = [
  // Line-wise, because an ignore file is a set of patterns: the developer's entries stay and the
  // scaffold's missing ones are added, so `.env` ends up ignored either way.
  {
    shipped: "gitignore",
    inProject: ".gitignore",
    merge: "append-missing-lines",
    onLink: "materialize",
  },
  // The guide carries its content inside a managed block, which is exactly the region a
  // regeneration is allowed to replace.
  {
    shipped: "AGENTS.md.template",
    inProject: "AGENTS.md",
    merge: "managed-block",
    onLink: "preserve",
  },
  // One line pointing at the guide. If a project already points there, nothing to add; if it has
  // its own instructions, they keep them and gain the pointer.
  {
    shipped: "CLAUDE.md.template",
    inProject: "CLAUDE.md",
    merge: "append-missing-lines",
    onLink: "preserve",
  },
];

/** Delimits the region of a guide that a regeneration owns. */
const MANAGED_START = "<!-- nextly:managed:start -->";
const MANAGED_END = "<!-- nextly:managed:end -->";

/**
 * Replace the managed region of `existing` with the one `incoming` carries, leaving every line
 * outside it untouched.
 *
 * When `existing` has no managed region — a guide the developer wrote themselves — the block is
 * APPENDED rather than substituted for the file. Their instructions are the ones an agent should
 * read first, and the scaffold's are additional context rather than a correction.
 *
 * An unterminated region (a start marker with no end) is treated as absent. Splicing to the end of
 * the file would be the alternative, and it would delete everything the developer wrote after the
 * marker on the strength of a typo.
 */
function mergeManagedBlock(existing: string, incoming: string): string {
  const block = extractManagedBlock(incoming);
  const region = findManagedRegion(existing);

  if (!region) return `${existing.trimEnd()}\n\n${block}\n`;
  return existing.slice(0, region.start) + block + existing.slice(region.end);
}

/** Blank a matched region, preserving length and newlines so indices still line up. */
function blankRegion(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

/**
 * `text` with fenced code blocks blanked out.
 *
 * Used by the MARKER scan, which must keep reading HTML comments: the managed markers ARE HTML
 * comments, so blanking those would blind it to every real region. A marker documented inside a
 * fence is the only form of example it can encounter, because HTML comments do not nest.
 */
function withoutFencedExamples(text: string): string {
  return text.replace(
    /^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[^\n]*$/gm,
    blankRegion
  );
}

/**
 * `text` with everything that is not an ACTIVE instruction blanked out.
 *
 * Used by the include/pointer scan, which asks a different question from the marker scan and
 * therefore needs a different answer. An `@AGENTS.md` is only an include when the file's reader
 * would act on it, so three forms must not count:
 *
 * - inside a fenced block — an example of what a pointer looks like;
 * - inside an HTML comment — commented out, deliberately inert;
 * - inside an inline code span — quoted while being discussed in prose.
 *
 * HTML comments are safe to blank HERE precisely because this scan never looks for the managed
 * markers, which are themselves HTML comments.
 */
function withoutInactiveText(text: string): string {
  return withoutFencedExamples(text)
    .replace(/<!--[\s\S]*?-->/g, blankRegion)
    .replace(/`[^`\n]*`/g, blankRegion);
}

/**
 * The bounds of the LAST self-contained marker pair in `text`, or null when there is none.
 *
 * Searching from the END, and requiring the end marker to follow the start it is paired with, is
 * what keeps an unmatched marker from swallowing content. `indexOf` on each marker independently
 * pairs the FIRST start with the FIRST end, so a file carrying a stray start marker — from a
 * hand-edit, or from a previous run that appended a block below one — would have every
 * developer-written line between the two replaced on the next merge.
 *
 * Taking the last pair rather than the first also means a re-run updates the block it appended
 * previously, instead of walking further up the file each time.
 */
function findManagedRegion(
  text: string
): { start: number; end: number } | null {
  // A pair is COMPLETE when an END follows a START with no other START between them; an
  // intervening START means the first was never terminated. The region a regeneration owns is the
  // LAST complete pair, and every marker outside it is the developer's own text.
  //
  // Stated structurally rather than as "the first" or "the last" occurrence of either marker,
  // because a guide can hold an unmatched marker in any position — before the block, after it, or
  // with no partner at all — and each arrangement sends occurrence-based arithmetic to a
  // different wrong region.
  const scan = withoutFencedExamples(text);
  let cursor = 0;
  let found: { start: number; end: number } | null = null;

  for (;;) {
    const startIndex = scan.indexOf(MANAGED_START, cursor);
    if (startIndex === -1) return found;

    const after = startIndex + MANAGED_START.length;
    const endIndex = scan.indexOf(MANAGED_END, after);
    if (endIndex === -1) return found;

    const nextStart = scan.indexOf(MANAGED_START, after);
    if (nextStart !== -1 && nextStart < endIndex) {
      // Unterminated: another block opens before this one closes. Leave it to the developer and
      // keep looking from the inner start.
      cursor = nextStart;
      continue;
    }

    found = { start: startIndex, end: endIndex + MANAGED_END.length };
    cursor = found.end;
  }
}

/**
 * The managed region of `incoming`, or the whole of it when it carries no markers.
 *
 * Taking the region rather than the file keeps a merge from nesting one block inside another if a
 * template ever wraps its guide in a preamble.
 */
function extractManagedBlock(incoming: string): string {
  const start = incoming.indexOf(MANAGED_START);
  const end = incoming.indexOf(MANAGED_END);
  if (start === -1 || end === -1 || end < start) return incoming.trim();
  return incoming.slice(start, end + MANAGED_END.length);
}

/**
 * Append the lines of `incoming` that `existing` does not already contain, in order.
 *
 * TRAILING whitespace is ignored when comparing and LEADING whitespace is not, because that is
 * what git does with an ignore pattern: it strips trailing spaces unless escaped, and treats a
 * leading space as part of the pattern. So a file containing ` .env*` does NOT ignore `.env`
 * (`git check-ignore -v .env` reports no match), and treating it as equal to `.env*` would skip
 * adding the pattern that actually works — leaving the scaffold's real `.env` committable.
 *
 * Blank lines are dropped so a re-run cannot accumulate separators.
 *
 * The scaffold's lines go FIRST, and for `.gitignore` that is the whole point rather than a
 * cosmetic choice: git applies the LAST matching pattern, so appending `.env*` after a
 * deliberate `!/.env` would silently re-ignore a file the developer had un-ignored. Placing the
 * defaults above leaves every existing rule able to override them, which is the precedence a
 * developer editing their own file expects.
 */
function appendMissingLines(existing: string, incoming: string): string {
  const key = (line: string): string => line.replace(/\s+$/, "");
  // Lines inside a fenced example are text ABOUT the file, not lines of it — a guide showing
  // `@AGENTS.md` in a code block has not installed the pointer.
  const have = new Set(withoutInactiveText(existing).split("\n").map(key));
  const missing = incoming
    .split("\n")
    .filter(line => line.trim() !== "" && !have.has(key(line)));

  if (missing.length === 0) return existing;

  // A UTF-8 BOM is only a BOM at byte zero. Prepending in front of one moves it into the middle
  // of the file, where git stops stripping it and it becomes part of the developer's first
  // pattern instead — so the BOM stays put and the scaffold's lines go after it.
  const bom = existing.startsWith("\ufeff") ? "\ufeff" : "";
  const body = existing.slice(bom.length);

  // Only leading NEWLINES are dropped. `trimStart()` would take leading spaces too, and a leading
  // space is part of a git ignore pattern — it would rewrite the developer's first rule.
  return `${bom}${missing.join("\n")}\n\n${body.replace(/^\n+/, "")}`;
}

/**
 * The command tokens, which belong to the GUIDES rather than to the scaffold as a whole.
 *
 * Kept out of the map the recursive pass uses. That pass walks every file in the target, and when
 * scaffolding over an existing project the target contains the developer's files — one of which
 * may legitimately hold a literal `{{runCommand}}`, in its own template or its documentation.
 * Rendering these globally would rewrite that text.
 *
 * Only the two AGENTS.md templates use them, and those files are rendered during the
 * restore, so scoping costs nothing.
 *
 * `packageManager` is REQUIRED on the copy options, so there is no default to fall back to and
 * no path on which a guide can ship a literal `{{runCommand}}` in its command list. Widening it
 * here would reintroduce exactly that, silently, by emitting npm commands into a Yarn project.
 */
function guidePlaceholders(
  packageManager: PackageManager
): Record<string, string> {
  return {
    "{{runCommand}}": scriptRunner(packageManager),
    "{{execCommand}}": binaryRunner(packageManager),
  };
}

/**
 * Whether `incoming` is a pointer whose target resolves to `destination` itself.
 *
 * `@name` in an instruction file is an include. If the named file resolves to the file the
 * pointer is being written into, the result imports itself — an agent following it goes in a
 * circle instead of reaching a guide.
 *
 * Compared by RESOLVED path, because the case that produces this is a symlink: the two names
 * differ while denoting one file. A target that cannot be resolved answers true as well — a
 * dangling pointer installs nothing, so writing it has no upside to weigh against the risk.
 */
/**
 * How many include hops the cycle check will follow.
 *
 * Termination is bounded HERE rather than by the visited key, because the key answers a
 * different question: which arrivals are distinct. A directory symlink pointing back into the
 * project (`loop -> .`) makes the lexical directory grow without bound, so no key built from it
 * is finite — and a key made finite by canonicalising the directory collapses aliases whose
 * relative includes genuinely differ. One key cannot be both, so the hop count carries
 * termination on its own.
 *
 * Generous against real projects: an instruction file including another that includes another
 * is already unusual, and this allows far deeper. A graph that exceeds it is pathological, and
 * the conservative answer for a pathological graph is the one this returns.
 */
const MAX_INCLUDE_HOPS = 64;

async function pointsAtItself(
  targetDir: string,
  destination: string,
  incoming: string
): Promise<boolean> {
  // Nothing to trace when the incoming content includes nothing — the common case, and it must
  // not pay for a filesystem call it cannot use.
  // Depth is carried because an unresolvable name means two different things depending on where
  // it sits. At depth 0 it is the pointer this function is deciding whether to write, and a
  // pointer at nothing installs nothing. Deeper, it is a file the DEVELOPER included from a file
  // they own, and a dead end there says nothing about whether any path returns here.
  // Each entry carries the DIRECTORY its include was written in, because an `@name` is relative
  // to the file containing it. A nested `rules/team.md` holding `@../CLAUDE.md` means the sibling
  // of `rules/`, not of the project root, and rebasing every hop against `targetDir` resolves a
  // different file — which then reads as a dead end and lets a real cycle be written.
  const queue = includeTargets(incoming).map(name => ({
    name,
    depth: 0,
    from: targetDir,
  }));
  if (queue.length === 0) return false;

  const self = await fs.realpath(destination).catch(() => destination);

  // Breadth-first over the whole include graph, not one hop. The chain that closes a cycle can
  // run through files this tool never writes — `AGENTS.md` includes `RULES.md`, `RULES.md`
  // includes the absent `CLAUDE.md` — and every file in it belongs to the developer, so its
  // length is not something the scaffolder gets to bound.
  const visited = new Set<string>();

  let hops = 0;

  while (queue.length > 0) {
    // Exceeding the bound means the graph is pathological rather than merely deep. Answering
    // TRUE declines to write the pointer, which is the conservative direction: a guide that is
    // one hop further away costs a click, while a pointer that closes a cycle sends an agent in
    // circles.
    if (++hops > MAX_INCLUDE_HOPS) return true;

    const { name, depth, from } = queue.shift()!;
    const targetPath = path.resolve(from, name);

    // Reaching the file being written closes the loop, whether directly or through a chain.
    if (targetPath === destination) return true;

    const resolved = await fs.realpath(targetPath).catch(() => null);

    // ONE identity for a visited node, and it is the RESOLVED path where there is one. A
    // directory symlink pointing back into the project makes every expansion produce a new
    // spelling of one file — `loop/AGENTS.md`, `loop/loop/AGENTS.md` — which a lexical key never
    // collapses, so the queue never empties and the scaffold hangs.
    //
    // Keeping a lexical key ALONGSIDE it is what broke: on Linux a resolved path equals its
    // lexical one, so a node marked lexically was then seen as already-resolved and skipped
    // before its contents were ever read — no includes expanded, no cycle found. On macOS the
    // temporary directory resolves through `/private`, so the two never collided and the defect
    // was invisible locally. Two keys for one question, disagreeing per platform.
    // The identity of a visited node is the file AND the directory it was reached from, because
    // that pair — not the file alone — determines the edges it emits. A relative `@../CLAUDE.md`
    // resolves from the containing directory, so one file reached through two symlink aliases in
    // different directories points at two different targets; keying on the referent alone skips
    // the second alias before those edges are ever expanded.
    //
    // It still terminates. The symlink loop this guards against produces endless LEXICAL
    // spellings of one file, but only finitely many (file, directory) pairs — the directory set
    // is bounded by the real tree, which the spellings are not.
    // Identity is the resolved file paired with the LEXICAL directory it was reached from,
    // because that directory is what `path.resolve` uses for the node's outgoing edges. Two
    // aliases of one file in different directories emit different edges and must stay distinct,
    // and canonicalising the directory collapses exactly the case that matters: with
    // `alias -> ../shared-dir`, the alias arrival's `..` reaches this project while the real
    // directory's `..` does not.
    //
    // A lexical pair is not finite on its own — `loop -> .` grows `loop/loop/...` forever — so
    // termination is a separate concern, bounded by hop count below rather than by folding two
    // questions into one key. Three keys were tried before this: the referent alone (missed
    // aliases), the lexical pair (unbounded), and the canonical pair (collapsed aliases). Each
    // traded one property for the other because one key was answering both.
    const identity = `${resolved ?? targetPath}\u0000${path.dirname(targetPath)}`;
    if (visited.has(identity)) continue;
    visited.add(identity);

    if (resolved === null) {
      // A DIRECT target that does not resolve means the pointer would install nothing, so there
      // is no upside to weigh against the target appearing later. A deeper one is an ordinary
      // dead end in the developer's own graph: it cannot be the destination, because the
      // destination is a path being written, so it cannot close a cycle. Treating it as one
      // deletes a guide that nothing points back to.
      if (depth === 0) return true;
      continue;
    }
    if (resolved === self) return true;

    const contents = await fs.readFile(targetPath, "utf-8").catch(() => null);
    if (contents !== null) {
      queue.push(
        ...includeTargets(contents).map(next => ({
          name: next,
          depth: depth + 1,
          from: path.dirname(targetPath),
        }))
      );
    }
  }

  return false;
}

/**
 * The files an instruction file INCLUDES, from its `@name` lines.
 *
 * Fenced examples are excluded for the same reason the pointer scan excludes them: a guide
 * showing what an include looks like has not made one.
 */
function includeTargets(text: string): string[] {
  return withoutInactiveText(text)
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.startsWith("@") && line.length > 1)
    .map(line => line.slice(1));
}

/**
 * Give the project the real names for the files the templates ship renamed, without overwriting
 * anything the project already has at those names.
 *
 * Each entry is a no-op when the template does not carry that file, so a template without an
 * ignore file or without a guide is not given an empty one it never asked for.
 *
 * Runs BEFORE the recursive placeholder pass: the shipped suffix is not a text extension, so a
 * guide renamed afterwards would keep its `{{databaseDialect}}` unresolved. When merging into a
 * developer's file the incoming text is rendered HERE instead, because that later pass rewrites
 * whole files — it would substitute a `{{databaseDialect}}` occurring in the developer's own
 * prose, breaking the promise that text outside the managed block is left alone. A file this
 * function merged into is therefore already complete and is excluded from that pass.
 *
 * @param placeholders - substitutions to render into merged content
 * @returns project-relative names this function merged into, for the caller to skip later
 */
async function restoreShippedNames(
  targetDir: string,
  placeholders: Record<string, string>,
  packageManager: PackageManager
): Promise<Set<string>> {
  const merged = new Set<string>();
  // The restored files are the only ones that may contain command tokens, so they are the only
  // ones rendered with them.
  const forGuides = { ...placeholders, ...guidePlaceholders(packageManager) };

  for (const { shipped, inProject, merge, onLink } of RENAMED_ON_COPY) {
    const from = path.join(targetDir, shipped);
    if (!(await fs.pathExists(from))) continue;

    const to = path.join(targetDir, inProject);

    // `lstat` describes the link itself; `pathExists` follows it and answers about the target. A
    // dangling link is therefore "absent" to `pathExists` while still occupying the name, and a
    // link to a real file reads as an ordinary destination.
    const destination = await fs.lstat(to).catch(() => null);

    if (!destination) {
      // The same self-pointer check the merge path makes. A DANGLING `AGENTS.md -> CLAUDE.md`
      // leaves this branch reachable — `lstat` on `CLAUDE.md` finds nothing, so there is no
      // destination — and moving the pointer in makes that link live, pointing at the file just
      // written. The result imports itself.
      if (
        await pointsAtItself(
          targetDir,
          to,
          applyPlaceholders(await fs.readFile(from, "utf-8"), forGuides)
        )
      ) {
        await fs.remove(from);
        merged.add(inProject);
        continue;
      }
      await fs.move(from, to);
      // Rendered here rather than left to the recursive pass, which no longer carries the
      // command tokens. Recorded as done so that pass does not read it again.
      await fs.writeFile(
        to,
        applyPlaceholders(await fs.readFile(to, "utf-8"), forGuides),
        "utf-8"
      );
      merged.add(inProject);
      continue;
    }

    // Writing through a link edits whatever it points at. The arrangement that makes this
    // concrete is the common `CLAUDE.md -> AGENTS.md`: merging the pointer would append
    // `@AGENTS.md` INTO the guide that was just merged, and a link pointing outside the project
    // would let a scaffold modify a file elsewhere on the machine entirely. Measured — the write
    // lands on the target and leaves the link in place, so nothing in the project directory shows
    // that it happened.
    //
    // A HARD link is the same hazard `lstat` cannot see through: it reports a regular file,
    // because that is exactly what a hard link is. `nlink` is what separates them, an ordinary
    // file having one directory entry. Checked alongside rather than instead of the symlink test
    // — a file can only be one of the two, so neither subsumes the other. Same reasoning and the
    // same pair of checks as `writeScaffoldNpmrc`.
    //
    // Skipping means the project keeps whatever that file already says and does not receive the
    // guide. That is the right trade: the developer arranged the link deliberately, and silently
    // editing a file the project shares with something else is not this tool's decision.
    if (destination.isSymbolicLink() || destination.nlink > 1) {
      if (onLink === "materialize") {
        // Read THROUGH the link for its content, then unlink and write a regular file in its
        // place. The referent keeps whatever it held; only this project's entry stops being a
        // link, which is what git requires for the patterns to apply at all.
        // Read through the link for its content, distinguishing the two ways that can fail.
        // A DANGLING link has no referent, so there are no rules to carry and materializing
        // over it is exactly right — that is the case `lstat` selected this branch for. Any
        // other failure means a referent exists and could not be read (permissions, an
        // unexpected target type, a transient I/O error); treating that as empty would DISCARD
        // the developer's rules while reporting success, so it propagates and leaves the link
        // untouched.
        const existing = await fs
          .readFile(to, "utf-8")
          .catch((error: unknown) => {
            if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "";
            throw error;
          });
        const incoming = await fs.readFile(from, "utf-8");
        await fs.remove(to);
        await fs.writeFile(
          to,
          appendMissingLines(
            existing,
            applyPlaceholders(incoming, placeholders)
          ),
          "utf-8"
        );
        await fs.remove(from);
        merged.add(inProject);
        continue;
      }
      await fs.remove(from);
      // Recorded as untouchable, not merely un-merged. The recursive placeholder pass treats a
      // HARD link as an ordinary file — `readdir`'s Dirent reports `isFile()` for it, unlike a
      // symlink — so without this it would render `{{databaseDialect}}` through the shared inode
      // and modify a file outside the project after the merge had carefully declined to.
      merged.add(inProject);
      continue;
    }

    // The destination is the developer's file. Combine into it, then drop the shipped copy so the
    // project is not left carrying both names.
    const [existing, incoming] = await Promise.all([
      fs.readFile(to, "utf-8"),
      fs.readFile(from, "utf-8"),
    ]);
    const rendered = applyPlaceholders(incoming, forGuides);
    const combined =
      merge === "managed-block"
        ? mergeManagedBlock(existing, rendered)
        : appendMissingLines(existing, rendered);

    // A pointer that resolves back to this file makes the guide import itself. The arrangement
    // is the REVERSE link — `AGENTS.md -> CLAUDE.md` — where the guide entry is skipped as a
    // link and this entry would then add `@AGENTS.md` to the very file `AGENTS.md` resolves to.
    if (await pointsAtItself(targetDir, to, incoming)) {
      await fs.remove(from);
      merged.add(inProject);
      continue;
    }

    await fs.writeFile(to, combined, "utf-8");
    await fs.remove(from);
    merged.add(inProject);
  }

  return merged;
}

// ============================================================
// Template Path Resolution
// ============================================================

/**
 * Resolve the path to the templates directory.
 *
 * Resolution order:
 * 1. Explicit localTemplatePath (--local-template flag, for development)
 * 2. Bundled templates in the package (fallback for blank template)
 *
 * For content templates (blog, etc.), the CLI downloads templates from
 * GitHub Codeload at runtime. This function is used for bundled/local
 * template resolution only.
 *
 * @param localTemplatePath - Optional explicit path (from --local-template flag)
 */
export function resolveTemplatePath(localTemplatePath?: string): string {
  // If a local template path is explicitly provided (for development), use it
  if (localTemplatePath) {
    if (fs.existsSync(localTemplatePath)) {
      return localTemplatePath;
    }
    throw new Error(
      `Local templates directory not found at ${localTemplatePath}. Check the --local-template path.`
    );
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // From dist/ -> ../templates/ (bundled fallback in published package)
  const fromDist = path.resolve(__dirname, "../templates");
  if (fs.existsSync(fromDist)) {
    return fromDist;
  }

  // From src/utils/ -> ../../templates/ (development without build)
  const fromSrc = path.resolve(__dirname, "../../templates");
  if (fs.existsSync(fromSrc)) {
    return fromSrc;
  }

  throw new Error(
    "Could not find templates directory. Use --local-template to specify the templates path, or ensure templates are bundled."
  );
}

// ============================================================
// Placeholder Replacement
// ============================================================

/**
 * Build the placeholder map from user selections.
 */
function buildPlaceholderMap(options: {
  database?: DatabaseConfig;
  databaseUrl?: string;
  /** Plugin package name → fills `{{pluginName}}` (plugin template, D44). */
  pluginName?: string;
  /** Plugin's `nextly` compat range → fills `{{nextlyRange}}` (D44). */
  nextlyRange?: string;
}): Record<string, string> {
  const { database, databaseUrl, pluginName, nextlyRange } = options;

  const map: Record<string, string> = {};
  if (database) {
    map["{{databaseDialect}}"] = database.type;
    map["{{databaseUrl}}"] = databaseUrl || database.envExample;
  }
  if (pluginName) map["{{pluginName}}"] = pluginName;
  if (nextlyRange) map["{{nextlyRange}}"] = nextlyRange;
  return map;
}

/**
 * Replace `{{placeholder}}` markers in a file's content.
 * Only processes text files; skips binary files.
 */
async function replacePlaceholdersInFile(
  filePath: string,
  placeholders: Record<string, string>
): Promise<void> {
  const ext = path.extname(filePath).toLowerCase();
  // .env.example has no extension from extname — check basename
  const basename = path.basename(filePath);

  const isTextFile =
    TEXT_EXTENSIONS.has(ext) ||
    basename.startsWith(".env") ||
    basename === ".gitignore";

  if (!isTextFile) return;

  // A hard link shares its inode with every other name pointing at it, and `lstat` cannot tell
  // one from an ordinary file — being a regular file is exactly what a hard link is. `nlink`
  // separates them. Rewriting one would edit whatever else points there, possibly outside the
  // project, so this refuses rather than substituting.
  //
  // Scoped to the whole walk rather than to the guide: any template file the developer had
  // already hard-linked carries the same hazard, and a per-file skip list would only ever cover
  // the names someone thought of.
  const link = await fs.lstat(filePath).catch(() => null);
  if (link && link.nlink > 1) return;

  const content = await fs.readFile(filePath, "utf-8");
  const rendered = applyPlaceholders(content, placeholders);

  if (rendered !== content) {
    await fs.writeFile(filePath, rendered, "utf-8");
  }
}

/**
 * Substitute `{{placeholder}}` markers in a string.
 *
 * The single implementation of what rendering MEANS, so the recursive pass over a scaffolded
 * project and the merge into a developer's existing file cannot disagree about it.
 */
function applyPlaceholders(
  content: string,
  placeholders: Record<string, string>
): string {
  let rendered = content;
  for (const [placeholder, value] of Object.entries(placeholders)) {
    rendered = rendered.replaceAll(placeholder, value);
  }
  return rendered;
}

/**
 * Replace placeholders in all files within a directory (recursive).
 */
async function replacePlaceholders(
  dir: string,
  placeholders: Record<string, string>,
  /**
   * Names, relative to the walk's root, that are already rendered and must not be rewritten.
   *
   * A file merged into one the developer already had carries their prose as well as the
   * scaffold's, and this pass rewrites whole files — so running it over such a file would
   * substitute a `{{placeholder}}` occurring in THEIR text.
   */
  skip: ReadonlySet<string> = new Set(),
  root: string = dir
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      await replacePlaceholders(fullPath, placeholders, skip, root);
    } else if (entry.isFile()) {
      if (skip.has(path.relative(root, fullPath))) continue;
      await replacePlaceholdersInFile(fullPath, placeholders);
    }
  }
}

// ============================================================
// Package.json Generation
// ============================================================

/**
 * Pinned dependency versions for generated projects.
 *
 * `next` and `eslint-config-next` are resolved at runtime from the npm
 * registry so that fresh projects always get the latest release without
 * needing to republish create-nextly-app.  The remaining versions use
 * wide semver ranges that rarely need updating.
 */
const PINNED_VERSIONS: Record<string, string> = {
  // Next.js ecosystem — resolved at runtime via fetchLatestVersion()
  // (see generatePackageJson)
  react: "^19.1.0",
  "react-dom": "^19.1.0",
  // Dev dependencies
  typescript: "^5",
  "@types/node": "^20",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "@tailwindcss/postcss": "^4",
  tailwindcss: "^4",
  eslint: "^9",
  // Compiles `nextly.config.ts` so the dev server and the CLI can read it.
  // An optional peer of `nextly` rather than a dependency, because nothing
  // that serves a request needs it: a production install omitting dev
  // dependencies never downloads it.
  esbuild: "^0.28.1",
};

/**
 * Packages whose latest version is fetched from the npm registry at
 * runtime so the CLI always scaffolds with the newest release.
 */
const RUNTIME_RESOLVED_PACKAGES = ["next", "eslint-config-next"] as const;

/**
 * @nextlyhq packages whose latest version is fetched from npm at runtime.
 * This avoids having to republish create-nextly-app every time a
 * dependency package is updated.
 */
const NEXTLY_PACKAGES = [
  "nextly",
  "@nextlyhq/admin",
  "@nextlyhq/ui",
  "@nextlyhq/adapter-drizzle",
  "@nextlyhq/adapter-postgres",
  "@nextlyhq/adapter-mysql",
  "@nextlyhq/adapter-sqlite",
  "@nextlyhq/plugin-form-builder",
  "@nextlyhq/plugin-sdk",
  "@nextlyhq/eslint-plugin",
];

/** Cache so we only fetch once per channel per CLI run. */
const resolvedNextlyVersions = new Map<NextlyDistTag, Record<string, string>>();

/**
 * Fetch a package's version for the given dist-tag from the npm registry.
 * On any failure (non-OK response, timeout, missing tag, thrown error) it
 * returns the requested dist-tag NAME itself (e.g. "alpha") — a valid npm
 * install spec — so a content template pinned to `alpha` never silently drops
 * to `latest`, which lacks the runtime helpers its pages import.
 */
async function fetchLatestVersion(
  pkg: string,
  channel: NextlyDistTag = "latest"
): Promise<string> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/-/package/${encodeURIComponent(pkg)}/dist-tags`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return channel;
    const data = (await res.json()) as Record<string, string>;
    const version = data[channel];
    return version ? `^${version}` : channel;
  } catch {
    return channel;
  }
}

/**
 * Resolve all @nextlyhq/* package versions in parallel for the given dist-tag
 * channel. Results are cached per channel for the lifetime of the CLI process.
 */
export async function resolveNextlyVersions(
  channel: NextlyDistTag = "latest"
): Promise<Record<string, string>> {
  const cached = resolvedNextlyVersions.get(channel);
  if (cached) return cached;

  const entries = await Promise.all(
    NEXTLY_PACKAGES.map(
      async pkg => [pkg, await fetchLatestVersion(pkg, channel)] as const
    )
  );
  const versions = Object.fromEntries(entries);
  resolvedNextlyVersions.set(channel, versions);
  return versions;
}

/** Cache for runtime-resolved package versions (next, eslint-config-next). */
let resolvedRuntimeVersions: Record<string, string> | null = null;

/**
 * Resolve latest versions for Next.js ecosystem packages in parallel.
 * Falls back to a safe semver range if the registry is unreachable.
 */
async function resolveRuntimeVersions(): Promise<Record<string, string>> {
  if (resolvedRuntimeVersions) return resolvedRuntimeVersions;

  const FALLBACKS: Record<string, string> = {
    next: "^16.1.0",
    "eslint-config-next": "^16.1.0",
  };

  const entries = await Promise.all(
    RUNTIME_RESOLVED_PACKAGES.map(async pkg => {
      const version = await fetchLatestVersion(pkg);
      return [pkg, version === "latest" ? FALLBACKS[pkg] : version] as const;
    })
  );

  resolvedRuntimeVersions = Object.fromEntries(entries);
  return resolvedRuntimeVersions;
}

/**
 * Generate a `package.json` string for a fresh Nextly project.
 *
 * Fetches latest @nextlyhq/* versions from npm so you don't need to
 * republish create-nextly-app when other packages are updated.
 *
 * @param projectName - The project name (used as package name)
 * @param database - Database configuration (adapter + driver)
 * @param useYalc - When true, omits @nextlyhq/* packages (they'll be yalc-added)
 * @param projectType - Selected template. Determines optional plugin deps
 *   (e.g. `@nextlyhq/plugin-form-builder` ships only with `blog`).
 * @param templateDirs - The directories being copied for this scaffold. The
 *   font packages are read from these, so they match the templates the project
 *   actually receives.
 */
export async function generatePackageJson(
  projectName: string,
  database: DatabaseConfig,
  useYalc: boolean = false,
  projectType: ProjectType = "blank",
  templateDirs: readonly string[] = [],
  /**
   * The project directory, once every copy has finished.
   *
   * Decides the Pagefind build step, which has to be settled against what the project HAS rather
   * than what its templates ship — see {@link projectHasSearchIndexScript}. Omitting it means
   * "there is no project on disk to ask", and no search step is emitted.
   */
  targetDir?: string
): Promise<string> {
  // Plugins are a publishable library, not an app — different package.json.
  if (projectType === "plugin") {
    return generatePluginPackageJson(
      projectName,
      useYalc,
      templateNextlyChannel(projectType)
    );
  }

  // Fetch latest Next.js (and eslint-config-next) version from npm
  const runtimeVersions = await resolveRuntimeVersions();

  const dependencies: Record<string, string> = {
    next: runtimeVersions.next,
    react: PINNED_VERSIONS.react,
    "react-dom": PINNED_VERSIONS["react-dom"],
  };

  // @tanstack/react-query is externalized from admin bundle to avoid duplicate
  // instances - must be installed in the consumer project
  dependencies["@tanstack/react-query"] = "^5.62.0";

  // @nextlyhq/ui declares lucide-react as a peer, so the consumer project has
  // to provide it. Admin bundles its own copy, which does not satisfy that peer
  // under isolated node_modules layouts.
  dependencies["lucide-react"] = "^0.544.0";

  // The faces the template's own layout imports. Scaffolded as dependencies
  // because the layout loads them from `node_modules` rather than fetching them
  // from fonts.googleapis.com, which made every `next build` — including the
  // one a CI run does before its browser tests — depend on reaching a third
  // party, and fail behind a proxy or offline.
  for (const font of await collectFontDependencies(templateDirs)) {
    dependencies[font] = FONT_PACKAGE_RANGE;
  }

  if (!useYalc) {
    // Content templates (blog) track the `alpha` dist-tag so they always get a
    // nextly that has the `nextly/runtime` cache helpers their pages import;
    // other scaffolds track `latest`.
    const versions = await resolveNextlyVersions(
      templateNextlyChannel(projectType)
    );
    dependencies["nextly"] = versions["nextly"];
    dependencies["@nextlyhq/admin"] = versions["@nextlyhq/admin"];
    dependencies["@nextlyhq/ui"] = versions["@nextlyhq/ui"] || "latest";
    dependencies["@nextlyhq/adapter-drizzle"] =
      versions["@nextlyhq/adapter-drizzle"];
    dependencies[database.adapter] = versions[database.adapter] || "latest";
    // Form builder plugin is only included for templates that register
    // it in nextly.config.ts (currently just `blog`). Including it in
    // the blank scaffold would leave imports in the admin page that
    // resolve to an uninstalled package — `next dev` would then fail
    // with "Cannot find package '@nextlyhq/plugin-form-builder'".
    if (projectUsesFormBuilder(projectType)) {
      dependencies["@nextlyhq/plugin-form-builder"] =
        versions["@nextlyhq/plugin-form-builder"] || "latest";
    }
  }

  // drizzle-orm is pinned EXACTLY in the scaffold: Nextly requires 1.0.0-rc.4
  // and a user's `pnpm add drizzle-orm` would resolve npm `latest` (an older
  // line), silently breaking Drizzle's cross-instance is() checks the first
  // time they write a custom query. Pinning it here makes the required
  // version visible and correct from day one. Must match
  // scripts/drizzle-version.cjs.
  dependencies["drizzle-orm"] = "1.0.0-rc.4";

  // DB drivers are regular deps of their respective adapter packages and
  // will be installed as transitive deps. No need to list them here.

  const devDependencies: Record<string, string> = {
    typescript: PINNED_VERSIONS.typescript,
    "@types/node": PINNED_VERSIONS["@types/node"],
    "@types/react": PINNED_VERSIONS["@types/react"],
    "@types/react-dom": PINNED_VERSIONS["@types/react-dom"],
    "@tailwindcss/postcss": PINNED_VERSIONS["@tailwindcss/postcss"],
    tailwindcss: PINNED_VERSIONS.tailwindcss,
    eslint: PINNED_VERSIONS.eslint,
    "eslint-config-next": runtimeVersions["eslint-config-next"],
    // Declared HERE rather than inherited: `nextly` takes esbuild as an
    // optional peer, so nothing installs it on a project's behalf. Without it
    // the dev server cannot read `nextly.config.ts`.
    esbuild: PINNED_VERSIONS.esbuild,
  };

  // Read from the project that was just assembled, so the generated script can only name a
  // file that is actually there.
  const shipsSearchIndex = targetDir
    ? await projectHasSearchIndexScript(targetDir)
    : false;

  // Pagefind builds the static index behind /search. DECLARED only where the
  // builder ships, because the index script invokes it through `node`, which
  // resolves from node_modules — an undeclared dependency that happens to be
  // fetched on demand by some other route would build here and fail for a user
  // whose registry or network says otherwise.
  if (shipsSearchIndex) devDependencies.pagefind = "^1.1.0";

  // NOTE: the build-script allowlist (better-sqlite3, sharp, esbuild,
  // unrs-resolver) is NOT emitted here. pnpm 11 no longer reads the `pnpm`
  // field from package.json — it warns and ignores it. The allowlist now
  // lives in pnpm-workspace.yaml (see generatePnpmWorkspaceYaml), which
  // copyTemplate writes alongside this file.
  const pkg = {
    name: projectName,
    version: "0.1.0",
    private: true,
    scripts: {
      // Dev boots Nextly in single-process mode via `next dev`. The lazy
      // per-dialect drizzle-kit import plus the in-process HMR listener
      // replaced the wrapper that previously owned the terminal, schema
      // prompts, and child supervision. `nextly dev` is gone; the only
      // supported dev command is the standard `next dev`.
      dev: "next dev --turbopack",
      // Build: migrate the database, compile Next.js, and generate the Pagefind
      // search index for the templates that ship its builder.
      //
      // Whether that last step appears is decided HERE, from the files the
      // scaffold actually received, rather than by a shell conditional in the
      // script. Two reasons, and both were live:
      //
      // `npm run` uses cmd.exe on Windows, which has no `test` and no `true` —
      // so the `(test -f … || true)` form this replaces failed for every Windows
      // user, after `next build` had already succeeded. `&&` is all that remains,
      // and cmd.exe understands it.
      //
      // And `|| true` turned a failed index build into a successful one. The
      // search page then ships pointing at an index that was never written,
      // which fails in the browser rather than in CI.
      build: shipsSearchIndex
        ? "nextly migrate && next build && node scripts/build-search-index.mjs"
        : "nextly migrate && next build",
      // Offered only where the file exists. A script that always fails is worse
      // than an absent one: it reads as a supported command.
      ...(shipsSearchIndex
        ? { "search:index": "node scripts/build-search-index.mjs" }
        : {}),
      start: "next start",
      lint: "next lint",
      nextly: "nextly",
      // First-time setup: sync schema + seed system permissions. Demo
      // content is seeded separately from the admin UI (visit /welcome
      // after running `pnpm dev` and completing /admin/setup).
      "db:setup": "nextly db:sync",
      "db:migrate": "nextly migrate",
      "db:migrate:status": "nextly migrate:status",
      // No `db:migrate:reset`: `nextly migrate:reset` is not a command the CLI
      // registers, so the script it generated failed for every scaffolded
      // project. `migrate:fresh` is the one that drops all tables and re-runs
      // the migrations, and it is already exposed above.
      "db:migrate:fresh": "nextly migrate:fresh",
      "types:generate": "nextly generate:types",
    },
    dependencies,
    devDependencies,
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

/**
 * Resolve the `nextly` compat range a scaffolded plugin declares + uses to fill
 * `{{nextlyRange}}`. Uses the latest published `nextly` (`^x.y.z`); falls back to
 * an open range when offline / using yalc.
 */
async function resolvePluginNextlyRange(useYalc: boolean): Promise<string> {
  if (useYalc) return ">=0.0.0";
  const versions = await resolveNextlyVersions();
  const v = versions["nextly"];
  return v && v !== "latest" ? v : ">=0.0.0";
}

/**
 * Generate `package.json` for a scaffolded plugin (D44). A publishable library:
 * `dist/` ships (the embedded `dev/` playground does not — `files: ["dist"]`),
 * nextly/admin/sdk/react are peers, and devDeps cover build + test + the dev app.
 */
async function generatePluginPackageJson(
  projectName: string,
  useYalc: boolean,
  /**
   * The dist-tag every `nextly` + `@nextlyhq/*` range resolves from.
   *
   * Passed in rather than defaulted here, because a default would be a second
   * answer to a question {@link templateNextlyChannel} already owns, and the
   * two would agree only until the routing changed. A plugin resolved from
   * `latest` installs `@nextlyhq/eslint-plugin`'s 0.0.0 bootstrap placeholder,
   * which has no `main` and no `exports` — so the scaffold succeeds and the
   * author's first `pnpm lint` fails on the config that imports it.
   */
  channel: NextlyDistTag
): Promise<string> {
  const versions = useYalc ? {} : await resolveNextlyVersions(channel);
  const runtimeVersions = await resolveRuntimeVersions();
  /*
   * The fallback is the TEMPLATE's channel rather than `latest`.
   *
   * `--use-yalc` empties the version map on purpose, so every range here falls
   * back to a bare dist-tag — and the yalc installer then links a FIXED list
   * (`nextly`, admin, ui, the adapters, the template's plugins) that does not
   * include `@nextlyhq/eslint-plugin`. Whatever this names for a package
   * outside that list is what the author actually installs, and on `latest`
   * that is the 0.0.0 bootstrap placeholder: it has no `main` and no
   * `exports`, so the install succeeds and `pnpm lint` fails on the config
   * that imports it.
   */
  const range = (pkg: string): string => versions[pkg] ?? channel;

  const peerDependencies: Record<string, string> = {
    nextly: range("nextly"),
    "@nextlyhq/admin": range("@nextlyhq/admin"),
    "@nextlyhq/plugin-sdk": range("@nextlyhq/plugin-sdk"),
    // The UI kit is supplied by the host admin at run time, so a plugin must
    // declare it rather than carry a copy. As a devDependency alone, tsup
    // treats it as bundleable and inlines the whole kit into the published
    // plugin — first-party plugins declare it as a peer for this reason.
    "@nextlyhq/ui": range("@nextlyhq/ui"),
    react: PINNED_VERSIONS.react,
    "react-dom": PINNED_VERSIONS["react-dom"],
  };

  // devDeps cover: build (tsup/tsc), test (vitest), lint (eslint), AND the
  // embedded dev/ playground (next + nextly + admin + sqlite adapter).
  const devDependencies: Record<string, string> = {
    nextly: range("nextly"),
    "@nextlyhq/admin": range("@nextlyhq/admin"),
    "@nextlyhq/ui": range("@nextlyhq/ui"),
    "@nextlyhq/plugin-sdk": range("@nextlyhq/plugin-sdk"),
    "@nextlyhq/adapter-drizzle": range("@nextlyhq/adapter-drizzle"),
    "@nextlyhq/adapter-sqlite": range("@nextlyhq/adapter-sqlite"),
    next: runtimeVersions.next,
    react: PINNED_VERSIONS.react,
    "react-dom": PINNED_VERSIONS["react-dom"],
    "better-sqlite3": "^12.0.0",
    "@types/node": PINNED_VERSIONS["@types/node"],
    "@types/react": PINNED_VERSIONS["@types/react"],
    "@types/react-dom": PINNED_VERSIONS["@types/react-dom"],
    typescript: PINNED_VERSIONS.typescript,
    tsup: "^8.5.0",
    vitest: "^4.1.0",
    eslint: PINNED_VERSIONS.eslint,
    "@eslint/js": PINNED_VERSIONS.eslint,
    "typescript-eslint": "^8.0.0",
    // The design-token rules the admin holds itself to. Shipped to the author
    // rather than documented at them: a rule that runs only in Nextly's own
    // repository governs the first-party plugins and nothing anyone else builds.
    "@nextlyhq/eslint-plugin": range("@nextlyhq/eslint-plugin"),
  };

  const pkg = {
    name: projectName,
    version: "0.1.0",
    description: "A Nextly plugin.",
    type: "module",
    main: "./dist/index.mjs",
    module: "./dist/index.mjs",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.mjs",
      },
      "./admin": {
        types: "./dist/admin/index.d.ts",
        import: "./dist/admin/index.mjs",
      },
    },
    // Only the built library ships. The dev/ playground is never published.
    files: ["dist"],
    keywords: ["nextly", "nextly-plugin"],
    scripts: {
      build: "tsup",
      // Runs the embedded playground (next dev with dev/ as the project root).
      dev: "next dev dev --turbopack",
      "check-types": "tsc --noEmit",
      lint: "eslint .",
      test: "vitest run",
      "types:generate": "nextly generate:types",
    },
    peerDependencies,
    devDependencies,
    // Native build-script allowlist is NOT emitted here: pnpm 11 ignores the
    // package.json `pnpm` field. It lives in pnpm-workspace.yaml instead (written
    // by copyPluginTemplate via generatePnpmWorkspaceYaml).
  };

  return JSON.stringify(pkg, null, 2) + "\n";
}

// ============================================================
// pnpm-workspace.yaml Generation
// ============================================================

/**
 * Native dependencies whose install/build scripts must be allow-listed so
 * pnpm 10+ actually compiles them. npm and yarn run these by default.
 *
 * Without the allowlist, `pnpm install` aborts with ERR_PNPM_IGNORED_BUILDS
 * on pnpm 11, better-sqlite3 never gets a compiled binding (sqlite apps crash
 * at boot), and sharp/esbuild/unrs-resolver silently degrade to slow paths.
 *
 * better-sqlite3 is always included: it's a direct dependency only for sqlite
 * scaffolds, but the --use-yalc dev flow installs every adapter (so a
 * postgres/mysql yalc scaffold still pulls and must build better-sqlite3), and
 * allow-listing a package that isn't installed is a harmless no-op.
 */
export const NATIVE_BUILD_DEPENDENCIES = [
  "better-sqlite3",
  "esbuild",
  "sharp",
  "unrs-resolver",
] as const;

/**
 * Generate the `pnpm-workspace.yaml` for a scaffolded project.
 *
 * pnpm 10+ blocks dependency build scripts by default and the allowlist's
 * home changed across versions:
 *   - pnpm 11+ reads `allowBuilds` (a map of package -> boolean) and no longer
 *     reads the `pnpm` field from package.json at all.
 *   - pnpm 10.6+ reads `onlyBuiltDependencies` (an array; deprecated in 11).
 *
 * Both keys are emitted so native deps compile on any pnpm 10.6+/11. npm and
 * yarn ignore the file entirely, and pnpm 9 runs build scripts by default, so
 * it is safe to ship in every scaffold regardless of package manager.
 *
 * `packages` is emitted for pnpm 9 specifically. Before pnpm repurposed this
 * file as the general settings home, its mere presence declared a workspace
 * and a missing `packages` key was fatal:
 *
 *   ERR_PNPM_INVALID_WORKSPACE_CONFIGURATION  packages field missing or empty
 *
 * so a scaffold shipping the allowlist alone could not be installed at all on
 * those versions.
 *
 * Measured, installing the file exactly as generated: 8.15.9, 9.0.0, 9.0.6,
 * 9.1.0, 9.2.0 and 9.3.0 all refuse it; 9.4.0, 9.7.0, 9.15.9, 10.5.2, 10.6.1,
 * 10.18.3 and 11.0.0 all accept it with or without the key. So the affected
 * range is pnpm 8 through 9.3 — which includes the 9.0.0 this repository pins,
 * and therefore the pnpm a contributor following the setup instructions has.
 *
 * The empty list is the honest value — a scaffolded app has no workspace
 * members — and it leaves `pnpm add` behaving normally, which declaring the
 * project's own root as a member would also have done but with a claim about
 * the layout that is not true.
 */
export function generatePnpmWorkspaceYaml(): string {
  const allowBuilds = NATIVE_BUILD_DEPENDENCIES.map(
    dep => `  ${dep}: true`
  ).join("\n");
  const onlyBuilt = NATIVE_BUILD_DEPENDENCIES.map(dep => `  - ${dep}`).join(
    "\n"
  );

  return (
    "# Allow native dependencies to run their build scripts. pnpm 10+ blocks\n" +
    "# dependency build scripts by default; without this better-sqlite3 has no\n" +
    "# compiled binding (sqlite apps crash at boot) and sharp/esbuild degrade.\n" +
    "#\n" +
    "# pnpm 11+ reads `allowBuilds`; pnpm 10.6+ reads `onlyBuiltDependencies`.\n" +
    "# npm and yarn ignore this file; pnpm 9 needs neither key, because it runs\n" +
    "# build scripts by default.\n" +
    "#\n" +
    "# It does still READ the file, which is what the empty `packages` list is\n" +
    "# for: through pnpm 9.3 the presence of this file declares a workspace, and\n" +
    "# a missing `packages` key fails the install outright. This app has no\n" +
    "# workspace members.\n" +
    "packages: []\n" +
    `allowBuilds:\n${allowBuilds}\n` +
    `onlyBuiltDependencies:\n${onlyBuilt}\n`
  );
}

/**
 * Generate the `.npmrc` for a scaffolded project, or `null` when it needs none.
 *
 * Written only for pnpm scaffolds, and only to undo a side effect of shipping
 * `pnpm-workspace.yaml`: through pnpm 9.3 the presence of that file makes the
 * project a workspace ROOT, so an ordinary
 *
 *     pnpm add zod
 *
 * is refused with `ERR_PNPM_ADDING_TO_ROOT` and a suggestion to pass `-w`. The
 * check exists to stop a dependency landing in a monorepo's root instead of the
 * package that wanted it; a scaffolded app has no other package, so there is
 * nothing for it to protect and it only obstructs.
 *
 * Measured: 9.0.0 refuses `pnpm add` without this and accepts it with; 10.18.3
 * and 11.0.0 accept it either way. Two alternatives were measured and rejected —
 * declaring the root as a member (`packages: ["."]`) is refused identically, and
 * the same setting written into `pnpm-workspace.yaml` is not read by pnpm 9 at
 * all, since that file only became the settings home in 10.6.
 *
 * NOT written for npm, yarn or bun, which is the whole reason this is a separate
 * function rather than an unconditional file: npm reads `.npmrc` too and prints
 *
 *     npm warn Unknown project config "ignore-workspace-root-check".
 *     This will stop working in the next major version of npm.
 *
 * on every command. A permanent warning for the majority is a poor trade for a
 * setting they cannot use.
 *
 * The residual gap, stated rather than left to be discovered: a project
 * scaffolded with npm and later opened with pnpm 9.3 or older still meets
 * `ERR_PNPM_ADDING_TO_ROOT`. That error names its own remedy, and the affected
 * pnpm range is closed and shrinking.
 */
export function generateNpmrc(packageManager: PackageManager): string | null {
  if (packageManager !== "pnpm") return null;

  return (
    "# This project is a single package, not a monorepo. pnpm 9 treats the\n" +
    "# pnpm-workspace.yaml shipped for its build allowlist as declaring a\n" +
    "# workspace root, which makes `pnpm add <pkg>` demand a -w flag. There is no\n" +
    "# other package here for that check to protect.\n" +
    `${NPMRC_WORKSPACE_ROOT_KEY}=true\n`
  );
}

/** The setting {@link generateNpmrc} exists to add, named once so the writer can look for it. */
const NPMRC_WORKSPACE_ROOT_KEY = "ignore-workspace-root-check";

/**
 * Give a scaffolded project the `.npmrc` its package manager needs, WITHOUT destroying one that
 * is already there.
 *
 * Appends rather than writes. A scaffold does not always land on an empty directory — the CLI
 * can overlay an existing project, and a `--local-template` can carry its own `.npmrc` — and that
 * file is where private registries, auth tokens, proxies and `node-linker` live. Replacing it
 * would break the install that runs moments later, and would do it by pointing at the wrong
 * registry rather than by failing loudly.
 *
 * An existing declaration of the key WINS, whatever its value. Someone who has written
 * `ignore-workspace-root-check=false` on purpose means it, and a scaffold is not the right place
 * to overrule them.
 *
 * One helper for both scaffold types, because two copies of "write this file" drift: a correction
 * to the app path that misses the plugin path is invisible until someone scaffolds a plugin.
 */
async function writeScaffoldNpmrc(
  targetDir: string,
  packageManager: PackageManager
): Promise<void> {
  const addition = generateNpmrc(packageManager);
  if (!addition) return;

  const npmrcPath = path.join(targetDir, ".npmrc");

  // A SYMLINK here is left completely alone. Reading and writing it back would follow the link
  // and append to whatever it points at — commonly a shared or home-directory config — so a
  // scaffold would silently edit settings belonging to every other project on the machine.
  // `lstat` reports the link itself rather than its target, which is the only way to see this:
  // `pathExists` and `readFile` both resolve it and report the referent as though it were here.
  //
  // Skipping means a pnpm 9 user with a linked `.npmrc` still meets ERR_PNPM_ADDING_TO_ROOT on
  // their first `pnpm add`. That error names its own remedy; silently rewriting a file outside
  // the project does not, and is not the scaffolder's to make.
  const link = await fs.lstat(npmrcPath).catch(() => null);
  if (link?.isSymbolicLink()) return;

  // A HARD link is the same hazard wearing a disguise `lstat` cannot see through: it reports a
  // regular file, because that is exactly what a hard link is. The shared config and the path
  // here are one inode, so appending would edit every project pointing at it.
  //
  // `nlink` is what separates them — an ordinary file has one directory entry. Checked after the
  // symlink test rather than instead of it: the two are different relationships and a file can
  // only be one of them, so neither check subsumes the other.
  if (link && link.nlink > 1) return;

  const existing = link ? await fs.readFile(npmrcPath, "utf-8") : "";

  // Matched at the start of a line so a value mentioning the key, or a commented-out example,
  // is not read as a declaration.
  const alreadyDeclared = new RegExp(
    `^\\s*${NPMRC_WORKSPACE_ROOT_KEY}\\s*=`,
    "m"
  ).test(existing);
  if (alreadyDeclared) return;

  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  await fs.writeFile(npmrcPath, existing + separator + addition, "utf-8");
}

// ============================================================
// Copy Template (Main Orchestrator)
// ============================================================

export interface CopyTemplateOptions {
  projectName: string;
  projectType: ProjectType;
  targetDir: string;
  database: DatabaseConfig;
  databaseUrl?: string;
  useYalc?: boolean;
  /** Schema approach for content templates (code-first, visual) */
  approach?: ProjectApproach;
  /** Explicit paths to base and template directories (from download or --local-template) */
  templateSource?: { basePath: string; templatePath: string };
  /**
   * The package manager the project will be installed with, which decides
   * whether a `.npmrc` is written — see {@link generateNpmrc}.
   *
   * REQUIRED, and deliberately so. As an optional field defaulting to npm, the
   * CLI's one line wiring the detected manager through could be deleted and
   * every scaffold would silently lose its `.npmrc` — a default is a decision
   * made for a caller that never stated one, and here the wrong decision is
   * indistinguishable from the right one until a user runs `pnpm add`. Required
   * makes that deletion a compile error instead of something a test has to
   * notice.
   */
  packageManager: PackageManager;
  /**
   * Suppress the internal "directory already exists" guard. Set by the
   * installer when it has already negotiated a directory conflict with
   * the user (cwd install, or the "remove"/"ignore" choices from the
   * directory-conflict prompt).
   */
  allowExistingTarget?: boolean;
}

/**
 * Copy templates to the target directory, handle approach-specific config,
 * seed files, and placeholder replacement.
 *
 * Steps:
 * 1. Copy base template -> targetDir
 * 2. Copy template src/ (frontend pages, components) -> targetDir
 * 3. Copy approach-specific config as nextly.config.ts
 * 4. Copy seed files if demo data selected
 * 5. Remove base page.tsx if template has (frontend) route group
 * 6. Generate package.json
 * 7. Replace placeholders in all text files
 */
export async function copyTemplate(
  options: CopyTemplateOptions
): Promise<void> {
  const {
    projectName,
    projectType,
    targetDir,
    database,
    databaseUrl,
    useYalc = false,
    approach,
    templateSource,
    packageManager,
    allowExistingTarget = false,
  } = options;

  // Guard against silently overwriting an existing subdirectory. Skip
  // when targeting cwd (the installer handles emptiness checks there)
  // or when the installer explicitly opted in via allowExistingTarget
  // (after a user-confirmed remove/ignore choice).
  if (
    !allowExistingTarget &&
    targetDir !== process.cwd() &&
    (await fs.pathExists(targetDir))
  ) {
    throw new Error(
      `Directory "${path.basename(targetDir)}" already exists. Please choose a different name.`
    );
  }

  // Resolve template paths - either from explicit source or local resolution
  let baseDir: string;
  let typeDir: string;

  if (templateSource) {
    // Paths provided by download or --local-template resolution
    baseDir = templateSource.basePath;
    typeDir = templateSource.templatePath;
  } else {
    // Fall back to bundled templates (for blank template or development)
    const templatesRoot = resolveTemplatePath();
    baseDir = path.join(templatesRoot, "base");
    typeDir = path.join(templatesRoot, projectType);
  }

  // Plugins are a self-contained library scaffold (src/ + embedded dev/), not an
  // app — no base app, no next.config/.env generation, no frontend page. Copy
  // the plugin tree as-is, generate its package.json, fill placeholders, done.
  if (projectType === "plugin") {
    await copyPluginTemplate({
      projectName,
      typeDir,
      targetDir,
      useYalc,
      packageManager,
    });
    return;
  }

  // Verify template directories exist
  if (!(await fs.pathExists(baseDir))) {
    throw new Error(
      `Base template not found at ${baseDir}. The package may be corrupted or the download failed.`
    );
  }

  if (!(await fs.pathExists(typeDir))) {
    throw new Error(
      `Template "${projectType}" not found at ${typeDir}. Available templates: blank, blog.`
    );
  }

  await fs.copy(baseDir, targetDir, {
    filter: _src => {
      const basename = path.basename(_src);
      return !SKIP_FILES.has(basename);
    },
  });

  const templateSrcDir = path.join(typeDir, "src");
  if (await fs.pathExists(templateSrcDir)) {
    await fs.copy(templateSrcDir, path.join(targetDir, "src"), {
      overwrite: true,
      filter: _src => {
        const basename = path.basename(_src);
        return !SKIP_FILES.has(basename);
      },
    });
  }

  // Also copy template's nextly.config.ts if it exists at root (for blank template)
  const templateRootConfig = path.join(typeDir, "nextly.config.ts");
  if (await fs.pathExists(templateRootConfig)) {
    await fs.copy(
      templateRootConfig,
      path.join(targetDir, "nextly.config.ts"),
      { overwrite: true }
    );
  }

  const configsDir = path.join(typeDir, "configs");
  if (approach && (await fs.pathExists(configsDir))) {
    // Map approach name to config filename
    const configFileName =
      approach === "code-first"
        ? "codefirst.config.ts"
        : `${approach}.config.ts`;
    const configSrc = path.join(configsDir, configFileName);

    if (await fs.pathExists(configSrc)) {
      await fs.copy(configSrc, path.join(targetDir, "nextly.config.ts"), {
        overwrite: true,
      });
    }

    // The approach configs import from "./shared" (see templates/blog/
    // configs/codefirst.config.ts). Copy shared.ts alongside the chosen
    // config so the import resolves at runtime. visual.config.ts has no
    // fields of its own but still harmless to copy.
    const sharedSrc = path.join(configsDir, "shared.ts");
    if (await fs.pathExists(sharedSrc)) {
      await fs.copy(sharedSrc, path.join(targetDir, "shared.ts"), {
        overwrite: true,
      });
    }
  }

  // (Demo seed: src/endpoints/seed/ ships with the template tree and is
  // already copied above. The user triggers seeding from the admin
  // dashboard's SeedDemoContentCard after running /admin/setup — the
  // CLI no longer asks about it.)

  const templateMigrationsDir = path.join(typeDir, "migrations");
  if (await fs.pathExists(templateMigrationsDir)) {
    await fs.copy(templateMigrationsDir, path.join(targetDir, "migrations"), {
      overwrite: false,
    });
  }

  // The build steps a template brings with it — the blog's Pagefind index builder is the only
  // one today. Without this the template's own `package.json` scripts name a file the project
  // never receives, which is how the search index came to be silently absent from every blog
  // scaffold: the build invoked it behind a `test -f` guard that swallowed the miss.
  const templateScriptsDir = path.join(typeDir, "scripts");
  if (await fs.pathExists(templateScriptsDir)) {
    await fs.copy(templateScriptsDir, path.join(targetDir, "scripts"), {
      overwrite: false,
      filter: src => !SKIP_FILES.has(path.basename(src)),
    });
  }

  const frontendPagePath = path.join(
    targetDir,
    "src",
    "app",
    "(frontend)",
    "page.tsx"
  );
  const basePagePath = path.join(targetDir, "src", "app", "page.tsx");
  if (
    (await fs.pathExists(frontendPagePath)) &&
    (await fs.pathExists(basePagePath))
  ) {
    await fs.remove(basePagePath);
  }

  // Step 6: Generate package.json
  // The dirs copied above, so the fonts installed are the fonts this scaffold
  // actually received rather than whatever a separately-resolved tree holds.
  const packageJsonContent = await generatePackageJson(
    projectName,
    database,
    useYalc,
    projectType,
    [baseDir, typeDir],
    targetDir
  );
  await fs.writeFile(
    path.join(targetDir, "package.json"),
    packageJsonContent,
    "utf-8"
  );

  // Step 6b: Write pnpm-workspace.yaml carrying the native-dependency build
  // allowlist. pnpm 10+ blocks dependency build scripts by default and pnpm 11
  // ignores the package.json `pnpm` field, so this file is what lets
  // better-sqlite3/sharp/esbuild compile. Harmless for npm/yarn/pnpm 9.
  await fs.writeFile(
    path.join(targetDir, "pnpm-workspace.yaml"),
    generatePnpmWorkspaceYaml(),
    "utf-8"
  );

  // Step 6c: Give the project the real names for the files the template ships renamed — the
  // ignore file npm strips out of the tarball, and the agent guide kept inert in the source.
  // The placeholder map is built here rather than at step 9 because a merge into a file the
  // developer already had must render the incoming text itself; step 9 then skips what it
  // merged, so their prose is never rewritten.
  const placeholders = buildPlaceholderMap({ database, databaseUrl });
  if (approach) {
    placeholders["{{approach}}"] = approach;
  }
  const alreadyRendered = await restoreShippedNames(
    targetDir,
    placeholders,
    packageManager
  );

  // Step 6d: Undo the side effect of the workspace file above for the pnpm versions that
  // read it as a workspace declaration. Only for pnpm, because npm warns about the setting
  // on every command — see generateNpmrc.
  await writeScaffoldNpmrc(targetDir, packageManager);

  // Step 7: Create SQLite data directory if needed
  // SQLite stores its database file at ./data/nextly.db and the parent
  // directory must exist before the adapter can create the file.
  if (database.type === "sqlite") {
    await fs.ensureDir(path.join(targetDir, "data"));
  }

  // Step 8: Write a database-specific next.config.ts so the scaffold only
  // externalizes the selected adapter and its driver.
  await fs.writeFile(
    path.join(targetDir, "next.config.ts"),
    buildNextConfigTemplate(database),
    "utf-8"
  );

  // Step 9: Replace placeholders in all text files, except the ones step 6c already rendered
  // while merging them into content the developer wrote.
  await replacePlaceholders(targetDir, placeholders, alreadyRendered);
}

/**
 * Copy the plugin template (D44/D45): the whole tree (src/ + embedded dev/ +
 * tsconfig/tsup/vitest/eslint), a generated plugin package.json, then fill
 * `{{pluginName}}` / `{{nextlyRange}}`. No app base, next.config, or .env.
 */
async function copyPluginTemplate(opts: {
  projectName: string;
  typeDir: string;
  targetDir: string;
  useYalc: boolean;
  packageManager: PackageManager;
}): Promise<void> {
  const { projectName, typeDir, targetDir, useYalc, packageManager } = opts;

  if (!(await fs.pathExists(typeDir))) {
    throw new Error(
      `Plugin template not found at ${typeDir}. The package may be corrupted or the download failed.`
    );
  }

  // Copy the whole template tree, minus skip-files and the manifest.
  await fs.copy(typeDir, targetDir, {
    overwrite: true,
    filter: src => {
      const basename = path.basename(src);
      return !SKIP_FILES.has(basename) && basename !== "template.json";
    },
  });

  // Generate the plugin package.json (database arg is unused for plugins).
  const packageJsonContent = await generatePackageJson(
    projectName,
    { type: "sqlite" } as DatabaseConfig,
    useYalc,
    "plugin"
  );
  await fs.writeFile(
    path.join(targetDir, "package.json"),
    packageJsonContent,
    "utf-8"
  );

  // Write pnpm-workspace.yaml carrying the native-dependency build allowlist.
  // pnpm 11 ignores the package.json `pnpm` field, and the embedded dev/
  // playground uses better-sqlite3 (native build) — so this file is what lets
  // `pnpm install` build it instead of aborting with ERR_PNPM_IGNORED_BUILDS.
  await fs.writeFile(
    path.join(targetDir, "pnpm-workspace.yaml"),
    generatePnpmWorkspaceYaml(),
    "utf-8"
  );

  // The plugin scaffold is a git repository too, and npm strips its ignore file the same way. It
  // carries its own agent guide — a publishable library rather than an app, so the base guide
  // would describe the wrong project — and that guide is restored by the same table.
  const nextlyRange = await resolvePluginNextlyRange(useYalc);
  const placeholders = buildPlaceholderMap({
    pluginName: projectName,
    nextlyRange,
  });
  const alreadyRendered = await restoreShippedNames(
    targetDir,
    placeholders,
    packageManager
  );

  // It installs like any other project too, so it meets the same workspace-root refusal the
  // pnpm workspace file provokes on pnpm 9 — through the same writer as the app path.
  await writeScaffoldNpmrc(targetDir, packageManager);

  // Fill plugin placeholders across the copied tree (src/ + dev/), leaving alone whatever was
  // rendered while merging into a file the developer already had.
  await replacePlaceholders(targetDir, placeholders, alreadyRendered);
}

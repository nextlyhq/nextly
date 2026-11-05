/**
 * What importing a transfer file into this site would do, decided before
 * anything is written: what it adds, what it reuses, what clashes and what
 * each clash's choice means, how its breakpoints map, which of its block
 * types the site lacks, and every reason it cannot be applied as it stands.
 *
 * Pure: the route reads the site once into a {@link ImportSite} and hands it
 * here, so a preview and the apply that follows it judge one answer.
 *
 * ## The rules
 *
 * - **Clashes.** A component, pattern or Layout clashes with one of the same
 *   slug; a shared style with one of the same name (or id); a variable with
 *   one of the same identity; a media file with one of the same file name.
 *   By default the file's item is added under a new name and the file's
 *   references point at it; the author may instead point them at the existing
 *   item. Nothing that is there is ever changed.
 * - **Identical things are reused.** A shared style, a variable or a media
 *   file identical to one already on the site is used as it is, and is no
 *   clash: importing the same file twice adds one copy of each, not two.
 * - **Breakpoints** map to the site's breakpoint on the same axis with the
 *   same `maxWidth`, which is the same width range, never to a near one. One
 *   with no match must be added or dropped; adding is offered only to someone
 *   who may manage site settings, and only while its axis has room.
 * - **Block types** the site has not registered are listed, and refuse the
 *   import until the site provides them: a file carries content, never code.
 * - **Loops** among the file's components are refused, naming the chain.
 *
 * @module transfer/import-plan
 */
import { createHash } from "node:crypto";

import {
  COMPONENT_INSTANCE_TYPE,
  MAX_BREAKPOINTS_PER_AXIS,
  sameJsonValue,
  tokenDisplayLabel,
  tokenIdentity,
  walkNodes,
  type BlockDocument,
  type BreakpointSet,
  type NamedClass,
  type SiteToken,
} from "@nextlyhq/blocks-engine";

import { rewriteClass, type ReferenceMaps } from "./import-rewrite";
import {
  conflictKey,
  type ImportAddition,
  type ImportBreakpointChoice,
  type ImportChoices,
  type ImportConflict,
  type ImportConflictChoice,
  type ImportConflictKind,
  type ImportMatchedBreakpoint,
  type ImportPreview,
  type ImportProblem,
  type ImportReuse,
  type ImportUnmatchedBreakpoint,
  type TransferBreakpoint,
  type TransferFile,
  type TransferKind,
} from "./transfer-contract";
import {
  collectDocumentReferences,
  emptyReferences,
  imageExposureIds,
  registryMediaProps,
} from "./transfer-references";

/** An item already on the site. */
export interface ExistingItem {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
}

/** The items of one kind on the site the file's slugs reach. */
export interface ExistingItems {
  /** Items holding a slug the file uses. */
  readonly bySlug: ReadonlyMap<string, ExistingItem>;
  /** Every slug among the file's and their renamed candidates already taken. */
  readonly taken: ReadonlySet<string>;
}

/** A media file already on the site that the file's one meets. */
export interface ExistingMedia {
  /** A file with the same bytes. */
  readonly identical?: { readonly id: string; readonly filename: string };
  /** A file with the same name and other bytes. */
  readonly sameName?: { readonly id: string; readonly filename: string };
}

/** The site, as the plan judges the file against it. */
export interface ImportSite {
  readonly items: Readonly<Record<TransferKind, ExistingItems>>;
  readonly classes: readonly NamedClass[];
  readonly tokens: readonly SiteToken[];
  readonly breakpoints: BreakpointSet;
  /** By the file's media id. */
  readonly media: ReadonlyMap<string, ExistingMedia>;
  readonly isRegistered: (type: string) => boolean;
  /** The props a block type declares as media; the registry's by default. */
  readonly mediaProps?: (type: string) => readonly string[];
  /** Whether the caller may manage site settings, which adding a breakpoint needs. */
  readonly mayAddBreakpoints: boolean;
}

/** What becomes of one of the file's items. */
export type ItemFate =
  | { readonly action: "create"; readonly title: string; readonly slug: string }
  | { readonly action: "existing"; readonly id: string };

/** What becomes of one of the file's media files. */
export type MediaFate =
  | { readonly action: "upload"; readonly filename: string }
  | { readonly action: "existing"; readonly id: string };

/** A breakpoint to add to the site. */
export interface BreakpointAddition {
  readonly axis: "viewport" | "container";
  readonly id: string;
  readonly label: string;
  readonly maxWidth: number;
}

/** The whole plan: the preview, and what the apply writes when it is ready. */
export interface ImportPlan {
  readonly preview: ImportPreview;
  readonly items: Readonly<Record<TransferKind, ReadonlyMap<string, ItemFate>>>;
  /** The file's components to create, each after every one it places. */
  readonly componentOrder: readonly string[];
  /** The file's shared styles: the destination id each maps to, and the new ones. */
  readonly classes: {
    readonly map: ReadonlyMap<string, string>;
    readonly create: readonly {
      readonly from: NamedClass;
      readonly id: string;
      readonly slug: string;
    }[];
  };
  readonly tokens: {
    readonly map: ReadonlyMap<string, string>;
    readonly create: readonly SiteToken[];
  };
  /** Kept breakpoints only, file id to the site's. */
  readonly breakpoints: ReadonlyMap<string, string>;
  readonly addBreakpoints: readonly BreakpointAddition[];
  readonly media: ReadonlyMap<string, MediaFate>;
}

/** How many numbered renames a clash is offered before a fixed suffix. */
const RENAME_CANDIDATES = 20;

/** The slugs a clashing slug is renamed to, in the order they are tried. */
export function renamedSlugs(slug: string): string[] {
  const candidates: string[] = [];
  for (let n = 2; n <= RENAME_CANDIDATES + 1; n += 1) {
    candidates.push(`${slug}-${String(n)}`);
  }
  // Past the numbered ones, a suffix derived from the name, so a preview and
  // the import that applies it rename alike. Listed here so the site's reads
  // check these too.
  const fixed = `${slug}-${stableSuffix(slug)}`;
  candidates.push(fixed);
  for (let n = 2; n <= 10; n += 1) candidates.push(`${fixed}-${String(n)}`);
  return candidates;
}

/**
 * The first free rename of a name held in a set known whole (the site's
 * shared styles, variables and breakpoints): past the listed candidates the
 * fixed suffix is counted on until one is free.
 */
function renameIn(name: string, free: (candidate: string) => boolean): string {
  const listed = renamedSlugs(name).find(free);
  if (listed !== undefined) return listed;
  const fixed = `${name}-${stableSuffix(name)}`;
  for (let n = 11; ; n += 1) {
    const candidate = `${fixed}-${String(n)}`;
    if (free(candidate)) return candidate;
  }
}

/** What the plan says so far, shared by the steps that settle each kind. */
interface Ledger {
  readonly added: ImportAddition[];
  readonly reused: ImportReuse[];
  readonly conflicts: ImportConflict[];
  readonly problems: ImportProblem[];
  /** The choice made for a clash, renamed when none was. */
  readonly choiceOf: (
    kind: ImportConflictKind,
    fileId: string
  ) => ImportConflictChoice;
}

/** Plan an import, as the docblock describes. */
export function planImport(
  file: TransferFile,
  site: ImportSite,
  choices: ImportChoices = {}
): ImportPlan {
  const ledger: Ledger = {
    added: [],
    reused: [],
    conflicts: [],
    problems: [],
    choiceOf: (kind, fileId) =>
      choices.conflicts?.[conflictKey(kind, fileId)] ?? "rename",
  };
  const items = {
    component: planItems(
      "component",
      file.components,
      site.items.component,
      ledger
    ),
    pattern: planItems("pattern", file.patterns, site.items.pattern, ledger),
    layout: planItems("layout", file.layouts, site.items.layout, ledger),
  };
  const references = fileReferences(
    file,
    site.mediaProps ?? registryMediaProps
  );
  for (const id of references.danglingComponents) {
    ledger.problems.push({
      code: "MISSING_REFERENCE",
      message: `The file places a component (${id}) it does not carry, so it is incomplete.`,
    });
  }
  for (const id of references.danglingMedia) {
    ledger.problems.push({
      code: "MISSING_REFERENCE",
      message: `The file shows a media file (${id}) it does not carry, so it is incomplete.`,
    });
  }
  const order = componentOrder(file, items.component, ledger.problems);
  // Variables and breakpoints first: a shared style is the same as one here
  // only once what its styles name is mapped as the import maps it.
  const tokens = planTokens(file.tokens, site.tokens, ledger);
  const breakpoints = planBreakpoints(
    file,
    site,
    choices,
    references.counts,
    ledger.problems
  );
  const classes = planClasses(file.classes, site.classes, ledger, {
    tokens: tokens.map,
    breakpoints: breakpoints.map,
  });
  const media = planMedia(file, site, ledger);
  const missingBlockTypes = [...references.blockTypes]
    .filter(type => !site.isRegistered(type))
    .sort();

  const preview: ImportPreview = {
    root: { kind: file.root.kind, title: rootTitle(file) },
    added: ledger.added,
    reused: ledger.reused,
    conflicts: ledger.conflicts,
    breakpoints: {
      matched: breakpoints.matched,
      unmatched: breakpoints.unmatched,
    },
    missingBlockTypes,
    problems: ledger.problems,
    ready: missingBlockTypes.length === 0 && ledger.problems.length === 0,
    fingerprint: fingerprintOf(site, ledger, missingBlockTypes, choices),
  };
  return {
    preview,
    items,
    componentOrder: order,
    classes,
    tokens,
    breakpoints: breakpoints.map,
    addBreakpoints: breakpoints.add,
    media,
  };
}

/** Components, patterns or Layouts, each added, renamed or pointed at one here. */
function planItems(
  kind: TransferKind,
  listed: readonly { id: string; title: string; slug: string }[],
  existing: ExistingItems,
  ledger: Ledger
): Map<string, ItemFate> {
  const fates = new Map<string, ItemFate>();
  const claimed = new Set<string>();
  const free = (slug: string) =>
    !existing.taken.has(slug) && !claimed.has(slug);
  for (const item of listed) {
    const clash = existing.bySlug.get(item.slug);
    if (clash === undefined && free(item.slug)) {
      claimed.add(item.slug);
      fates.set(item.id, {
        action: "create",
        title: item.title,
        slug: item.slug,
      });
      ledger.added.push({ kind, fileId: item.id, name: item.title });
      continue;
    }
    const slug = renamedSlugs(item.slug).find(free);
    if (slug === undefined) {
      ledger.problems.push({
        code: "NAME_UNAVAILABLE",
        message: `"${item.title}" can't be added: its name and every rename of it are taken on this site. Rename the item on this site, or in the file, and try again.`,
      });
      continue;
    }
    const title = `${item.title} (${slug.slice(item.slug.length + 1)})`;
    if (clash === undefined) {
      // A slug taken by a row the file's own items already claimed.
      claimed.add(slug);
      fates.set(item.id, { action: "create", title, slug });
      ledger.added.push({ kind, fileId: item.id, name: title });
      continue;
    }
    const choice = settle(
      ledger,
      kind,
      item.id,
      item.title,
      { id: clash.id, name: clash.title },
      title
    );
    if (choice === "existing") {
      fates.set(item.id, { action: "existing", id: clash.id });
    } else {
      claimed.add(slug);
      fates.set(item.id, { action: "create", title, slug });
    }
  }
  return fates;
}

/** Record a clash and answer the choice in force for it. */
function settle(
  ledger: Ledger,
  kind: ImportConflictKind,
  fileId: string,
  name: string,
  existing: { id: string; name: string },
  renamedTo: string,
  detail?: string
): ImportConflictChoice {
  const choice = ledger.choiceOf(kind, fileId);
  ledger.conflicts.push({
    key: conflictKey(kind, fileId),
    kind,
    fileId,
    name,
    ...(detail === undefined ? {} : { detail }),
    existing,
    renamedTo,
    choice,
  });
  return choice;
}

/** Shared styles: reused when identical, else added, renamed or pointed at one here. */
function planClasses(
  listed: readonly NamedClass[],
  own: readonly NamedClass[],
  ledger: Ledger,
  mapped: Pick<ReferenceMaps, "tokens" | "breakpoints">
): ImportPlan["classes"] {
  const maps: ReferenceMaps = {
    components: new Map(),
    classes: new Map(),
    media: new Map(),
    ...mapped,
  };
  const map = new Map<string, string>();
  const create: { from: NamedClass; id: string; slug: string }[] = [];
  const slugs = new Set(own.map(entry => entry.slug));
  const ids = new Set(own.map(entry => entry.id));
  for (const entry of listed) {
    const named = own.find(mine => mine.slug === entry.slug);
    // Compared as it would be written here: the same raw `$token` under a
    // variable the import renames is not the same style.
    const written = rewriteClass(
      entry,
      entry.id,
      entry.slug,
      entry.orderIndex,
      maps
    );
    // The same look binding too: a box's shared style and a button's look
    // with one name and one look are not one class.
    if (
      named !== undefined &&
      named.blockType === written.blockType &&
      sameJsonValue(named.styles, written.styles)
    ) {
      map.set(entry.id, named.id);
      ledger.reused.push({
        kind: "class",
        fileId: entry.id,
        name: entry.slug,
        existingId: named.id,
      });
      continue;
    }
    const free = (slug: string) => !slugs.has(slug);
    const slug = free(entry.slug) ? entry.slug : renameIn(entry.slug, free);
    if (named !== undefined) {
      const existing = { id: named.id, name: named.slug };
      if (
        settle(ledger, "class", entry.id, entry.slug, existing, slug) ===
        "existing"
      ) {
        map.set(entry.id, named.id);
        continue;
      }
    } else {
      ledger.added.push({ kind: "class", fileId: entry.id, name: slug });
    }
    // An id this site already uses for another style is never shared.
    const id = ids.has(entry.id)
      ? renameIn(entry.id, candidate => !ids.has(candidate))
      : entry.id;
    slugs.add(slug);
    ids.add(id);
    map.set(entry.id, id);
    create.push({ from: entry, id, slug });
  }
  return { map, create };
}

/** Variables: reused when identical, else added, renamed or pointed at one here. */
function planTokens(
  listed: readonly SiteToken[],
  own: readonly SiteToken[],
  ledger: Ledger
): ImportPlan["tokens"] {
  const map = new Map<string, string>();
  const create: SiteToken[] = [];
  const identities = new Set(own.map(tokenIdentity));
  for (const token of listed) {
    const identity = tokenIdentity(token);
    const clash = own.find(mine => tokenIdentity(mine) === identity);
    if (
      clash !== undefined &&
      clash.kind === token.kind &&
      sameJsonValue(clash.values, token.values)
    ) {
      map.set(identity, identity);
      ledger.reused.push({
        kind: "token",
        fileId: identity,
        name: tokenDisplayLabel(token),
        detail: token.name,
        existingId: identity,
      });
      continue;
    }
    if (clash === undefined) {
      map.set(identity, identity);
      identities.add(identity);
      create.push(token);
      ledger.added.push({
        kind: "token",
        fileId: identity,
        name: tokenDisplayLabel(token),
        detail: token.name,
      });
      continue;
    }
    const free = (name: string) => !identities.has(name);
    const renamed = renameIn(identity, free);
    const existing = { id: identity, name: tokenDisplayLabel(clash) };
    if (
      settle(
        ledger,
        "token",
        identity,
        tokenDisplayLabel(token),
        existing,
        renamed,
        token.name
      ) === "existing"
    ) {
      map.set(identity, identity);
      continue;
    }
    identities.add(renamed);
    map.set(identity, renamed);
    const copy: SiteToken = { ...token, name: renamed };
    delete (copy as { id?: string }).id;
    create.push(copy);
  }
  return { map, create };
}

/** Media: reused when identical, else uploaded, renamed or pointed at one here. */
function planMedia(
  file: TransferFile,
  site: ImportSite,
  ledger: Ledger
): Map<string, MediaFate> {
  const media = new Map<string, MediaFate>();
  for (const entry of file.media) {
    const met = site.media.get(entry.id) ?? {};
    if (met.identical !== undefined) {
      media.set(entry.id, { action: "existing", id: met.identical.id });
      ledger.reused.push({
        kind: "media",
        fileId: entry.id,
        name: entry.filename,
        existingId: met.identical.id,
      });
      continue;
    }
    if (met.sameName === undefined) {
      media.set(entry.id, { action: "upload", filename: entry.filename });
      ledger.added.push({
        kind: "media",
        fileId: entry.id,
        name: entry.filename,
      });
      continue;
    }
    const renamed = renamedFilename(entry.filename);
    const existing = { id: met.sameName.id, name: met.sameName.filename };
    media.set(
      entry.id,
      settle(ledger, "media", entry.id, entry.filename, existing, renamed) ===
        "existing"
        ? { action: "existing", id: met.sameName.id }
        : { action: "upload", filename: renamed }
    );
  }
  return media;
}

/** The same plan, refused for a reason the site gave when it judged the writes. */
export function withProblems(
  plan: ImportPlan,
  extra: readonly ImportProblem[]
): ImportPlan {
  if (extra.length === 0) return plan;
  return {
    ...plan,
    preview: {
      ...plan.preview,
      problems: [...plan.preview.problems, ...extra],
      ready: false,
    },
  };
}

function rootTitle(file: TransferFile): string {
  const all = [...file.components, ...file.patterns, ...file.layouts];
  return all.find(item => item.id === file.root.id)?.title ?? "";
}

/** What the file's documents refer to, and how often each breakpoint is used. */
function fileReferences(
  file: TransferFile,
  mediaProps: (type: string) => readonly string[]
): {
  blockTypes: Set<string>;
  danglingComponents: string[];
  danglingMedia: string[];
  counts: Map<string, { styles: number; hides: number }>;
} {
  const images = new Map(
    file.components.map(item => [item.id, imageExposureIds(item.content)])
  );
  const references = emptyReferences();
  const documents: BlockDocument[] = [
    ...file.components.map(item => item.content),
    ...file.patterns.map(item => item.content),
  ];
  const counts = new Map<string, { styles: number; hides: number }>();
  const tally = (breakpoint: string, kind: "styles" | "hides") => {
    const now = counts.get(breakpoint) ?? { styles: 0, hides: 0 };
    now[kind] += 1;
    counts.set(breakpoint, now);
  };
  const countStyles = (styles: unknown) => {
    if (!isRecord(styles)) return;
    for (const byBreakpoint of Object.values(styles)) {
      if (!isRecord(byBreakpoint)) continue;
      for (const breakpoint of Object.keys(byBreakpoint))
        tally(breakpoint, "styles");
    }
  };
  for (const document of documents) {
    collectDocumentReferences(document, references, {
      mediaProps,
      imageExposures: id => images.get(id) ?? new Set(),
    });
    countStyles(document.settings?.styles);
    if (!Array.isArray(document.nodes)) continue;
    walkNodes(document.nodes, node => {
      countStyles(node.styles);
      for (const breakpoint of Object.keys(node.visibility?.devices ?? {})) {
        tally(breakpoint, "hides");
      }
    });
  }
  for (const entry of file.classes) countStyles(entry.styles);
  const carried = new Set(file.components.map(item => item.id));
  const dangling = [...references.components].filter(id => !carried.has(id));
  for (const layout of file.layouts) {
    for (const area of layout.areas) {
      if (!carried.has(area.component)) dangling.push(area.component);
    }
  }
  const media = new Set(file.media.map(entry => entry.id));
  return {
    blockTypes: references.blockTypes,
    danglingComponents: [...new Set(dangling)],
    danglingMedia: [...references.media].filter(id => !media.has(id)),
    counts,
  };
}

/**
 * The file's components to create, each after every one it places, or the
 * loop that makes an order impossible, named by title.
 */
function componentOrder(
  file: TransferFile,
  fates: ReadonlyMap<string, ItemFate>,
  problems: ImportProblem[]
): string[] {
  const byId = new Map(file.components.map(item => [item.id, item]));
  const placed = (id: string): string[] => {
    const item = byId.get(id);
    // A component pointed at one already here is not written, so what the
    // file's copy of it places is no part of what the import makes.
    if (item === undefined || fates.get(id)?.action !== "create") return [];
    const ids: string[] = [];
    walkNodes(item.content.nodes, node => {
      if (node.type !== COMPONENT_INSTANCE_TYPE) return;
      const child = (node.props as { componentId?: unknown }).componentId;
      if (typeof child === "string" && byId.has(child)) ids.push(child);
    });
    return ids;
  };
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const titleOf = (id: string) => byId.get(id)?.title || id;
  let looped = false;
  const visit = (id: string, path: string[]): void => {
    if (looped || state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      looped = true;
      const chain = [...path.slice(path.indexOf(id)), id].map(titleOf);
      problems.push({
        code: "COMPONENT_CYCLE",
        message: `These components place each other in a loop: ${chain.join(" → ")}. A component cannot contain itself.`,
      });
      return;
    }
    state.set(id, "visiting");
    for (const child of placed(id)) visit(child, [...path, id]);
    state.set(id, "done");
    if (fates.get(id)?.action === "create") order.push(id);
  };
  for (const item of file.components) visit(item.id, []);
  return looped ? [] : order;
}

/** The breakpoint part of a plan. */
interface BreakpointPlan {
  readonly matched: ImportMatchedBreakpoint[];
  readonly unmatched: ImportUnmatchedBreakpoint[];
  readonly map: Map<string, string>;
  readonly add: BreakpointAddition[];
}

function planBreakpoints(
  file: TransferFile,
  site: ImportSite,
  choices: ImportChoices,
  counts: ReadonlyMap<string, { styles: number; hides: number }>,
  problems: ImportProblem[]
): BreakpointPlan {
  const plan: BreakpointPlan = {
    matched: [],
    unmatched: [],
    map: new Map(),
    add: [],
  };
  const taken = new Set([
    ...site.breakpoints.viewport.map(def => def.id),
    ...site.breakpoints.container.map(def => def.id),
  ]);
  const room = {
    viewport: MAX_BREAKPOINTS_PER_AXIS - site.breakpoints.viewport.length,
    container: MAX_BREAKPOINTS_PER_AXIS - site.breakpoints.container.length,
  };
  for (const entry of file.breakpoints) {
    const same = site.breakpoints[entry.axis].find(
      def => def.maxWidth === entry.maxWidth
    );
    if (same !== undefined) {
      plan.map.set(entry.id, same.id);
      plan.matched.push({
        ...describe(entry),
        to: { id: same.id, label: same.label },
      });
      continue;
    }
    const whyNotAdd = refusedAddition(
      entry,
      site.mayAddBreakpoints,
      room[entry.axis]
    );
    const choice: ImportBreakpointChoice | undefined =
      choices.breakpoints?.[entry.id];
    const used = counts.get(entry.id) ?? { styles: 0, hides: 0 };
    plan.unmatched.push({
      ...describe(entry),
      styles: used.styles,
      hides: used.hides,
      mayAdd: whyNotAdd === undefined,
      ...(whyNotAdd === undefined ? {} : { whyNotAdd }),
      ...(choice === undefined ? {} : { choice }),
    });
    const problem = breakpointProblem(entry, choice, whyNotAdd);
    if (problem !== undefined) problems.push(problem);
    if (choice !== "add" || problem !== undefined) continue;
    room[entry.axis] -= 1;
    const id = freeId(entry.id, taken);
    taken.add(id);
    plan.map.set(entry.id, id);
    plan.add.push({
      axis: entry.axis,
      id,
      label: entry.label,
      maxWidth: entry.maxWidth,
    });
  }
  return plan;
}

/** Why "add" is not offered for a breakpoint, or nothing when it is. */
function refusedAddition(
  entry: TransferBreakpoint,
  mayAdd: boolean,
  room: number
): string | undefined {
  if (!mayAdd)
    return "Adding a breakpoint needs the right to manage site settings.";
  if (room > 0) return undefined;
  const kind = entry.axis === "viewport" ? "device" : "container";
  return `This site already has ${String(MAX_BREAKPOINTS_PER_AXIS)} ${kind} breakpoints, the most it can hold.`;
}

/** What stops an unmatched breakpoint's choice, if anything does. */
function breakpointProblem(
  entry: TransferBreakpoint,
  choice: ImportBreakpointChoice | undefined,
  whyNotAdd: string | undefined
): ImportProblem | undefined {
  if (choice === undefined) {
    return {
      code: "BREAKPOINT_UNDECIDED",
      message: `Choose whether to add the "${entry.label}" breakpoint (${String(entry.maxWidth)}px) or drop its styles.`,
    };
  }
  if (choice === "add" && whyNotAdd !== undefined) {
    return {
      code: "BREAKPOINT_NOT_ADDABLE",
      message: `The "${entry.label}" breakpoint cannot be added: ${whyNotAdd}`,
    };
  }
  return undefined;
}

/** `wanted` when it is free, else its first free renamed form. */
function freeId(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) return wanted;
  return renameIn(wanted, candidate => !taken.has(candidate));
}

function describe(entry: TransferBreakpoint) {
  return {
    fileId: entry.id,
    label: entry.label,
    axis: entry.axis,
    maxWidth: entry.maxWidth,
  };
}

/** `photo.png` as `photo-2.png`: what a renamed upload is called. */
function renamedFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot <= 0
    ? `${filename}-2`
    : `${filename.slice(0, dot)}-2${filename.slice(dot)}`;
}

/**
 * What the preview was judged against, as one digest: the site's breakpoints,
 * what is added under which name, what clashes with what, what is reused and
 * which block types are missing.
 * An apply judged against a different answer is not the import that was
 * confirmed.
 */
function fingerprintOf(
  site: ImportSite,
  ledger: Pick<Ledger, "added" | "conflicts" | "reused">,
  missing: readonly string[],
  choices: ImportChoices
): string {
  const { added, conflicts, reused } = ledger;
  const judged = {
    breakpoints: site.breakpoints,
    mayAddBreakpoints: site.mayAddBreakpoints,
    added: added.map(entry => [entry.kind, entry.fileId, entry.name]),
    // The choice in force too: an apply choosing otherwise than the
    // confirmed preview is not the import that was confirmed.
    conflicts: conflicts.map(entry => [
      entry.key,
      entry.existing.id,
      entry.renamedTo,
      entry.choice,
    ]),
    breakpointChoices: Object.entries(choices.breakpoints ?? {}).sort(),
    reused: reused.map(entry => [entry.kind, entry.fileId, entry.existingId]),
    missing,
  };
  return createHash("sha256").update(JSON.stringify(judged)).digest("hex");
}

/**
 * A suffix past the numbered renames, the same for the same name on every
 * request, so a preview and the import that applies it name a clash alike.
 */
function stableSuffix(name: string): string {
  return createHash("sha256").update(name).digest("hex").slice(0, 8);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

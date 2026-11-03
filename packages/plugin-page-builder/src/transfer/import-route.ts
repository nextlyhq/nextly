/**
 * `POST /transfer/import`: a transfer file read against this site, previewed
 * (`dryRun: true`) or applied.
 *
 * ## One judgement, then the writes
 *
 * The site is read once and the planner (`import-plan`) decides everything: what
 * is added, reused and clashes, how breakpoints map, which block types are
 * missing, and any loop among the file's components. The file's documents are
 * then written, as the caller, in one transaction that is rolled back: every
 * check a write runs (the blocks field's validation over the composed page,
 * locks included, the loop guard, the hooks that strip retired exposure ids,
 * the caller's own rights) answers before anything stays. A preview shows
 * those answers; an apply runs only when there are none.
 *
 * ## What an apply writes, in order
 *
 * 1. New media files, uploaded as the caller. An identical file already here
 *    is reused instead.
 * 2. New shared styles and variables, appended to the site style as the
 *    caller, and any breakpoint the author chose to add, through the checked
 *    site-settings write the right to manage the site admits.
 * 3. Components (each after every one it places), then patterns, then
 *    Layouts, in one transaction, every reference pointing at what this site
 *    now holds.
 *
 * Media files and the site style are not part of the database transaction,
 * so when a later step fails what the earlier ones added is taken back: the
 * uploads deleted, and the added styles, variables and breakpoints removed.
 * Nothing that was there before is changed at any step.
 *
 * An import never makes a Layout the site's default: that mark is the site's,
 * held in the plugin's settings, and no file carries it.
 *
 * @module transfer/import-route
 */
import {
  hasBlock,
  resolveSiteTokens,
  usableNamedClasses,
  COMPONENT_INSTANCE_TYPE,
  type BlockDocument,
  type BreakpointSet,
  type SiteToken,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  respondMutation,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";
import { z } from "nextly/zod";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import {
  actingCaller,
  asCaller,
  createdId,
  readBodyWith,
  reconcileAfterCommit,
  requirePluginStore,
  storeOf,
  type CompositionRouteContext,
  type CompositionRouteSetup,
} from "../composition-route-kit";
import { readingAsUser, type ComponentStore } from "../library-route";
import type { SiteStyleData } from "../site-style";
import {
  loadSiteStyle,
  SITE_SETTINGS_WRITE_CONTEXT,
  SITE_STYLE_SLUG,
} from "../site-style-storage";

import {
  planImport,
  renamedSlugs,
  withProblems,
  type ExistingItems,
  type ExistingMedia,
  type ImportPlan,
  type ImportSite,
} from "./import-plan";
import {
  rewriteClass,
  rewriteDocument,
  type ReferenceMaps,
} from "./import-rewrite";
import {
  IMPORT_ROUTE_PATH,
  type ImportProblem,
  type ImportResult,
  type TransferFile,
  type TransferKind,
} from "./transfer-contract";
import { readTransferFile } from "./transfer-file-schema";
import {
  sha256Of,
  storedBytes,
  type StoredMediaRecord,
} from "./transfer-media";
import { imageExposureIds, registryMediaProps } from "./transfer-references";

/** The context an import runs with: the composition routes', and media. */
type ImportContext = CompositionRouteContext & {
  services: CompositionRouteContext["services"] & {
    media: Pick<PluginRouteContext["services"]["media"], "upload" | "delete">;
  };
};

/** What the import route is built with. */
export interface ImportRouteSetup extends CompositionRouteSetup {
  readonly store?: ComponentStore;
  /** The site style the plugin's config declares, under the stored one. */
  readonly defaults?: SiteStyleData;
}

const ImportBody = z.strictObject({
  file: z.unknown(),
  choices: z
    .strictObject({
      conflicts: z
        .record(z.string().max(1024), z.enum(["rename", "existing"]))
        .optional(),
      breakpoints: z
        .record(z.string().max(512), z.enum(["add", "drop"]))
        .optional(),
    })
    .optional(),
  dryRun: z.boolean().optional(),
  expect: z.string().max(128).optional(),
});

/** Thrown inside the judging transaction to roll it back once it has answered. */
class JudgedAndRolledBack extends Error {}

/** Read, judge and preview or apply a file, as the docblock describes. */
async function importFile(
  req: Request,
  ctx: ImportContext,
  setup: ImportRouteSetup = {}
): Promise<Response> {
  requirePluginStore(ctx, setup);
  const body = await readBodyWith(req, ImportBody, "import");
  const read = readTransferFile(body.file);
  if ("issues" in read) {
    throw NextlyError.validation({ errors: [...read.issues] });
  }
  const file = read.file;
  const slugs = collectionsOf(ctx, setup);
  // Before the site is read for clashes: only someone who may add the kind
  // of item the file was made from learns what this site holds.
  const by = await actingCaller(ctx, [["create", slugs[file.root.kind]]]);

  let plan = planImport(
    file,
    await readSite(ctx, file, slugs, setup),
    body.choices ?? {}
  );
  plan = withProblems(plan, await grantProblems(ctx, file, plan, slugs));
  if (plan.preview.ready) {
    plan = withProblems(plan, await judgeWrites(ctx, file, plan, slugs));
  }

  if (body.dryRun === true) {
    return respondMutation<ImportResult>(
      "Nothing was written: this is what the import would do.",
      { dryRun: true, preview: plan.preview, by }
    );
  }
  // A stale preview first: what the author confirmed is not what the site
  // says now, whether or not the new answer could be applied.
  if (body.expect !== plan.preview.fingerprint) {
    throw NextlyError.conflict({
      reason: "state",
      message:
        "This site changed since the import was previewed. Nothing was written; review the new preview and confirm again.",
      logContext: { reason: "transfer-import-stale-preview" },
    });
  }

  if (!plan.preview.ready) {
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "The file cannot be imported as it stands. Nothing was written.",
      publicData: {
        errors: plan.preview.problems.map(problem => ({
          path: "file",
          code: problem.code,
          message: problem.message,
        })),
      },
      logMessage: "Refused an import",
      logContext: { reason: "transfer-import-refused" },
    });
  }
  const result = await applyPlan(ctx, file, plan, slugs, setup);
  return respondMutation<ImportResult>(
    "The file was imported.",
    { ...result, by },
    {
      status: 201,
    }
  );
}

/** The collections an import writes, as the host named them. */
interface Collections {
  readonly component: string;
  readonly pattern: string;
  readonly layout: string;
  readonly field: string;
  readonly siteStyle: string;
}

function collectionsOf(
  ctx: ImportContext,
  setup: ImportRouteSetup
): Collections {
  const store = storeOf(ctx, setup);
  return {
    component: store.collection,
    pattern: ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
    layout: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    field: store.field,
    siteStyle: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
  };
}

// ---------------------------------------------------------------------------
// Reading the site
// ---------------------------------------------------------------------------

/**
 * The site as the planner judges the file against it. Read as the system:
 * a slug is unique whoever may read the row holding it, so a clash is a
 * clash even where the caller cannot see it.
 */
async function readSite(
  ctx: ImportContext,
  file: TransferFile,
  slugs: Collections,
  setup: ImportRouteSetup
): Promise<ImportSite> {
  const style = await loadSiteStyle({
    nextly: requireNextly(),
    slug: slugs.siteStyle,
    ...(setup.defaults === undefined ? {} : { defaults: setup.defaults }),
  });
  return {
    items: {
      component: await existingItems(slugs.component, file.components),
      pattern: await existingItems(slugs.pattern, file.patterns),
      layout: await existingItems(slugs.layout, file.layouts),
    },
    classes: usableNamedClasses(style.classes ?? []),
    tokens: resolveSiteTokens(style.tokens).tokens,
    // The whole set, its unbounded base row included: a file breakpoint
    // always has a width, so it never matches the base, and the base counts
    // toward an axis's room as the stored set's own check counts it.
    breakpoints: {
      viewport: [...(style.breakpoints?.viewport ?? [])],
      container: [...(style.breakpoints?.container ?? [])],
    },
    media: await existingMedia(file),
    isRegistered: type => type === COMPONENT_INSTANCE_TYPE || hasBlock(type),
    mayAddBreakpoints:
      (await ctx.caller?.can("manage", "page-builder-site")) === true,
  };
}

/** The rows holding a slug the file uses or would rename one to. */
async function existingItems(
  collection: string,
  items: readonly { slug: string }[]
): Promise<ExistingItems> {
  const bySlug = new Map<string, { id: string; title: string; slug: string }>();
  const taken = new Set<string>();
  const wanted = items.flatMap(item => [item.slug, ...renamedSlugs(item.slug)]);
  const asked = new Set(items.map(item => item.slug));
  for (let at = 0; at < wanted.length; at += 200) {
    const chunk = wanted.slice(at, at + 200);
    const found = await requireNextly().find({
      collection,
      where: { slug: { in: chunk } },
      overrideAccess: true,
      status: "all",
      select: { id: true, title: true, slug: true },
      limit: chunk.length,
      depth: 0,
    });
    for (const row of found.items) {
      const held = heldSlug(row);
      if (held === undefined) continue;
      taken.add(held.slug);
      if (asked.has(held.slug)) bySlug.set(held.slug, held);
    }
  }
  return { bySlug, taken };
}

/** A row as the clash it is, or nothing when it holds no slug. */
function heldSlug(
  row: Record<string, unknown>
): { id: string; title: string; slug: string } | undefined {
  const slug = typeof row.slug === "string" ? row.slug : "";
  if (slug === "") return undefined;
  return {
    id: String(row.id),
    title: typeof row.title === "string" ? row.title : slug,
    slug,
  };
}

/**
 * For each of the file's media files, one here with the same bytes, or else
 * one with the same name. Files are found by name, and their bytes compared,
 * so an identical file is reused whatever it was renamed to only when its name
 * still matches; one renamed is uploaded again.
 */
async function existingMedia(
  file: TransferFile
): Promise<Map<string, ExistingMedia>> {
  const met = new Map<string, ExistingMedia>();
  for (const entry of file.media) {
    met.set(entry.id, await metMedia(entry));
  }
  return met;
}

/** What one media file meets here, as {@link existingMedia} describes. */
async function metMedia(
  entry: TransferFile["media"][number]
): Promise<ExistingMedia> {
  const dot = entry.filename.lastIndexOf(".");
  const stem = dot > 0 ? entry.filename.slice(0, dot) : entry.filename;
  const found = await requireNextly().media.find({
    search: stem,
    limit: 50,
    overrideAccess: true,
  });
  let sameName: ExistingMedia["sameName"];
  for (const candidate of found.items as unknown as StoredMediaRecord[]) {
    const named = candidate.originalFilename || candidate.filename;
    if (await sameBytes(candidate, entry)) {
      return { identical: { id: String(candidate.id), filename: named } };
    }
    if (sameName === undefined && named === entry.filename) {
      sameName = { id: String(candidate.id), filename: named };
    }
  }
  return sameName === undefined ? {} : { sameName };
}

/** Whether a stored file holds exactly the file's bytes; size first, then digest. */
async function sameBytes(
  candidate: StoredMediaRecord,
  entry: TransferFile["media"][number]
): Promise<boolean> {
  if (candidate.size !== entry.size || candidate.mimeType !== entry.mimeType)
    return false;
  // A file whose bytes cannot be read here is not known to be the same.
  const bytes = await storedBytes(candidate).catch(() => null);
  return bytes !== null && sha256Of(bytes) === entry.sha256;
}

// ---------------------------------------------------------------------------
// Judging
// ---------------------------------------------------------------------------

/** The rights the plan's writes need that the caller lacks, said plainly. */
async function grantProblems(
  ctx: ImportContext,
  file: TransferFile,
  plan: ImportPlan,
  slugs: Collections
): Promise<ImportProblem[]> {
  const can = async (action: string, resource: string) =>
    (await ctx.caller?.can(action, resource)) === true;
  const needs: [boolean, string, string, string][] = [
    [creates(plan, "component"), "create", slugs.component, "add components"],
    [creates(plan, "pattern"), "create", slugs.pattern, "add patterns"],
    [creates(plan, "layout"), "create", slugs.layout, "add Layouts"],
    // An item the file holds published arrives published, which is a publish.
    [
      publishes(file, plan, "component"),
      "publish",
      slugs.component,
      "publish components",
    ],
    [
      publishes(file, plan, "pattern"),
      "publish",
      slugs.pattern,
      "publish patterns",
    ],
    [
      publishes(file, plan, "layout"),
      "publish",
      slugs.layout,
      "publish Layouts",
    ],
    [
      plan.classes.create.length > 0 || plan.tokens.create.length > 0,
      "update",
      slugs.siteStyle,
      "add shared styles and variables to the site style",
    ],
    [
      [...plan.media.values()].some(fate => fate.action === "upload"),
      "create",
      "media",
      "upload media",
    ],
  ];
  const problems: ImportProblem[] = [];
  for (const [needed, action, resource, words] of needs) {
    if (needed && !(await can(action, resource))) {
      problems.push({
        code: "NOT_GRANTED",
        message: `The file needs you to ${words}, which you may not do here.`,
      });
    }
  }
  return problems;
}

function creates(plan: ImportPlan, kind: TransferKind): boolean {
  return [...plan.items[kind].values()].some(fate => fate.action === "create");
}

function publishes(
  file: TransferFile,
  plan: ImportPlan,
  kind: TransferKind
): boolean {
  const items = {
    component: file.components,
    pattern: file.patterns,
    layout: file.layouts,
  }[kind];
  return items.some(
    item =>
      item.status === "published" &&
      plan.items[kind].get(item.id)?.action === "create"
  );
}

/**
 * Every write the import would make, made and rolled back: the site's own
 * checks answer, and nothing stays. Media the plan uploads are named by the
 * file's own ids here, which no check reads.
 */
async function judgeWrites(
  ctx: ImportContext,
  file: TransferFile,
  plan: ImportPlan,
  slugs: Collections
): Promise<ImportProblem[]> {
  const media = new Map<string, string>();
  for (const [fileId, fate] of plan.media) {
    media.set(fileId, fate.action === "existing" ? fate.id : fileId);
  }
  try {
    await writeDocuments(ctx, file, plan, slugs, media);
  } catch (error) {
    // A database adapter can wrap what the transaction threw; the cause is
    // what answered.
    if (inCauses(error, JudgedAndRolledBack) !== undefined) return [];
    const refused = inCauses(error, NextlyError);
    if (refused !== undefined) return [refusedBySite(refused)];
    throw error;
  }
  return [];
}

/** The first error in `error`'s cause chain of the class given. */
function inCauses<T extends Error>(
  error: unknown,
  kind: abstract new (...args: never[]) => T
): T | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
    if (current instanceof kind) return current;
    current = current.cause;
  }
  return undefined;
}

/** A write's refusal in the words the site gave it. */
function refusedBySite(error: NextlyError): ImportProblem {
  const listed = (error.publicData as { errors?: unknown } | undefined)?.errors;
  const messages = Array.isArray(listed)
    ? listed
        .map(entry => (entry as { message?: unknown }).message)
        .filter((message): message is string => typeof message === "string")
    : [];
  return {
    code: "REFUSED_BY_SITE",
    message: messages.length > 0 ? messages.join(" ") : error.publicMessage,
  };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** What the documents' writes made, by the file's ids. */
interface Written {
  readonly components: Map<string, string>;
  readonly patterns: Map<string, string>;
  readonly layouts: Map<string, string>;
}

/**
 * The file's components, patterns and Layouts written in one transaction,
 * with every reference mapped. With no `commit`, the transaction is rolled
 * back once every write has answered (see {@link judgeWrites}).
 */
async function writeDocuments(
  ctx: ImportContext,
  file: TransferFile,
  plan: ImportPlan,
  slugs: Collections,
  media: ReadonlyMap<string, string>,
  commit = false
): Promise<Written> {
  const collections = ctx.services.collections;
  await collections.warmLocalizedReadiness(slugs.component);
  await collections.warmLocalizedReadiness(slugs.pattern);
  await collections.warmLocalizedReadiness(slugs.layout);
  const images = new Map(
    file.components.map(item => [item.id, imageExposureIds(item.content)])
  );
  return collections.withTransaction(async tx => {
    const written: Written = {
      components: new Map(),
      patterns: new Map(),
      layouts: new Map(),
    };
    const componentIds = new Map<string, string>();
    for (const [fileId, fate] of plan.items.component) {
      if (fate.action === "existing") componentIds.set(fileId, fate.id);
    }
    const maps = (): ReferenceMaps => ({
      components: componentIds,
      classes: plan.classes.map,
      tokens: plan.tokens.map,
      breakpoints: plan.breakpoints,
      media,
    });
    const lookups = {
      mediaProps: registryMediaProps,
      imageExposures: (id: string) => images.get(id) ?? new Set<string>(),
    };
    const create = async (collection: string, data: Record<string, unknown>) =>
      createdId(
        await collections.createEntryInTransaction(
          tx,
          collection,
          data,
          asCaller(ctx)
        )
      );

    const components = new Map(file.components.map(item => [item.id, item]));
    for (const fileId of plan.componentOrder) {
      const item = components.get(fileId);
      const fate = plan.items.component.get(fileId);
      if (item === undefined || fate?.action !== "create") continue;
      const id = await create(slugs.component, {
        title: fate.title,
        slug: fate.slug,
        ...optional("description", item.description),
        ...optional("category", item.category),
        ...optional("area", item.area),
        [slugs.field]: rewriteDocument(item.content, maps(), lookups),
        status: item.status,
      });
      componentIds.set(fileId, id);
      written.components.set(fileId, id);
    }
    for (const item of file.patterns) {
      const fate = plan.items.pattern.get(item.id);
      if (fate?.action !== "create") continue;
      const content: BlockDocument = rewriteDocument(
        item.content,
        maps(),
        lookups
      );
      written.patterns.set(
        item.id,
        await create(slugs.pattern, {
          title: fate.title,
          slug: fate.slug,
          ...optional("description", item.description),
          ...optional("category", item.category),
          ...optional("keywords", item.keywords),
          granularity: item.granularity,
          content,
          status: item.status,
        })
      );
    }
    for (const item of file.layouts) {
      const fate = plan.items.layout.get(item.id);
      if (fate?.action !== "create") continue;
      written.layouts.set(
        item.id,
        await create(slugs.layout, {
          title: fate.title,
          slug: fate.slug,
          ...optional("description", item.description),
          areas: item.areas.map(area => ({
            area: area.area,
            component: componentIds.get(area.component) ?? area.component,
          })),
          status: item.status,
        })
      );
    }
    if (!commit) throw new JudgedAndRolledBack();
    return written;
  });
}

function optional(
  key: string,
  value: string | undefined
): Record<string, string> {
  return value === undefined || value === "" ? {} : { [key]: value };
}

/** Apply a ready plan, taking back what it added if a later step fails. */
async function applyPlan(
  ctx: ImportContext,
  file: TransferFile,
  plan: ImportPlan,
  slugs: Collections,
  setup: ImportRouteSetup
): Promise<ImportResult> {
  const uploaded = new Map<string, string>();
  let style: StyleUndo | undefined;
  try {
    for (const entry of file.media) {
      const fate = plan.media.get(entry.id);
      if (fate?.action !== "upload") continue;
      const bytes = Buffer.from(entry.data, "base64");
      const made = await ctx.services.media.upload(
        {
          buffer: bytes,
          filename: fate.filename,
          mimeType: entry.mimeType,
          size: bytes.byteLength,
          ...(entry.altText === undefined ? {} : { altText: entry.altText }),
        },
        asCaller(ctx)
      );
      uploaded.set(entry.id, String(made.id));
    }
    const media = new Map<string, string>();
    for (const [fileId, fate] of plan.media) {
      media.set(
        fileId,
        fate.action === "existing" ? fate.id : (uploaded.get(fileId) ?? fileId)
      );
    }
    style = await writeSiteStyle(ctx, plan, slugs, setup.defaults);
    const written = await writeDocuments(ctx, file, plan, slugs, media, true);
    await reconcileAfterCommit(setup, [
      ...[...written.components.values()].map(documentId => ({
        slug: slugs.component,
        documentId,
      })),
      ...[...written.patterns.values()].map(documentId => ({
        slug: slugs.pattern,
        documentId,
      })),
      ...[...written.layouts.values()].map(documentId => ({
        slug: slugs.layout,
        documentId,
      })),
    ]);
    const rootFate = plan.items[file.root.kind].get(file.root.id);
    const rootWritten = {
      component: written.components,
      pattern: written.patterns,
      layout: written.layouts,
    }[file.root.kind].get(file.root.id);
    const rootId = rootFate?.action === "existing" ? rootFate.id : rootWritten;
    return {
      dryRun: false,
      preview: plan.preview,
      ...(rootId === undefined ? {} : { rootId }),
      created: {
        components: Object.fromEntries(written.components),
        patterns: Object.fromEntries(written.patterns),
        layouts: Object.fromEntries(written.layouts),
        media: Object.fromEntries(uploaded),
      },
    };
  } catch (error) {
    await takeBack(ctx, uploaded, style);
    throw error;
  }
}

/** What the site-style write added, so a failed import can take it back. */
interface StyleUndo {
  readonly classIds: ReadonlySet<string>;
  readonly tokenNames: ReadonlySet<string>;
  readonly breakpointIds: ReadonlySet<string>;
  readonly slug: string;
  /** The configured site style, which the stored breakpoints sit over. */
  readonly defaults: SiteStyleData | undefined;
}

/** Append the plan's new shared styles, variables and breakpoints. */
async function writeSiteStyle(
  ctx: ImportContext,
  plan: ImportPlan,
  slugs: Collections,
  defaults: SiteStyleData | undefined
): Promise<StyleUndo | undefined> {
  const undo: StyleUndo = {
    classIds: new Set(plan.classes.create.map(entry => entry.id)),
    tokenNames: new Set(plan.tokens.create.map(token => token.name)),
    breakpointIds: new Set(plan.addBreakpoints.map(entry => entry.id)),
    slug: slugs.siteStyle,
    defaults,
  };
  const nextly = requireNextly();
  if (plan.classes.create.length > 0 || plan.tokens.create.length > 0) {
    const stored = await nextly.findSingle({
      slug: slugs.siteStyle,
      overrideAccess: true,
    });
    const storedClasses = arrayOf(
      (stored as Record<string, unknown> | null)?.classes
    );
    const storedTokens = recordOf(
      (stored as Record<string, unknown> | null)?.tokens
    );
    const lastIndex = storedClasses.reduce<number>((most, entry) => {
      const index = (entry as { orderIndex?: unknown }).orderIndex;
      return typeof index === "number" && index > most ? index : most;
    }, -1);
    const maps: ReferenceMaps = {
      components: new Map(),
      classes: plan.classes.map,
      tokens: plan.tokens.map,
      breakpoints: plan.breakpoints,
      media: new Map(),
    };
    const classes = plan.classes.create.map((entry, at) =>
      rewriteClass(entry.from, entry.id, entry.slug, lastIndex + 1 + at, maps)
    );
    const tokens: SiteToken[] = [
      ...(arrayOf(storedTokens.tokens) as SiteToken[]),
      ...plan.tokens.create,
    ];
    await nextly.updateSingle({
      slug: slugs.siteStyle,
      data: {
        ...(classes.length > 0
          ? { classes: [...storedClasses, ...classes] }
          : {}),
        ...(plan.tokens.create.length > 0
          ? { tokens: { ...storedTokens, tokens } }
          : {}),
      },
      ...(await readingAsUser(ctx)),
    });
  }
  if (plan.addBreakpoints.length > 0) {
    // The set the site draws with, the configured one included, so writing
    // it back with the additions drops none of the configured breakpoints.
    const style = await loadSiteStyle({
      nextly,
      slug: slugs.siteStyle,
      ...(defaults === undefined ? {} : { defaults }),
    });
    const set: BreakpointSet = {
      viewport: [...(style.breakpoints?.viewport ?? [])],
      container: [...(style.breakpoints?.container ?? [])],
    };
    for (const entry of plan.addBreakpoints) {
      set[entry.axis].push({
        id: entry.id,
        label: entry.label,
        maxWidth: entry.maxWidth,
      });
    }
    await writeBreakpoints(ctx, slugs.siteStyle, set);
  }
  return undo;
}

/** The checked breakpoint write, as Settings' route makes it. */
async function writeBreakpoints(
  ctx: ImportContext,
  slug: string,
  breakpoints: BreakpointSet
): Promise<void> {
  await requireNextly().updateSingle({
    slug,
    data: { breakpoints },
    overrideAccess: true,
    context: { ...SITE_SETTINGS_WRITE_CONTEXT },
    ...(ctx.user === null ? {} : { user: { id: ctx.user.id } }),
  });
}

/**
 * Take back what a failed import added: its uploads, and the shared styles,
 * variables and breakpoints it appended, leaving everything else as it is
 * now. Logged rather than raised, so the failure that started this is the one
 * the caller hears about.
 */
async function takeBack(
  ctx: ImportContext,
  uploaded: ReadonlyMap<string, string>,
  style: StyleUndo | undefined
): Promise<void> {
  for (const id of uploaded.values()) {
    try {
      await ctx.services.media.delete(id);
    } catch (error) {
      ctx.logger?.warn(
        "[page-builder] an import's upload could not be taken back",
        { id, error }
      );
    }
  }
  if (style === undefined) return;
  try {
    const nextly = requireNextly();
    const stored = (await nextly.findSingle({
      slug: style.slug,
      overrideAccess: true,
    })) as Record<string, unknown> | null;
    const classes = arrayOf(stored?.classes).filter(
      entry => !style.classIds.has(String((entry as { id?: unknown }).id))
    );
    const tokens = recordOf(stored?.tokens);
    const keptTokens = arrayOf(tokens.tokens).filter(
      token => !style.tokenNames.has(String((token as { name?: unknown }).name))
    );
    if (style.classIds.size > 0 || style.tokenNames.size > 0) {
      await nextly.updateSingle({
        slug: style.slug,
        data: { classes, tokens: { ...tokens, tokens: keptTokens } },
        overrideAccess: true,
      });
    }
    if (style.breakpointIds.size > 0) {
      const now = await loadSiteStyle({
        nextly,
        slug: style.slug,
        ...(style.defaults === undefined ? {} : { defaults: style.defaults }),
      });
      const without = (axis: "viewport" | "container") =>
        (now.breakpoints?.[axis] ?? []).filter(
          def => !style.breakpointIds.has(def.id)
        );
      await writeBreakpoints(ctx, style.slug, {
        viewport: without("viewport"),
        container: without("container"),
      });
    }
  } catch (error) {
    ctx.logger?.warn(
      "[page-builder] an import's site style could not be taken back",
      { error }
    );
  }
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? [...(value as unknown[])] : [];
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/** The import route declaration. */
export function importRoute(setup: ImportRouteSetup = {}): {
  method: "POST";
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: IMPORT_ROUTE_PATH,
    // Signed in is all reaching the route asks: what a file needs depends on
    // what it holds, so the handler asks for the right to add the file's own
    // kind of item before it reads anything, and the preview names each
    // other right the writes need.
    handler: (req, ctx) => importFile(req, ctx, setup),
  };
}

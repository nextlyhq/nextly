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
  type NamedClass,
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
  readOrNull,
  reconcileAfterCommit,
  requirePluginStore,
  storeOf,
  type CompositionRouteContext,
  type CompositionRouteSetup,
} from "../composition-route-kit";
import { readingAsUser, type ComponentStore } from "../library-route";
import type { SiteStyleData } from "../site-style";
import { checkStoredClasses, checkStoredTokens } from "../site-style-record";
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
  TRANSFER_JUDGEMENT_CONTEXT,
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
    media: Pick<
      PluginRouteContext["services"]["media"],
      "upload" | "update" | "delete"
    >;
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
    plan = withProblems(plan, await styleProblems(plan, slugs.siteStyle));
  }
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
  // What the caller may not read is not compared with, so the preview says
  // nothing about it; the import then asks for the read it needs.
  const can = async (action: string, resource: string) =>
    (await ctx.caller?.can(action, resource)) === true;
  const readsStyle = await can("read", slugs.siteStyle);
  return {
    items: {
      component: await existingItems(ctx, slugs.component, file.components),
      pattern: await existingItems(ctx, slugs.pattern, file.patterns),
      layout: await existingItems(ctx, slugs.layout, file.layouts),
    },
    classes: readsStyle ? usableNamedClasses(style.classes ?? []) : [],
    tokens: readsStyle ? resolveSiteTokens(style.tokens).tokens : [],
    // The whole set, its unbounded base row included: a file breakpoint
    // always has a width, so it never matches the base, and the base counts
    // toward an axis's room as the stored set's own check counts it.
    breakpoints: {
      viewport: [...(style.breakpoints?.viewport ?? [])],
      container: [...(style.breakpoints?.container ?? [])],
    },
    media: (await can("read", "media"))
      ? await existingMedia(ctx, file)
      : new Map(),
    isRegistered: type => type === COMPONENT_INSTANCE_TYPE || hasBlock(type),
    mayAddBreakpoints: await can("manage", "page-builder-site"),
  };
}

/** The rows holding a slug the file uses or would rename one to. */
async function existingItems(
  ctx: ImportContext,
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
  return { bySlug: await readableBy(ctx, collection, bySlug), taken };
}

/**
 * The clashes the caller may read. One it may not read keeps its slug taken,
 * so the file's item is still renamed around it, but it is neither named in
 * the preview nor offered to point the file at.
 */
async function readableBy(
  ctx: ImportContext,
  collection: string,
  clashes: ReadonlyMap<string, { id: string; title: string; slug: string }>
): Promise<Map<string, { id: string; title: string; slug: string }>> {
  if (clashes.size === 0) return new Map();
  const ids = [...clashes.values()].map(clash => clash.id);
  const readable = new Set<string>();
  for (let at = 0; at < ids.length; at += 200) {
    const chunk = ids.slice(at, at + 200);
    const found = await readOrNull(async () =>
      requireNextly().find({
        collection,
        where: { id: { in: chunk } },
        ...(await readingAsUser(ctx)),
        status: "all",
        select: { id: true },
        limit: chunk.length,
        depth: 0,
      })
    );
    // A caller refused the collection outright reads none of it.
    const rows = (found as { items?: { id?: unknown }[] } | null)?.items ?? [];
    for (const row of rows) readable.add(String(row.id));
  }
  return new Map([...clashes].filter(([, clash]) => readable.has(clash.id)));
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
  ctx: ImportContext,
  file: TransferFile
): Promise<Map<string, ExistingMedia>> {
  const met = new Map<string, ExistingMedia>();
  for (const entry of file.media) {
    met.set(entry.id, await metMedia(ctx, entry));
  }
  return met;
}

/** What one media file meets here, as {@link existingMedia} describes. */
async function metMedia(
  ctx: ImportContext,
  entry: TransferFile["media"][number]
): Promise<ExistingMedia> {
  const dot = entry.filename.lastIndexOf(".");
  const stem = dot > 0 ? entry.filename.slice(0, dot) : entry.filename;
  // As the caller: a file it may not read is neither reused nor offered.
  const found = await requireNextly().media.find({
    search: stem,
    limit: 50,
    ...(await readingAsUser(ctx)),
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
    // Reusing what is here, and comparing with it, is reading it.
    [
      file.classes.length > 0 || file.tokens.length > 0,
      "read",
      slugs.siteStyle,
      "read the site style",
    ],
    [file.media.length > 0, "read", "media", "read media"],
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
    // A judging write tells the hooks it runs, so one with an effect the
    // rollback cannot undo (a message sent, a service called) can wait for
    // the import that commits.
    const options = commit
      ? asCaller(ctx)
      : { ...asCaller(ctx), context: { [TRANSFER_JUDGEMENT_CONTEXT]: true } };
    const create = async (collection: string, data: Record<string, unknown>) =>
      createdId(
        await collections.createEntryInTransaction(
          tx,
          collection,
          data,
          options
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
  // Known before anything is written, so a failure partway through the
  // site-style writes still takes back the part that landed.
  const style = styleUndo(slugs, setup.defaults);
  let written: Written;
  try {
    await uploadMedia(ctx, file, plan, uploaded);
    const media = new Map<string, string>();
    for (const [fileId, fate] of plan.media) {
      media.set(
        fileId,
        fate.action === "existing" ? fate.id : (uploaded.get(fileId) ?? fileId)
      );
    }
    await writeSiteStyle(ctx, plan, style);
    written = await writeDocuments(ctx, file, plan, slugs, media, true);
  } catch (error) {
    await takeBack(ctx, uploaded, style);
    throw error;
  }
  // The documents are committed from here on, so nothing is taken back: an
  // index the reconciliation could not bring up to date is the usage
  // health's to report and repair, not a reason to call the import failed.
  try {
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
  } catch (error) {
    ctx.logger?.warn(
      "[page-builder] an import's usage indexes could not be brought up to date",
      { error }
    );
  }
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
}

/**
 * Upload the plan's new media as the caller, recording each as it lands so a
 * later failure can take it back. A caption is set on the new file once it
 * exists, as the system: the upload takes none, and the file is the import's
 * own.
 */
async function uploadMedia(
  ctx: ImportContext,
  file: TransferFile,
  plan: ImportPlan,
  uploaded: Map<string, string>
): Promise<void> {
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
    const id = String(made.id);
    uploaded.set(entry.id, id);
    if (entry.caption !== undefined) {
      await ctx.services.media.update(id, { caption: entry.caption });
    }
  }
}

/**
 * What this request's site-style writes added, so a failed import takes back
 * exactly that. Filled as each write lands, and only with what was absent
 * just before it: an entry another request added under the same id is that
 * request's, and is neither written again nor taken back here.
 */
interface StyleUndo {
  readonly classIds: Set<string>;
  readonly tokenNames: Set<string>;
  readonly breakpointIds: Set<string>;
  readonly slug: string;
  /** The configured site style, which the stored breakpoints sit over. */
  readonly defaults: SiteStyleData | undefined;
}

/** An empty record of what the site-style writes will add. */
function styleUndo(
  slugs: Collections,
  defaults: SiteStyleData | undefined
): StyleUndo {
  return {
    classIds: new Set(),
    tokenNames: new Set(),
    breakpointIds: new Set(),
    slug: slugs.siteStyle,
    defaults,
  };
}

/** Append the plan's new shared styles, variables and breakpoints. */
async function writeSiteStyle(
  ctx: ImportContext,
  plan: ImportPlan,
  undo: StyleUndo
): Promise<void> {
  if (plan.classes.create.length > 0 || plan.tokens.create.length > 0) {
    await appendStylesAndVariables(ctx, plan, undo);
  }
  if (plan.addBreakpoints.length > 0) {
    await appendBreakpoints(ctx, plan, undo);
  }
}

/** The site style's stored classes and variables with the plan's new ones appended. */
interface PlannedStyle {
  readonly storedClasses: unknown[];
  readonly storedTokens: Record<string, unknown>;
  /** The new classes and variables, those another request already added left out. */
  readonly classes: NamedClass[];
  readonly tokens: SiteToken[];
}

async function plannedStyle(
  plan: ImportPlan,
  slug: string
): Promise<PlannedStyle> {
  const stored = (await requireNextly().findSingle({
    slug,
    overrideAccess: true,
  })) as Record<string, unknown> | null;
  const storedClasses = arrayOf(stored?.classes);
  const storedTokens = recordOf(stored?.tokens);
  const heldIds = new Set(
    storedClasses.map(entry => String((entry as { id?: unknown }).id))
  );
  const heldNames = new Set(
    arrayOf(storedTokens.tokens).map(token =>
      String((token as { name?: unknown }).name)
    )
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
  return {
    storedClasses,
    storedTokens,
    classes: plan.classes.create
      .filter(entry => !heldIds.has(entry.id))
      .map((entry, at) =>
        rewriteClass(entry.from, entry.id, entry.slug, lastIndex + 1 + at, maps)
      ),
    tokens: plan.tokens.create.filter(token => !heldNames.has(token.name)),
  };
}

/** The stored sections a planned style would write, as the Single takes them. */
function styleSections(planned: PlannedStyle): Record<string, unknown> {
  const { storedClasses, storedTokens, classes, tokens } = planned;
  return {
    ...(classes.length > 0 ? { classes: [...storedClasses, ...classes] } : {}),
    ...(tokens.length > 0
      ? {
          tokens: {
            ...storedTokens,
            tokens: [
              ...(arrayOf(storedTokens.tokens) as SiteToken[]),
              ...tokens,
            ],
          },
        }
      : {}),
  };
}

/**
 * Whether the site style would take the plan's new classes and variables, by
 * the Single's own checks, so a preview never promises a write it refuses.
 */
async function styleProblems(
  plan: ImportPlan,
  slug: string
): Promise<ImportProblem[]> {
  if (plan.classes.create.length === 0 && plan.tokens.create.length === 0) {
    return [];
  }
  const sections = styleSections(await plannedStyle(plan, slug));
  const issues = [
    ...(sections.classes === undefined
      ? []
      : checkStoredClasses(sections.classes).issues),
    ...(sections.tokens === undefined
      ? []
      : checkStoredTokens(sections.tokens).issues),
  ];
  return issues.map(message => ({ code: "REFUSED_BY_SITE", message }));
}

async function appendStylesAndVariables(
  ctx: ImportContext,
  plan: ImportPlan,
  undo: StyleUndo
): Promise<void> {
  const planned = await plannedStyle(plan, undo.slug);
  if (planned.classes.length === 0 && planned.tokens.length === 0) return;
  await requireNextly().updateSingle({
    slug: undo.slug,
    data: styleSections(planned),
    ...(await readingAsUser(ctx)),
  });
  for (const entry of planned.classes) undo.classIds.add(entry.id);
  for (const token of planned.tokens) undo.tokenNames.add(token.name);
}

async function appendBreakpoints(
  ctx: ImportContext,
  plan: ImportPlan,
  undo: StyleUndo
): Promise<void> {
  // The set the site draws with, the configured one included, so writing it
  // back with the additions drops none of the configured breakpoints.
  const style = await loadSiteStyle({
    nextly: requireNextly(),
    slug: undo.slug,
    ...(undo.defaults === undefined ? {} : { defaults: undo.defaults }),
  });
  const set: BreakpointSet = {
    viewport: [...(style.breakpoints?.viewport ?? [])],
    container: [...(style.breakpoints?.container ?? [])],
  };
  const held = new Set([...set.viewport, ...set.container].map(def => def.id));
  const added = plan.addBreakpoints.filter(entry => !held.has(entry.id));
  if (added.length === 0) return;
  for (const entry of added) {
    set[entry.axis].push({
      id: entry.id,
      label: entry.label,
      maxWidth: entry.maxWidth,
    });
  }
  await writeBreakpoints(ctx, undo.slug, set);
  for (const entry of added) undo.breakpointIds.add(entry.id);
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

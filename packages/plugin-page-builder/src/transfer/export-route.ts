/**
 * The export routes: one file holding a component, a pattern or a Layout and
 * everything it depends on, read as the caller.
 *
 * - `POST /transfer/components/:id/export`
 * - `POST /transfer/patterns/:id/export`
 * - `POST /transfer/layouts/:id/export`
 *
 * Each needs read on its own collection to be reached. What the item depends
 * on is read as the caller too, and the export is refused, naming what could
 * not be read, when a placed component, a shared style's library or a media
 * file is out of the caller's reach. A file missing a part would import as an
 * item that renders differently, which is worse than no file.
 *
 * Each item is exported in the form visitors get when it has one, otherwise
 * as its draft, and the file says which (see `transfer-contract`).
 *
 * @module transfer/export-route
 */
import {
  BASE_BREAKPOINT,
  isComponentDocument,
  resolveSiteTokens,
  tokenIdentity,
  usableNamedClasses,
  type BlockDocument,
  type BreakpointSet,
  type NamedClass,
  type SiteToken,
} from "@nextlyhq/blocks-engine";
import {
  NextlyError,
  respondDoc,
  type PluginRouteContext,
  type PluginRoutePermissionScope,
} from "@nextlyhq/plugin-sdk";
import { requireNextly } from "nextly/runtime";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PATTERNS_SLUG } from "../collections/patterns";
import {
  readOrNull,
  requirePluginStore,
  storeOf,
  type CompositionRouteContext,
} from "../composition-route-kit";
import { relationId } from "../default-layout/store";
import { readingAsUser, type ComponentStore } from "../library-route";
import type { SiteStyleData } from "../site-style";
import { loadSiteStyle, SITE_STYLE_SLUG } from "../site-style-storage";

import {
  MAX_TRANSFER_MEDIA_BYTES,
  TRANSFER_FORMAT,
  TRANSFER_FORMAT_VERSION,
  TRANSFER_KIND_PATHS,
  TRANSFER_KINDS,
  type TransferBreakpoint,
  type TransferComponent,
  type TransferFile,
  type TransferKind,
  type TransferLayout,
  type TransferMedia,
  type TransferPattern,
  type TransferStatus,
} from "./transfer-contract";
import {
  sha256Of,
  storedBytes,
  type StoredMediaRecord,
} from "./transfer-media";
import {
  collectDocumentReferences,
  collectStyleReferences,
  emptyReferences,
  imageExposureIds,
  type TransferReferences,
} from "./transfer-references";

/**
 * The most components one file carries. A closure past it is refused rather
 * than read row by row without end.
 */
const MAX_TRANSFER_COMPONENTS = 500;

/** The reads an export makes, each as the caller; swapped in unit tests. */
export interface ExportReads {
  /** A row in the form visitors get, else its never-published draft; `null` when unreadable. */
  readonly row: (
    collection: string,
    id: string
  ) => Promise<Record<string, unknown> | null>;
  /** Many rows at once, by id, each as `row` reads it; an unreadable one is absent. */
  readonly rows: (
    collection: string,
    ids: readonly string[]
  ) => Promise<Map<string, Record<string, unknown>>>;
  readonly siteStyle: () => Promise<SiteStyleData>;
  readonly media: (id: string) => Promise<StoredMediaRecord | null>;
  /** A media file's bytes, or `null` when its object is gone. */
  readonly bytes: (media: StoredMediaRecord) => Promise<Buffer | null>;
}

/** What the export routes are built with. */
export interface ExportRouteSetup {
  readonly store?: ComponentStore;
  /** The site style the plugin's config declares, under the stored one. */
  readonly defaults?: SiteStyleData;
  readonly reads?: (ctx: CompositionRouteContext) => ExportReads;
}

/** The context an export handler runs with. */
type ExportContext = CompositionRouteContext;

/** Write the file for one item, as the docblock describes. */
async function exportItem(
  kind: TransferKind,
  ctx: ExportContext,
  setup: ExportRouteSetup = {}
): Promise<Response> {
  requirePluginStore(ctx, setup);
  const reads = setup.reads?.(ctx) ?? directReads(ctx, setup);
  const slugs = collectionsOf(ctx, setup);
  const id = ctx.params?.id ?? "";
  const row = await reads.row(slugs[kind], id);
  if (row === null) {
    throw NextlyError.notFound({
      logContext: { reason: "transfer-export-missing", kind, id },
    });
  }
  const root = rootItem(kind, id, row, slugs.field);
  const components = await placedClosure(root, reads, slugs);

  const references = emptyReferences();
  const images = new Map<string, ReadonlySet<string>>();
  for (const component of components.values()) {
    images.set(component.id, imageExposureIds(component.content));
  }
  const documents = [
    ...root.patterns.map(item => item.content),
    ...[...components.values()].map(item => item.content),
  ];
  for (const document of documents) {
    collectDocumentReferences(document, references, {
      imageExposures: componentId => images.get(componentId) ?? new Set(),
    });
  }

  const style = await siteStyleFor(ctx, reads, references);
  const media = await mediaFor(ctx, reads, references);

  const file: TransferFile = {
    format: TRANSFER_FORMAT,
    formatVersion: TRANSFER_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    root: { kind, id },
    components: [...components.values()],
    patterns: root.patterns,
    layouts: root.layouts,
    classes: style.classes,
    tokens: style.tokens,
    breakpoints: style.breakpoints,
    media,
    blockTypes: [...references.blockTypes].sort(),
  };
  return respondDoc(file);
}

/** The item a file is made from, and the components it names directly. */
interface RootItem {
  readonly components: readonly TransferComponent[];
  readonly patterns: TransferPattern[];
  readonly layouts: TransferLayout[];
  readonly places: readonly string[];
}

function rootItem(
  kind: TransferKind,
  id: string,
  row: Record<string, unknown>,
  field: string
): RootItem {
  if (kind === "component") {
    const item = componentItem(id, row, field);
    return {
      components: [item],
      patterns: [],
      layouts: [],
      places: placedIn(item.content),
    };
  }
  if (kind === "pattern") {
    const item = patternItem(id, row);
    return {
      components: [],
      patterns: [item],
      layouts: [],
      places: placedIn(item.content),
    };
  }
  const item = layoutItem(id, row);
  return {
    components: [],
    patterns: [],
    layouts: [item],
    places: item.areas.map(area => area.component),
  };
}

/**
 * The root's components and every one they place, breadth first. A loop ends
 * here because a component read once is never read again; the file carries
 * the loop as stored, and an import refuses it (every write path does).
 */
async function placedClosure(
  root: RootItem,
  reads: ExportReads,
  slugs: Record<TransferKind, string> & { field: string }
): Promise<Map<string, TransferComponent>> {
  const components = new Map(root.components.map(item => [item.id, item]));
  let layer = [
    ...root.places,
    ...root.components.flatMap(item => placedIn(item.content)),
  ];
  // One read per layer of the closure, not one per component.
  while (layer.length > 0) {
    const next = [...new Set(layer)].filter(id => !components.has(id));
    if (next.length === 0) break;
    if (components.size + next.length > MAX_TRANSFER_COMPONENTS) {
      throw refusal(
        `It places more than ${String(MAX_TRANSFER_COMPONENTS)} components, more than one file carries.`,
        "transfer-export-too-many-components"
      );
    }
    const rows = await reads.rows(slugs.component, next);
    layer = [];
    for (const id of next) {
      const row = rows.get(id);
      if (row === undefined) {
        throw refusal(
          `It places a component (${id}) that is missing or that you may not read, so the file would be incomplete.`,
          "transfer-export-component-unreadable"
        );
      }
      const item = componentItem(id, row, slugs.field);
      components.set(id, item);
      layer.push(...placedIn(item.content));
    }
  }
  return components;
}

/** The collections and field an export reads from, as the host named them. */
function collectionsOf(
  ctx: ExportContext,
  setup: ExportRouteSetup
): Record<TransferKind, string> & { field: string } {
  const store = storeOf(ctx, setup);
  return {
    component: store.collection,
    pattern: ctx.self.collections[PATTERNS_SLUG] ?? PATTERNS_SLUG,
    layout: ctx.self.collections[LAYOUTS_SLUG] ?? LAYOUTS_SLUG,
    field: store.field,
  };
}

/** The ids of the components a document places, in document order. */
function placedIn(document: BlockDocument): string[] {
  const references = emptyReferences();
  collectDocumentReferences(document, references, { mediaProps: () => [] });
  return [...references.components];
}

function componentItem(
  id: string,
  row: Record<string, unknown>,
  field: string
): TransferComponent {
  const content = row[field];
  if (!isDocument(content) || !isComponentDocument(content)) {
    throw refusal(
      `The component ${id} holds no definition, so it cannot be exported.`,
      "transfer-export-component-empty"
    );
  }
  return {
    ...itemBase(id, row),
    ...optionalText(row, "category"),
    ...optionalText(row, "area"),
    content,
  };
}

function patternItem(
  id: string,
  row: Record<string, unknown>
): TransferPattern {
  const content = row.content;
  if (!isDocument(content)) {
    throw refusal(
      "The pattern holds no content, so it cannot be exported.",
      "transfer-export-pattern-empty"
    );
  }
  return {
    ...itemBase(id, row),
    ...optionalText(row, "category"),
    ...optionalText(row, "keywords"),
    granularity: textOf(row.granularity),
    content,
  };
}

function layoutItem(id: string, row: Record<string, unknown>): TransferLayout {
  const areas: { area: string; component: string }[] = [];
  for (const entry of Array.isArray(row.areas) ? row.areas : []) {
    const area = (entry as { area?: unknown } | null)?.area;
    const component = relationId(
      (entry as { component?: unknown } | null)?.component
    );
    if (typeof area === "string" && area !== "" && component !== null) {
      areas.push({ area, component });
    }
  }
  return { ...itemBase(id, row), areas };
}

function itemBase(
  id: string,
  row: Record<string, unknown>
): Pick<TransferComponent, "id" | "title" | "slug" | "description" | "status"> {
  const status: TransferStatus =
    row.status === "published" ? "published" : "draft";
  return {
    id,
    title: textOf(row.title),
    slug: textOf(row.slug),
    ...optionalText(row, "description"),
    status,
  };
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(
  row: Record<string, unknown>,
  key: string
): Record<string, string> {
  return textField(key, row[key]);
}

function isDocument(value: unknown): value is BlockDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { nodes?: unknown }).nodes)
  );
}

/** What the file carries from the site style: only what its documents use. */
async function siteStyleFor(
  ctx: ExportContext,
  reads: ExportReads,
  references: TransferReferences
): Promise<{
  classes: NamedClass[];
  tokens: SiteToken[];
  breakpoints: TransferBreakpoint[];
}> {
  references.breakpoints.delete(BASE_BREAKPOINT);
  if (
    references.classes.size === 0 &&
    references.tokens.size === 0 &&
    references.breakpoints.size === 0
  ) {
    return { classes: [], tokens: [], breakpoints: [] };
  }
  await requireRead(ctx, ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG);
  const style = await reads.siteStyle();
  const classes = usableNamedClasses(style.classes ?? []).filter(entry =>
    references.classes.has(entry.id)
  );
  // A shared style's own styles name variables and breakpoints too.
  for (const entry of classes) collectStyleReferences(entry.styles, references);
  references.breakpoints.delete(BASE_BREAKPOINT);
  const tokens = resolveSiteTokens(style.tokens).tokens.filter(token =>
    references.tokens.has(tokenIdentity(token))
  );
  return {
    classes,
    tokens: [...tokens],
    breakpoints: breakpointsUsed(style.breakpoints, references.breakpoints),
  };
}

/**
 * The definitions of the breakpoints named, from the site's set. A name the
 * site no longer defines has nothing to carry: what is stored under it is
 * drawn nowhere, and an import leaves it out.
 */
function breakpointsUsed(
  set: BreakpointSet | undefined,
  named: ReadonlySet<string>
): TransferBreakpoint[] {
  const used: TransferBreakpoint[] = [];
  for (const axis of ["viewport", "container"] as const) {
    for (const def of set?.[axis] ?? []) {
      if (!named.has(def.id) || def.maxWidth === undefined) continue;
      used.push({
        id: def.id,
        label: def.label,
        axis,
        maxWidth: def.maxWidth,
      });
    }
  }
  return used;
}

/** Every media file the documents show, with its bytes. */
async function mediaFor(
  ctx: ExportContext,
  reads: ExportReads,
  references: TransferReferences
): Promise<TransferMedia[]> {
  if (references.media.size === 0) return [];
  await requireRead(ctx, "media");
  const carried: TransferMedia[] = [];
  let total = 0;
  for (const id of [...references.media].sort()) {
    const entry = await mediaEntry(id, reads);
    total += entry.size;
    if (total > MAX_TRANSFER_MEDIA_BYTES) {
      throw refusal(
        `Its media come to more than ${String(MAX_TRANSFER_MEDIA_BYTES / (1024 * 1024))} MB, more than one file carries.`,
        "transfer-export-media-too-large"
      );
    }
    carried.push(entry);
  }
  return carried;
}

/** One media file as the file carries it, or the refusal naming why not. */
async function mediaEntry(
  id: string,
  reads: ExportReads
): Promise<TransferMedia> {
  const record = await reads.media(id);
  if (record === null) {
    throw refusal(
      `It shows a media file (${id}) that is missing or that you may not read, so the file would be incomplete.`,
      "transfer-export-media-unreadable"
    );
  }
  const bytes = await reads.bytes(record);
  if (bytes === null) {
    throw refusal(
      `The media file "${record.originalFilename}" is listed but its stored file is gone, so it cannot be exported.`,
      "transfer-export-media-gone"
    );
  }
  return {
    id,
    filename: record.originalFilename || record.filename,
    mimeType: record.mimeType,
    size: bytes.byteLength,
    ...numberField("width", record.width),
    ...numberField("height", record.height),
    ...textField("altText", record.altText),
    ...textField("caption", record.caption),
    sha256: sha256Of(bytes),
    data: bytes.toString("base64"),
  };
}

function numberField(
  key: string,
  value: number | null | undefined
): Record<string, number> {
  return typeof value === "number" ? { [key]: value } : {};
}

function textField(key: string, value: unknown): Record<string, string> {
  return typeof value === "string" && value !== "" ? { [key]: value } : {};
}

/** Refuse unless the caller may read `resource`. */
async function requireRead(
  ctx: ExportContext,
  resource: string
): Promise<void> {
  if ((await ctx.caller?.can("read", resource)) === true) return;
  throw NextlyError.forbidden({
    logContext: { reason: "transfer-export-not-granted", resource },
  });
}

function refusal(message: string, reason: string): NextlyError {
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: message,
    publicData: { errors: [{ path: "id", code: "EXPORT_REFUSED", message }] },
    logMessage: "Refused an export",
    logContext: { reason },
  });
}

/** The reads on a live server, each as the caller. */
function directReads(ctx: ExportContext, setup: ExportRouteSetup): ExportReads {
  return {
    row: async (collection, id) => {
      const row = await readOrNull(async () =>
        requireNextly().findByID({
          collection,
          id,
          ...(await readingAsUser(ctx)),
          // The live row: the published form where there is one, the draft
          // where the item was never published.
          status: "all",
          depth: 0,
        })
      );
      return typeof row === "object" && row !== null
        ? (row as Record<string, unknown>)
        : null;
    },
    rows: async (collection, ids) => {
      const found = new Map<string, Record<string, unknown>>();
      for (let at = 0; at < ids.length; at += 100) {
        const chunk = ids.slice(at, at + 100);
        const page = await readOrNull(async () =>
          requireNextly().find({
            collection,
            where: { id: { in: [...chunk] } },
            ...(await readingAsUser(ctx)),
            status: "all",
            depth: 0,
            limit: chunk.length,
          })
        );
        const items = (page as { items?: unknown[] } | null)?.items ?? [];
        for (const row of items) {
          if (typeof row !== "object" || row === null) continue;
          const record = row as Record<string, unknown>;
          found.set(String(record.id), record);
        }
      }
      return found;
    },
    siteStyle: async () =>
      loadSiteStyle({
        nextly: requireNextly(),
        slug: ctx.self.singles[SITE_STYLE_SLUG] ?? SITE_STYLE_SLUG,
        ...(setup.defaults === undefined ? {} : { defaults: setup.defaults }),
      }),
    media: async id => {
      const record = await readOrNull(async () =>
        requireNextly().media.findByID({
          id,
          ...(await readingAsUser(ctx)),
          disableErrors: true,
        })
      );
      return typeof record === "object" && record !== null
        ? (record as StoredMediaRecord)
        : null;
    },
    bytes: storedBytes,
  };
}

/** The three export route declarations, one per kind of item. */
export function exportRoutes(setup: ExportRouteSetup = {}): {
  method: "POST";
  path: string;
  requiredPermission: (scope: PluginRoutePermissionScope) => string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
}[] {
  const readOn: Record<
    TransferKind,
    (scope: PluginRoutePermissionScope) => string
  > = {
    component: ({ collection }) =>
      setup.store?.collection === undefined
        ? collection(COMPONENTS_SLUG, "read")
        : `read-${setup.store.collection}`,
    pattern: ({ collection }) => collection(PATTERNS_SLUG, "read"),
    layout: ({ collection }) => collection(LAYOUTS_SLUG, "read"),
  };
  return TRANSFER_KINDS.map(kind => ({
    method: "POST" as const,
    path: `/transfer/${TRANSFER_KIND_PATHS[kind]}/:id/export`,
    requiredPermission: readOn[kind],
    handler: (_req: Request, ctx: PluginRouteContext) =>
      exportItem(kind, ctx, setup),
  }));
}

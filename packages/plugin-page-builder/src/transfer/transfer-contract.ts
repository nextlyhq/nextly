/**
 * The file a pattern, a component or a Layout travels between sites in, and
 * the route that writes it, named where the admin and the server can both
 * read them. Free of runtime imports, for the reason `library-contract` is.
 *
 * ## What one file holds
 *
 * The item and everything it depends on: the components it places (and the
 * ones those place), the shared styles and the variables its styles use, the
 * images it shows, and the breakpoints its styles and per-device hide settings
 * name. Content only, never a block's code: the file lists the block types it
 * uses, so the site it goes to can say which it lacks.
 *
 * Every reference inside the file is the SOURCE site's id, exactly as stored:
 * a placement's `componentId`, a node's class ids, a `$token`, a breakpoint id
 * in a style or a hide setting, a media id. The file's own lists are keyed by
 * those same ids, so a reader resolves every reference inside the file and an
 * import remaps them all in one pass.
 *
 * What is never carried: the site's default Layout mark (it belongs to the
 * site, and lives in the plugin's settings Single, not on the Layout), the
 * usage index, versions and drafts beyond the one form exported, and who made
 * anything.
 *
 * @module transfer/transfer-contract
 */
import type {
  BlockDocument,
  ComponentDocument,
  NamedClass,
  SiteToken,
} from "@nextlyhq/blocks-engine";

import type { ActionBy } from "../component-actions-contract";

/** What a transfer file says it is, so any other JSON is told apart at once. */
export const TRANSFER_FORMAT = "nextly-page-builder-transfer";

/** The file's version. A reader refuses one it does not know. */
export const TRANSFER_FORMAT_VERSION = 1;

/** The kinds of item a file can be made from. */
export const TRANSFER_KINDS = ["component", "pattern", "layout"] as const;

/** One of the kinds of item a file can be made from. */
export type TransferKind = (typeof TRANSFER_KINDS)[number];

/**
 * The most media bytes one export carries, all files together, before they
 * are written as base64. Past it the export is refused rather than written
 * as a file no import route would accept.
 */
export const MAX_TRANSFER_MEDIA_BYTES: number = 20 * 1024 * 1024;

/** Which form of an item the file holds: what visitors get, or a draft. */
export type TransferStatus = "published" | "draft";

/** What every item in the file carries. */
interface TransferItemBase {
  /** The item's id on the site it came from; the file's references use it. */
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description?: string;
  /**
   * The published form when the item has one, else its draft. An import keeps
   * the status, so a draft stays a draft and is offered nowhere until
   * published.
   */
  readonly status: TransferStatus;
}

/** A component definition, its document as stored. */
export interface TransferComponent extends TransferItemBase {
  readonly category?: string;
  readonly area?: string;
  readonly content: ComponentDocument;
}

/** A pattern, its document as stored. */
export interface TransferPattern extends TransferItemBase {
  readonly category?: string;
  readonly keywords?: string;
  readonly granularity: string;
  readonly content: BlockDocument;
}

/** A Layout: which component fills each area, by the file's component ids. */
export interface TransferLayout extends TransferItemBase {
  readonly areas: readonly {
    readonly area: string;
    readonly component: string;
  }[];
}

/** Which axis a breakpoint measures: the window, or the box around a block. */
export type TransferBreakpointAxis = "viewport" | "container";

/**
 * A breakpoint the file's styles or hide settings name. Its width range is
 * its axis and `maxWidth`: a style under it applies at that width and below,
 * so two breakpoints cover the same range exactly when both agree.
 */
export interface TransferBreakpoint {
  readonly id: string;
  readonly label: string;
  readonly axis: TransferBreakpointAxis;
  readonly maxWidth: number;
}

/** An uploaded file the item shows, with its bytes. */
export interface TransferMedia {
  /** The media id on the site it came from; the file's references use it. */
  readonly id: string;
  /** The name it was uploaded under. */
  readonly filename: string;
  readonly mimeType: string;
  /** The length of `data` once decoded. */
  readonly size: number;
  readonly width?: number;
  readonly height?: number;
  readonly altText?: string;
  readonly caption?: string;
  /** SHA-256 of the bytes, hex, so an identical file already on a site is found. */
  readonly sha256: string;
  /** The bytes, base64. */
  readonly data: string;
}

/** One transfer file. */
export interface TransferFile {
  readonly format: typeof TRANSFER_FORMAT;
  readonly formatVersion: typeof TRANSFER_FORMAT_VERSION;
  readonly exportedAt: string;
  /** The item the file was made from; the rest is what it depends on. */
  readonly root: { readonly kind: TransferKind; readonly id: string };
  readonly components: readonly TransferComponent[];
  readonly patterns: readonly TransferPattern[];
  readonly layouts: readonly TransferLayout[];
  /** The shared styles the file's documents use, as the source site defines them. */
  readonly classes: readonly NamedClass[];
  /** The variables the file's styles use, with the values the source site gives them. */
  readonly tokens: readonly SiteToken[];
  readonly breakpoints: readonly TransferBreakpoint[];
  readonly media: readonly TransferMedia[];
  /** Every block type the file's documents use, sorted. */
  readonly blockTypes: readonly string[];
}

/** The collection each kind of item lives in, as the route paths name it. */
export const TRANSFER_KIND_PATHS: Readonly<Record<TransferKind, string>> = {
  component: "components",
  pattern: "patterns",
  layout: "layouts",
};

/**
 * `POST /transfer/<components|patterns|layouts>/:id/export`: the file for
 * one item, as the caller may read it. Answers with the file itself.
 *
 * @experimental Settles when the composition API ships.
 */
export function exportPath(kind: TransferKind, id: string): string {
  return `/transfer/${TRANSFER_KIND_PATHS[kind]}/${encodeURIComponent(id)}/export`;
}

/**
 * The admin component above the Components, Patterns and Layouts lists that
 * imports a file, as the collections name it for the list's slot.
 */
export const TRANSFER_IMPORT_COMPONENT =
  "@nextlyhq/plugin-page-builder/admin#TransferImport";

/** A file name for an export: the item's slug, its kind, and the format. */
export function transferFileName(file: TransferFile): string {
  const all = [...file.components, ...file.patterns, ...file.layouts];
  const root = all.find(item => item.id === file.root.id);
  const stem = (root?.slug ?? file.root.kind).replace(/[^a-z0-9-]+/gi, "-");
  return `${stem}.${file.root.kind}.nextly.json`;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * `POST /transfer/import`: read a file against this site and say what it
 * would do (`dryRun: true`), or do it. Nothing is written by a dry run, and
 * an import writes nothing until every refusal is settled.
 *
 * @experimental Settles when the composition API ships.
 */
export const IMPORT_ROUTE_PATH = "/transfer/import";

/**
 * The hook context key an import's judging writes carry. Before anything is
 * kept, every write the import would make is made and rolled back, so the
 * site's own checks answer; hooks run for those writes too, and one with an
 * effect a rollback cannot undo skips it when this key is `true`.
 *
 * @experimental Settles when the composition API ships.
 */
export const TRANSFER_JUDGEMENT_CONTEXT = "pageBuilder.transferJudgement";

/** The kinds of thing in a file that can clash with one already on the site. */
export type ImportConflictKind =
  | "component"
  | "pattern"
  | "layout"
  | "class"
  | "token"
  | "media";

/**
 * What to do with an item that clashes with one already on the site: add it
 * under a new name, the file's references pointing at it (the default), or
 * point the file's references at the existing item. An import never
 * overwrites what is there.
 */
export type ImportConflictChoice = "rename" | "existing";

/**
 * What to do with a breakpoint the site has no exact match for: add it to the
 * site (only for someone who may manage site settings, and only while its
 * axis has room), or drop the styles and hide settings stored under it.
 * Cancelling is not sending the import at all.
 */
export type ImportBreakpointChoice = "add" | "drop";

/** The choices an import is made with, keyed as the preview keys them. */
export interface ImportChoices {
  /** By conflict key (`ImportConflict.key`); a conflict not named is renamed. */
  readonly conflicts?: Readonly<Record<string, ImportConflictChoice>>;
  /** By the file's breakpoint id; every unmatched breakpoint needs one. */
  readonly breakpoints?: Readonly<Record<string, ImportBreakpointChoice>>;
}

/** @experimental Settles when the composition API ships. */
export interface ImportRequest {
  readonly file: TransferFile;
  readonly choices?: ImportChoices;
  readonly dryRun?: boolean;
  /**
   * The preview's fingerprint. An import whose site changed since that preview
   * (a breakpoint's width, a clashing item) is not applied: it answers 409,
   * and the caller previews again and confirms what the site now says.
   */
  readonly expect?: string;
}

/** One thing the file adds as new, under the name it will have. */
export interface ImportAddition {
  readonly kind: ImportConflictKind;
  readonly fileId: string;
  readonly name: string;
  /** A variable's path beside its name, which `$token`s name it by. */
  readonly detail?: string;
}

/** One thing already on the site, identical to the file's, used as it is. */
export interface ImportReuse {
  readonly kind: "class" | "token" | "media";
  readonly fileId: string;
  readonly name: string;
  /** A variable's path beside its name, which `$token`s name it by. */
  readonly detail?: string;
  readonly existingId: string;
}

/** One clash, the choice in force and what each choice means. */
export interface ImportConflict {
  /** `<kind>:<file id>`, the key `ImportChoices.conflicts` takes. */
  readonly key: string;
  readonly kind: ImportConflictKind;
  readonly fileId: string;
  readonly name: string;
  /** A variable's path beside its name, which `$token`s name it by. */
  readonly detail?: string;
  readonly existing: { readonly id: string; readonly name: string };
  /** The name the item is added under if renamed. */
  readonly renamedTo: string;
  readonly choice: ImportConflictChoice;
}

/** A file breakpoint the site defines with exactly the same width range. */
export interface ImportMatchedBreakpoint {
  readonly fileId: string;
  readonly label: string;
  readonly axis: TransferBreakpointAxis;
  readonly maxWidth: number;
  readonly to: { readonly id: string; readonly label: string };
}

/** A file breakpoint the site has no exact match for. */
export interface ImportUnmatchedBreakpoint {
  readonly fileId: string;
  readonly label: string;
  readonly axis: TransferBreakpointAxis;
  readonly maxWidth: number;
  /** How many style sets (one block or shared style, one state) use it. */
  readonly styles: number;
  /** How many blocks' per-device hide settings name it. */
  readonly hides: number;
  /** Whether "add" is offered; when not, `whyNotAdd` says why. */
  readonly mayAdd: boolean;
  readonly whyNotAdd?: string;
  readonly choice?: ImportBreakpointChoice;
}

/** A reason the import cannot be applied as it stands. */
export interface ImportProblem {
  readonly code:
    | "COMPONENT_CYCLE"
    | "MISSING_REFERENCE"
    | "NOT_GRANTED"
    | "BREAKPOINT_UNDECIDED"
    | "BREAKPOINT_NOT_ADDABLE"
    | "NAME_UNAVAILABLE"
    | "REFUSED_BY_SITE";
  readonly message: string;
}

/** What an import would do, said before it does anything. */
export interface ImportPreview {
  readonly root: { readonly kind: TransferKind; readonly title: string };
  readonly added: readonly ImportAddition[];
  readonly reused: readonly ImportReuse[];
  readonly conflicts: readonly ImportConflict[];
  readonly breakpoints: {
    readonly matched: readonly ImportMatchedBreakpoint[];
    readonly unmatched: readonly ImportUnmatchedBreakpoint[];
  };
  /** Block types the file uses that this site has not registered, sorted. */
  readonly missingBlockTypes: readonly string[];
  readonly problems: readonly ImportProblem[];
  /** Whether the import can be applied with the choices given. */
  readonly ready: boolean;
  /** What `ImportRequest.expect` takes to apply this preview and no other. */
  readonly fingerprint: string;
}

/** What an applied import made, by the file's ids. */
export interface ImportResult {
  readonly dryRun: boolean;
  readonly preview: ImportPreview;
  /** Who the import ran as: the signed-in user, or the API key and its owner. */
  readonly by?: ActionBy;
  /** The root item's id on this site, new or existing. */
  readonly rootId?: string;
  readonly created?: {
    readonly components: Readonly<Record<string, string>>;
    readonly patterns: Readonly<Record<string, string>>;
    readonly layouts: Readonly<Record<string, string>>;
    readonly media: Readonly<Record<string, string>>;
  };
}

/** The key a conflict is chosen by. */
export function conflictKey(kind: ImportConflictKind, fileId: string): string {
  return `${kind}:${fileId}`;
}

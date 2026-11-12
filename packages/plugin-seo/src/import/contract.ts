/**
 * What the import's routes and the bulk edit screen's import panel agree on:
 * where the import is read, tried and applied, the places a value can go,
 * the sources it reads, and the shapes each route answers with. Plain data
 * only, importing types alone, so the admin's client bundle takes it without
 * bringing server code along.
 *
 * @module import/contract
 */

import type { ParsedSource } from "./records";

/** Where the panel reads the field groups the site's content types hold. */
export const IMPORT_GROUPS_PATH = "/import/groups";

/** Where an import is tried without changing anything. */
export const IMPORT_DRY_RUN_PATH = "/import/dry-run";

/** Where a tried import is applied. */
export const IMPORT_APPLY_PATH = "/import/apply";

/** The most characters an export file may hold. */
export const IMPORT_FILE_LIMIT: number = 50 * 1024 * 1024;

/** Where an imported value can go in a page's SEO. */
export type ImportTarget =
  | "title"
  | "description"
  | "image"
  | "socialTitle"
  | "socialDescription"
  | "canonical"
  | "hidden"
  | "shown"
  | "skip";

/** Every place, in the order the panel offers them. */
export const IMPORT_TARGETS: readonly ImportTarget[] = [
  "title",
  "description",
  "image",
  "socialTitle",
  "socialDescription",
  "canonical",
  "hidden",
  "shown",
  "skip",
];

/** What each place is called on screen. */
export const IMPORT_TARGET_LABELS: Readonly<Record<ImportTarget, string>> = {
  title: "Title on Google",
  description: "Description on Google",
  image: "Share image",
  socialTitle: "Different title when shared",
  socialDescription: "Different description when shared",
  canonical: "Official address (canonical)",
  hidden: "Hide from search",
  shown: "Hide from search (reversed)",
  skip: "Leave out",
};

/** The export files the import reads, besides a field group. */
export type ImportFileSource = "yoast" | "rankMath" | "payload";

/** Where an import's values come from. */
export type ImportSource =
  | {
      kind: "group";
      /** The group or component field the values are in. */
      field: string;
      /**
       * Where each of the group's fields goes. The import panel always sends
       * one; a caller of the engine that sends none gets where each field's
       * name says it goes.
       */
      map?: Record<string, ImportTarget>;
    }
  | {
      kind: ImportFileSource;
      /** The file's name, for the dry run to show. */
      fileName: string;
      /** The file's text. */
      text: string;
    }
  | {
      /**
       * A file read in the browser, by the same readers: only what it holds
       * for each page is sent, so a large export is never sent whole.
       */
      kind: "records";
      /** The tool whose export it is. */
      tool: ImportFileSource;
      /** The file's name, for the dry run to show. */
      fileName: string;
      /** What the file holds, as its reader read it. */
      parsed: ParsedSource;
    };

/** What a dry run and an apply are sent. */
export interface ImportRequest {
  source: ImportSource;
  /** The language the values are imported into, where the site has several. */
  locale?: string;
  /** Whether values a page's own code overrides are imported anyway. */
  includeNeverServed?: boolean;
}

/** One field inside a group, with how many pages hold a value in it. */
export interface GroupField {
  name: string;
  label: string;
  /** How many of the pages read hold a value. */
  filled: number;
  /** Where the panel suggests it goes. */
  suggested: ImportTarget;
  /** One page's value, as an example of what the field holds; none where no page holds one. */
  example?: string;
}

/** A group or component field the site's content types hold. */
export interface ImportGroup {
  /** The field's name on each type, the same on every one. */
  field: string;
  label: string;
  /** The types it is on. */
  types: { slug: string; label: string }[];
  /** How many pages were read. */
  pages: number;
  /** How many of them hold a title or a description in the group. */
  withText: number;
  fields: GroupField[];
  /** The plugin's own group, from an earlier version of the plugin. */
  own: boolean;
}

/** What the groups route answers. */
/**
 * A content type of the site's own with a field of its own named `seo`,
 * which the plugin's group can't join until that field is renamed.
 */
export interface TypeWithOwnSeo {
  slug: string;
  label: string;
  /** Where it is defined: the site's code, or the Schema Builder. */
  definedIn: "code" | "admin";
}

export interface ImportGroupsBody {
  groups: ImportGroup[];
  /** The site's types holding a field of their own named `seo`. */
  ownSeo: TypeWithOwnSeo[];
  /** The language an import reads and writes in: a file is read in it too. */
  language: string;
}

/** A line of the dry run: where values go, from where, and how many. */
export interface DryRunLine {
  target: ImportTarget;
  /** What the values are read from, as the source names it. */
  from: string[];
  /** How many pages it would change. */
  pages: number;
}

/**
 * What an import does to one page, or to a record it passes over: sets
 * values (`set`), finds every value the same as the page's automatic one
 * (`same`), keeps values a person already typed (`kept`), or skips it, with
 * why (`skipped`).
 */
export interface ImportReportEntry {
  /** The page's content type key and id; none for a record matching no page. */
  type?: string;
  id?: string;
  /** The page's name, or the record's as the source names it. */
  label: string;
  outcome: "set" | "same" | "kept" | "skipped";
  /** The places it sets. */
  set: ImportTarget[];
  /** The places whose value is the same as the automatic one, left as they are. */
  same: ImportTarget[];
  /** The places a person already filled, which keep what they hold, the same value or another. */
  kept: ImportTarget[];
  /**
   * The places whose value never reached the page, since its own code sets
   * that value: left out unless the import includes them.
   */
  neverServed: ImportTarget[];
  /** The title and description the source holds for it, as imported. */
  values: Partial<Record<"title" | "description", string>>;
  /** Why it is skipped. */
  reason?: string;
}

/** What a dry run answers. */
export interface DryRunBody {
  /** The pages, or the file's records, it read. */
  checked: number;
  /** Whether `checked` counts a file's records rather than pages. */
  fromFile: boolean;
  /** How many of the records read hold any value to import. */
  held: number;
  lines: DryRunLine[];
  /** How many pages would change. */
  pages: number;
  /** Values the same as the automatic one, left (or made) automatic. */
  same: number;
  /** Values a person already typed here, which the import keeps. */
  kept: number;
  /**
   * Values left out as never served: the page's own code sets them, so they
   * never reached it. Zero where the import includes them.
   */
  neverServed: number;
  /** Redirects the import would add. */
  redirects: number;
  /** The source's fields the import leaves out. */
  left: string[];
  /** What the person should know before applying it. */
  warnings: string[];
  /** What the import does to each page it read and each record it passed over. */
  documents: ImportReportEntry[];
  /** What the apply is checked against: the changes, as this run found them. */
  plan: string;
}

/** What an apply answers, beside its message. */
export interface ApplyBody {
  pages: number;
  redirects: number;
}

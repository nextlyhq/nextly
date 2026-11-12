/**
 * What the import's routes and the bulk edit screen's import panel agree on:
 * where the import is read, tried and applied, the places a value can go,
 * the sources it reads, and the shapes each route answers with. Plain data
 * only and import-free, so the admin's client bundle takes it without
 * bringing server code along.
 *
 * @module import/contract
 */

/** Where the panel reads the field groups the site's content types hold. */
export const IMPORT_GROUPS_PATH = "/import/groups";

/** Where an import is tried without changing anything. */
export const IMPORT_DRY_RUN_PATH = "/import/dry-run";

/** Where a tried import is applied. */
export const IMPORT_APPLY_PATH = "/import/apply";

/** The most characters an export file may hold. */
export const IMPORT_FILE_LIMIT: number = 20 * 1024 * 1024;

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
      /** Where each of the group's fields goes. */
      map: Record<string, ImportTarget>;
    }
  | {
      kind: ImportFileSource;
      /** The file's name, for the dry run to show. */
      fileName: string;
      /** The file's text. */
      text: string;
    };

/** What a dry run and an apply are sent. */
export interface ImportRequest {
  source: ImportSource;
  /** The language the values are imported into, where the site has several. */
  locale?: string;
}

/** One field inside a group, with how many pages hold a value in it. */
export interface GroupField {
  name: string;
  label: string;
  /** How many of the pages read hold a value. */
  filled: number;
  /** Where the panel suggests it goes. */
  suggested: ImportTarget;
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
  fields: GroupField[];
  /** The plugin's own group, from an earlier version of the plugin. */
  own: boolean;
}

/** What the groups route answers. */
export interface ImportGroupsBody {
  groups: ImportGroup[];
}

/** A line of the dry run: where values go, from where, and how many. */
export interface DryRunLine {
  target: ImportTarget;
  /** What the values are read from, as the source names it. */
  from: string[];
  /** How many pages it would change. */
  pages: number;
}

/** What a dry run answers. */
export interface DryRunBody {
  /** The pages, or the file's records, it read. */
  checked: number;
  /** Whether `checked` counts a file's records rather than pages. */
  fromFile: boolean;
  lines: DryRunLine[];
  /** How many pages would change. */
  pages: number;
  /** Values the same as the automatic one, left (or made) automatic. */
  same: number;
  /** Values a person already typed here, which the import keeps. */
  kept: number;
  /** Redirects the import would add. */
  redirects: number;
  /** The source's fields the import leaves out. */
  left: string[];
  /** What the person should know before applying it. */
  warnings: string[];
  /** What the apply is checked against: the changes, as this run found them. */
  plan: string;
}

/** What an apply answers, beside its message. */
export interface ApplyBody {
  pages: number;
  redirects: number;
}

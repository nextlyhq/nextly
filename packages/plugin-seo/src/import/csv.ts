/**
 * Reading Rank Math's CSV export (Status & Tools › Import & Export › CSV):
 * one row per post or page, its values in columns named by the header row.
 * Columns are found by name, so an export with its columns in another order,
 * or with the read-only ones included, reads the same. Pure.
 *
 * @module import/csv
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";

import type { ImportTarget } from "./contract";
import {
  pathOfAddress,
  spelledPathOf,
  textValue,
  type ImportedRecord,
  type ImportedValues,
  type ParsedSource,
} from "./records";

/**
 * One cell and what ends it: a quoted cell (its quotes doubled inside), or
 * a plain one, then a comma, a line break, or the end of the text.
 */
const CELL = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\n|\r|$)/g;

/** The rows of a CSV text, each a list of its cells (RFC 4180). */
export function csvRows(text: string): string[][] {
  // A byte-order mark is not part of the first header.
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  for (const [, quoted, plain, end] of source.matchAll(CELL)) {
    row.push(
      quoted === undefined ? (plain ?? "") : quoted.replaceAll('""', '"')
    );
    if (end === ",") continue;
    if (row.some(value => value !== "")) rows.push(row);
    row = [];
    if (end === "") break;
  }
  return rows;
}

/** A column read for one place, and what Rank Math calls it. */
const COLUMNS: {
  column: string;
  label: string;
  target: Exclude<ImportTarget, "hidden" | "shown" | "skip">;
}[] = [
  { column: "seo_title", label: "SEO title", target: "title" },
  { column: "seo_description", label: "Description", target: "description" },
  {
    column: "social_facebook_thumbnail",
    label: "Facebook image",
    target: "image",
  },
  {
    column: "social_facebook_title",
    label: "Facebook title",
    target: "socialTitle",
  },
  {
    column: "social_facebook_description",
    label: "Facebook description",
    target: "socialDescription",
  },
  { column: "canonical_url", label: "Canonical URL", target: "canonical" },
];

/** Columns that name the row, or are read apart from the values. */
const NOT_LEFT = new Set([
  "id",
  "post_id",
  "object_id",
  "object_type",
  "type",
  "post_type",
  "slug",
  "url",
  "permalink",
  "link",
  "robots",
  "redirect_to",
  "redirect_type",
  ...COLUMNS.map(({ column }) => column),
]);

/** What Rank Math calls the columns the import leaves out. */
const LEFT_NAMES: Record<string, string> = {
  focus_keyword: "focus keyword",
  is_pillar_content: "pillar content",
  seo_score: "SEO score",
  primary_term: "primary term",
  schema_data: "schema",
  advanced_robots: "advanced robots",
  social_twitter_thumbnail: "X image",
  social_twitter_title: "X title",
  social_twitter_description: "X description",
};

/** The redirect codes a redirect here can keep, and whether each is permanent. */
const REDIRECT_CODES: Record<string, boolean> = {
  "301": true,
  "308": true,
  "302": false,
  "303": false,
  "307": false,
};

/** Whether a row's robots words hide it, show it, or say neither. */
function hiddenOf(robots: string | undefined): boolean | undefined {
  if (robots === undefined) return undefined;
  const words = robots.split(/[\s,]+/).map(word => word.toLowerCase());
  if (words.includes("noindex")) return true;
  if (words.includes("index")) return false;
  return undefined;
}

/** One row's cells, read by their column's name. */
type Cells = (name: string) => string | undefined;

/** A row's values, noting what the export called each place it filled. */
function valuesOf(cell: Cells, from: ParsedSource["from"]): ImportedValues {
  const values: ImportedValues = {};
  for (const { column, label, target } of COLUMNS) {
    const value = cell(column);
    if (value === undefined) continue;
    if (target === "image") values.image = { url: value };
    else values[target] = value;
    const named = (from[target] ??= []);
    if (!named.includes(label)) named.push(label);
  }
  const hidden = hiddenOf(cell("robots"));
  if (hidden !== undefined) {
    values.hidden = hidden;
    from.hidden = ["Robots: noindex"];
  }
  return values;
}

/** A row as a record, with the redirect it asks for where it can be kept. */
function recordOf(cell: Cells, values: ImportedValues): ImportedRecord {
  const address = cell("url") ?? cell("permalink") ?? cell("link");
  const path = pathOfAddress(address);
  const source = spelledPathOf(address);
  const slug = cell("slug");
  const target = cell("redirect_to");
  const permanent = REDIRECT_CODES[cell("redirect_type") ?? "301"];
  return {
    label: slug ?? path ?? cell("id") ?? "Untitled",
    match: {
      ...(path === undefined ? {} : { path }),
      ...(slug === undefined ? {} : { slug }),
    },
    values,
    variables: "rankMath",
    ...(target !== undefined && permanent !== undefined
      ? {
          redirect: {
            ...(source === undefined ? {} : { source }),
            target,
            permanent,
          },
        }
      : {}),
  };
}

/** A row's cells, read by their column's name. */
function cellsOf(names: readonly string[], row: readonly string[]): Cells {
  return name => {
    const index = names.indexOf(name);
    return index === -1 ? undefined : textValue(row[index]);
  };
}

/** What Rank Math calls the columns of a row the import leaves out. */
function leftIn(names: readonly string[], cell: Cells): string[] {
  return names
    .filter(name => !NOT_LEFT.has(name) && cell(name) !== undefined)
    .map(name => LEFT_NAMES[name] ?? name);
}

/** Rank Math's values from its CSV export. */
export function readRankMathCsv(text: string): ParsedSource {
  const [header, ...rows] = csvRows(text);
  const names = (header ?? []).map(name => name.trim().toLowerCase());
  if (!names.includes("seo_title") && !names.includes("seo_description")) {
    throw NextlyError.invalidInput({
      message:
        "This isn't a Rank Math CSV export: it has no seo_title or seo_description column.",
      logContext: { reason: "seo-import-not-rank-math-csv" },
    });
  }
  const from: ParsedSource["from"] = {};
  const left = new Set<string>();
  let gone = 0;
  const records = rows.map(row => {
    const cell = cellsOf(names, row);
    for (const name of leftIn(names, cell)) left.add(name);
    const record = recordOf(cell, valuesOf(cell, from));
    if (cell("redirect_to") !== undefined && record.redirect === undefined) {
      gone++;
    }
    return record;
  });
  const warnings =
    gone === 0
      ? []
      : [
          `${gone === 1 ? "1 row asks" : `${gone} rows ask`} for a page that is gone (410 or 451). Nextly answers an address with no page as not found, so these are left out.`,
        ];
  return { records, from, left: [...left], warnings };
}

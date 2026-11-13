/**
 * The export files Import reads, as its first step offers them: each tool's
 * name and what its file holds, how the file is described before it is
 * chosen, and what a file read for it is told when it can't be used. Plain
 * data and small checks only: the file itself is read by the import engine
 * on the server, which this never second-guesses beyond what a person can
 * be told before sending it.
 *
 * @module admin/import-files
 */
import {
  IMPORT_FILE_LIMIT,
  type DryRunBody,
  type ImportFileSource,
} from "../import/contract";
import { readFile } from "../import/read-file";
import { ImportFileRefused, type ParsedSource } from "../import/records";
import { seoPluginOf } from "../import/wordpress";

/** A tool whose export Import reads, as its first step names it. */
export type ImportTool = "wordpress" | "rankMathCsv" | "payload";

/** What each tool's card and drop area say. */
export const IMPORT_TOOLS: readonly {
  tool: ImportTool;
  title: string;
  detail: string;
  /** The heading over its drop area. */
  heading: string;
  /** What the drop area takes, said before a file is chosen. */
  takes: string;
  /** What the chooser offers. */
  accept: string;
  /** What its file is called when it is the wrong one. */
  fileName: string;
  /** What to choose instead, when the wrong file is chosen. */
  instead: string;
  /** Whose values the file holds, as a summary names them. */
  values: string;
}[] = [
  {
    tool: "wordpress",
    title: "WordPress",
    detail: "Export file, with Yoast's or Rank Math's values",
    heading: "Your WordPress export file",
    takes:
      "The .xml file from Tools › Export in WordPress, up to 50 MB. Nextly reads it once and doesn't keep it.",
    accept: ".xml,text/xml,application/xml",
    fileName: "a WordPress export file",
    instead: "Choose the .xml file WordPress made under Tools › Export.",
    values: "Yoast or Rank Math",
  },
  {
    tool: "rankMathCsv",
    title: "Rank Math CSV",
    detail: "Its SEO export, with redirects",
    heading: "Your Rank Math CSV file",
    takes:
      "The .csv file from Rank Math › Status & Tools › Import & Export, up to 50 MB. Nextly reads it once and doesn't keep it.",
    accept: ".csv,text/csv",
    fileName: "a Rank Math CSV file",
    instead: "Choose the .csv file Rank Math made under Import & Export.",
    values: "Rank Math",
  },
  {
    tool: "payload",
    title: "Payload",
    detail: "A JSON export with its meta fields",
    heading: "Your Payload export file",
    takes:
      "The .json file of your Payload documents, up to 50 MB. Nextly reads it once and doesn't keep it.",
    accept: ".json,application/json",
    fileName: "a Payload export file",
    instead:
      "Choose the .json file of your Payload documents, with their meta fields.",
    values: "SEO",
  },
];

/** One tool's words, by its key. */
export function toolOf(tool: ImportTool): (typeof IMPORT_TOOLS)[number] {
  const found = IMPORT_TOOLS.find(each => each.tool === tool);
  if (found === undefined) throw new Error(`No import tool ${tool}`);
  return found;
}

/**
 * The engine's source for a file read for `tool`, or none where the file
 * can't be one: a WordPress export says whose values it holds by the meta
 * keys in it, Rank Math's (`rank_math_`) or Yoast's (`_yoast_wpseo_`).
 */
export function sourceOfFile(
  tool: ImportTool,
  text: string
): ImportFileSource | undefined {
  const start = text.trimStart();
  switch (tool) {
    case "wordpress":
      if (!start.startsWith("<") || !/wordpress\.org\/export/i.test(text)) {
        return undefined;
      }
      try {
        return seoPluginOf(text);
      } catch (error) {
        // Not an export the reader takes: no source, so its one notice.
        if (error instanceof ImportFileRefused) return undefined;
        throw error;
      }
    case "rankMathCsv":
      return start.startsWith("<") || start.startsWith("{") || start === ""
        ? undefined
        : "rankMath";
    case "payload":
      return start.startsWith("{") || start.startsWith("[")
        ? "payload"
        : undefined;
  }
}

/** Why a file can't be used, as the one notice says it: its title and what to do. */
export interface FileProblem {
  title: string;
  text: string;
}

/** The one notice for a file larger than Import reads. */
export function tooLarge(tool: ImportTool): FileProblem {
  return {
    title: "This file is larger than 50 MB",
    text: `Import reads files up to 50 MB. ${toolOf(tool).instead}`,
  };
}

/** The one notice for a file that is not the tool's export. */
export function wrongFile(tool: ImportTool): FileProblem {
  const words = toolOf(tool);
  return {
    title: `This isn't ${words.fileName}`,
    text: words.instead,
  };
}

/** The one notice for a file holding nothing to import. */
export function nothingIn(tool: ImportTool): FileProblem {
  return {
    title: "There are no SEO values in this file",
    text: `It was read, but none of its pages hold ${toolOf(tool).values} values. ${toolOf(tool).instead}`,
  };
}

/** The one notice for a file that could not be read, with why. */
export function unreadable(why: string): FileProblem {
  return { title: "The file couldn't be read", text: why };
}

/** Whether a file is larger than Import reads. */
export function isTooLarge(file: { size: number }): boolean {
  return file.size > IMPORT_FILE_LIMIT;
}

/** `n` and its noun, singular or plural. */
export function counted(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** The line a file read says: how much was read, and how much holds values. */
export function readSummary(tool: ImportTool, run: DryRunBody): string {
  return `${counted(run.checked, "post or page", "posts and pages")} read. ${run.held.toLocaleString()} ${run.held === 1 ? "has" : "have"} ${toolOf(tool).values} values. Next, match them to your pages.`;
}

/**
 * `text` read as `kind`'s export, here in the browser, by the import's own
 * readers; or the notice for a file they refuse, in their words.
 */
export function parsedIn(
  kind: ImportFileSource,
  text: string,
  language: string | undefined
): ParsedSource | FileProblem {
  try {
    return readFile(kind, text, language);
  } catch (error) {
    if (error instanceof ImportFileRefused) {
      return { title: "This file can't be imported", text: error.message };
    }
    throw error;
  }
}

/**
 * The most a read file's values may come to, sent as one request: under
 * the smallest request limit common hosts set (4.5 MB on Vercel's
 * functions), with room for the rest of the request.
 */
export const SENDABLE_LIMIT: number = 3.5 * 1024 * 1024;

/** Whether what a file holds is more than one request carries. */
export function tooMuchToSend(parsed: ParsedSource): boolean {
  return new Blob([JSON.stringify(parsed)]).size > SENDABLE_LIMIT;
}

/** The one notice for a file holding more values than can be sent at once. */
export function tooMuch(tool: ImportTool): FileProblem {
  return {
    title: "This file holds too many SEO values to import at once",
    text: `Its titles and descriptions come to more than 3.5 MB. Export part of the site at a time and import each file. ${toolOf(tool).instead}`,
  };
}

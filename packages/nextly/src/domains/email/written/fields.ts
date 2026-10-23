/**
 * What a written template stores, from what a save supplies.
 *
 * A written template's blocks are its source. Its `htmlContent` and
 * `plainTextContent` are always written from them, here, so every part of
 * the system that reads a template's HTML (search, the layout checks, what
 * the brand settings reach) reads what the blocks say. They are never edited
 * directly: the blocks are.
 *
 * @module domains/email/written/fields
 */

import { NextlyError } from "../../../errors";

import { compileWrittenHtml, compileWrittenText } from "./compile";
import {
  writtenDocumentSchema,
  type TemplateFormat,
  type WrittenDocument,
} from "./document";

/** The columns a written template stores. */
export interface WrittenFields {
  format: "written";
  blocks: WrittenDocument;
  htmlContent: string;
  plainTextContent: string;
}

/** A save's blocks, checked; a refusal names each field that failed. */
export function parseWrittenDocument(blocks: unknown): WrittenDocument {
  const parsed = writtenDocumentSchema.safeParse(blocks);
  if (!parsed.success) {
    // The validation envelope every route uses, with each path under
    // `blocks`, where the save put them.
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: ["blocks", ...issue.path].join("."),
        code: issue.code,
        message: issue.message,
      })),
      logContext: { reason: "written-template-invalid" },
    });
  }
  return parsed.data;
}

/** The stored fields of a written template with these blocks. */
export function writtenFields(blocks: unknown): WrittenFields {
  const document = parseWrittenDocument(blocks);
  return {
    format: "written",
    blocks: document,
    htmlContent: compileWrittenHtml(document),
    plainTextContent: compileWrittenText(document),
  };
}

/** A stored format as the record reads it: anything but `written` is coded. */
export function formatOf(stored: unknown): TemplateFormat {
  return stored === "written" ? "written" : "code";
}

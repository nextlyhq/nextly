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
  formatMismatch,
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
function formatOf(stored: unknown): TemplateFormat {
  return stored === "written" ? "written" : "code";
}

/** A stored row's format and blocks as the record reads them: a coded template has none. */
export function storedFormat(row: {
  format?: string | null;
  blocks?: WrittenDocument | null;
}): {
  format: TemplateFormat;
  blocks: WrittenDocument | null;
} {
  const format = formatOf(row.format);
  return { format, blocks: format === "written" ? (row.blocks ?? null) : null };
}

/** A save's format, checked: unset is coded. */
function checkedFormat(format: unknown): TemplateFormat {
  if (format === undefined || format === null || format === "code")
    return "code";
  if (format === "written") return "written";
  throw NextlyError.validation({
    errors: [
      {
        path: "format",
        code: "invalid_value",
        message: 'Use "code" or "written".',
      },
    ],
  });
}

function refused(message: string, reason: string): NextlyError {
  return new NextlyError({
    code: "BUSINESS_RULE_VIOLATION",
    publicMessage: message,
    logContext: { reason },
  });
}

/** The fields a save can carry that decide a template's format. */
interface FormatInput {
  format?: TemplateFormat | null;
  blocks?: WrittenDocument | null;
  kind?: string;
  htmlContent?: string;
  plainTextContent?: string | null;
}

/**
 * A new template as it is stored: a written one with its HTML and plain text
 * written from its blocks, a coded one with none.
 *
 * @throws NextlyError VALIDATION_ERROR for blocks that don't pass their rules
 * @throws NextlyError BUSINESS_RULE_VIOLATION for fields that can't be one
 *   template (`formatMismatch`): blocks on a coded template, a written layout
 *   or partial, or a written template without blocks
 */
export function writtenForCreate<T extends FormatInput>(data: T): T {
  const format = checkedFormat(data.format);
  const mismatch = formatMismatch({ ...data, format });
  if (mismatch) throw refused(mismatch.message, mismatch.reason);
  if (format === "code") return { ...data, format: "code", blocks: null };
  return { ...data, ...writtenFields(data.blocks) };
}

/**
 * An update as it is stored. A coded template is never turned into blocks. A
 * written template's HTML and plain text are written from its blocks, so they
 * change only when its blocks do.
 *
 * @throws NextlyError BUSINESS_RULE_VIOLATION for a change of format, blocks
 *   on a coded template, or HTML given for a written one
 */
export function writtenForUpdate<T extends Omit<FormatInput, "kind">>(
  record: { format: TemplateFormat },
  data: T
): T {
  if (
    data.format !== undefined &&
    checkedFormat(data.format) !== record.format
  ) {
    throw record.format === "code"
      ? refused(
          "A coded template can't be turned into blocks.",
          "code-to-written"
        )
      : refused(
          "A written template can't be turned into code here.",
          "written-to-code"
        );
  }
  if (record.format === "code") {
    if (data.blocks !== undefined && data.blocks !== null) {
      throw refused(
        "A coded template can't be turned into blocks.",
        "code-to-written"
      );
    }
    return data;
  }
  if (data.htmlContent !== undefined || data.plainTextContent !== undefined) {
    throw refused(
      "A written template's HTML is written from its blocks. Change its blocks instead.",
      "html-on-written-template"
    );
  }
  if (data.blocks === undefined) return data;
  const fields = writtenFields(data.blocks);
  return {
    ...data,
    blocks: fields.blocks,
    htmlContent: fields.htmlContent,
    plainTextContent: fields.plainTextContent,
  };
}

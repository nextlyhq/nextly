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

/**
 * The format a version the site chose is stored in (an override, an applied
 * review of its owner's update, its undo): written, with these blocks, while
 * the version still holds exactly what they compile to; coded otherwise,
 * holding the version as it is. So a written template that takes an owner's
 * lines becomes coded with them, rather than keeping blocks that no longer
 * say what it sends.
 *
 * @throws NextlyError VALIDATION_ERROR for blocks that don't pass their rules
 */
export function sitesVersionFormat(
  blocks: WrittenDocument | null | undefined,
  version: { htmlContent: string; plainTextContent: string | null }
): { format: TemplateFormat; blocks: WrittenDocument | null } {
  if (!blocks) return { format: "code", blocks: null };
  const compiled = writtenFields(blocks);
  const holdsBlocks =
    version.htmlContent === compiled.htmlContent &&
    (version.plainTextContent ?? null) === compiled.plainTextContent;
  return holdsBlocks
    ? { format: "written", blocks: compiled.blocks }
    : { format: "code", blocks: null };
}

/**
 * A version as its blocks compile now: the site's blocks kept through a
 * review or an undo send what they say, though their HTML was stored by a
 * release that wrote blocks as other markup.
 */
export function compiledVersion<
  T extends { htmlContent: string; plainTextContent: string | null },
>(version: T, blocks: WrittenDocument): T {
  return {
    ...version,
    htmlContent: compileWrittenHtml(blocks),
    plainTextContent: compileWrittenText(blocks),
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
 * change only when its blocks do, until it is converted to code
 * (`format: "code"`).
 *
 * @throws NextlyError BUSINESS_RULE_VIOLATION for a coded template turned
 *   into blocks, blocks sent with a conversion to code, or HTML given for a
 *   written template
 */
export function writtenForUpdate<T extends Omit<FormatInput, "kind">>(
  record: {
    format: TemplateFormat;
    blocks: WrittenDocument | null;
    htmlContent?: string;
    plainTextContent?: string | null;
  },
  data: T
): T {
  const format =
    data.format === undefined ? record.format : checkedFormat(data.format);
  if (record.format === "code") {
    if (
      format === "written" ||
      (data.blocks !== undefined && data.blocks !== null)
    ) {
      throw refused(
        "A coded template can't be turned into blocks.",
        "code-to-written"
      );
    }
    return data;
  }
  if (format === "code") return convertedToCode(record.blocks, data);
  // A form that saves every field sends back the HTML and plain text it was
  // given; those are the blocks' own, and only a change to them is refused.
  const { htmlContent, plainTextContent, ...rest } = data;
  const sameHtml =
    htmlContent === undefined || htmlContent === record.htmlContent;
  const sameText =
    plainTextContent === undefined ||
    (plainTextContent ?? null) === (record.plainTextContent ?? null);
  if (!sameHtml || !sameText) {
    throw refused(
      "A written template's HTML is written from its blocks. Change its blocks instead.",
      "html-on-written-template"
    );
  }
  data = rest as T;
  if (data.blocks === undefined) return data;
  const fields = writtenFields(data.blocks);
  return {
    ...data,
    blocks: fields.blocks,
    htmlContent: fields.htmlContent,
    plainTextContent: fields.plainTextContent,
  };
}

/**
 * A written template converted to code. It keeps the Liquid its blocks
 * compile to now, as a send renders them (chips, conditions and lists
 * included), unless the same save gives its own HTML or plain text, and its
 * blocks go. One way: a coded template is never turned back into blocks.
 */
function convertedToCode<T extends Omit<FormatInput, "kind">>(
  blocks: WrittenDocument | null,
  data: T
): T {
  if (data.blocks !== undefined && data.blocks !== null) {
    throw refused(
      "A template converted to code has no blocks. Convert it, then edit its code.",
      "blocks-on-coded-template"
    );
  }
  if (!blocks) return { ...data, format: "code", blocks: null };
  return {
    ...data,
    format: "code",
    blocks: null,
    htmlContent: data.htmlContent ?? compileWrittenHtml(blocks),
    plainTextContent:
      data.plainTextContent === undefined
        ? compileWrittenText(blocks)
        : data.plainTextContent,
  };
}

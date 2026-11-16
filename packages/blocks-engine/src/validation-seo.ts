/**
 * A document's own metadata: its SEO text values and image binding.
 *
 * @module validation-seo
 */
import {
  MAX_SEO_SEGMENTS,
  MAX_SEO_TEXT_LENGTH,
  SEO_TEXT_FIELDS,
} from "./document";
import { describeValue, pointer } from "./issue-text";
import { isPlainRecord } from "./plain-record";
import { validBindingShape } from "./validation-bindings";
import type { ValidationIssue } from "./validation-contract";

/**
 * A document's own metadata: its text values (`SEO_TEXT_FIELDS`), each a
 * list of literal text and bindings, and `image`, one binding. Each binding is held
 * to the shape a prop's is. A list item is no source here: the metadata is
 * read once for the page, outside any list.
 */
export function validateDocumentSeo(
  seo: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (!isPlainRecord(seo)) {
    issues.push({
      path,
      code: "invalid-seo",
      severity: "error",
      message: "A document's seo setting must be an object.",
    });
    return;
  }
  for (const [field, value] of Object.entries(seo)) {
    const at = pointer(path, field);
    if ((SEO_TEXT_FIELDS as readonly string[]).includes(field)) {
      validateSeoText(value, at, issues);
    } else if (field === "image") {
      validateSeoBinding(value, at, issues);
    } else {
      issues.push({
        path: at,
        code: "invalid-seo",
        severity: "error",
        message: `"${describeValue(field)}" is not a metadata field: a document's seo holds ${SEO_TEXT_FIELDS.join(", ")} and image.`,
      });
    }
  }
}

/**
 * The problems of a document's own metadata, judged by its shape alone, as a
 * save judges `settings.seo`: what an edit writing the metadata whole checks
 * before the document holds it.
 */
export function documentSeoIssues(seo: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateDocumentSeo(seo, "/settings/seo", issues);
  return issues;
}

/** One metadata text value: a bounded list of literal text and bindings. */
function validateSeoText(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (!Array.isArray(value)) {
    issues.push({
      path,
      code: "invalid-seo",
      severity: "error",
      message:
        "A metadata text value must be a list of text and bindings, joined in order.",
    });
    return;
  }
  if (value.length > MAX_SEO_SEGMENTS) {
    issues.push({
      path,
      code: "invalid-seo",
      severity: "error",
      message: `A metadata text value holds at most ${String(MAX_SEO_SEGMENTS)} pieces.`,
    });
    return;
  }
  value.forEach((segment: unknown, index) => {
    const at = pointer(path, String(index));
    if (typeof segment === "string") {
      if (segment.length > MAX_SEO_TEXT_LENGTH) {
        issues.push({
          path: at,
          code: "invalid-seo",
          severity: "error",
          message: `A piece of metadata text is at most ${String(MAX_SEO_TEXT_LENGTH)} characters.`,
        });
      }
      return;
    }
    validateSeoBinding(segment, at, issues);
  });
}

/**
 * One metadata binding's shape, read for the page. The check the routed page
 * applies before using it (`seo-binding-check`) runs over the whole document
 * once the walk is done (`bindingSchemaIssues`), when the context carries the
 * sources' schema, so a problem a stored form already held stays a warning.
 */
function validateSeoBinding(
  value: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (!validBindingShape(value, path, issues)) return;
  if (value.source === "item") {
    issues.push({
      path: pointer(path, "source"),
      code: "invalid-binding",
      severity: "error",
      message:
        "A document's metadata is read once for the page, outside any list, so it cannot bind a list item.",
    });
  }
}

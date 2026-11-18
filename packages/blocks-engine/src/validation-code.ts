/**
 * A document's own code: its shape alone. What the code may hold is the
 * host's to judge, on every write, with the checks it holds site code to.
 *
 * @module validation-code
 */
import { DOCUMENT_CODE_FIELDS } from "./document";
import { describeValue, pointer } from "./issue-text";
import { isPlainRecord } from "./plain-record";
import type { ValidationIssue } from "./validation-contract";

/**
 * A document's own code (`settings.code`): a record of the fields
 * `DOCUMENT_CODE_FIELDS` names, each text.
 */
export function validateDocumentCode(
  code: unknown,
  path: string,
  issues: ValidationIssue[]
): void {
  if (!isPlainRecord(code)) {
    issues.push({
      path,
      code: "invalid-code",
      severity: "error",
      message: "A document's code setting must be an object.",
    });
    return;
  }
  for (const [field, value] of Object.entries(code)) {
    const at = pointer(path, field);
    if (!(DOCUMENT_CODE_FIELDS as readonly string[]).includes(field)) {
      issues.push({
        path: at,
        code: "invalid-code",
        severity: "error",
        message: `"${describeValue(field)}" is not a code field: a document's code holds ${DOCUMENT_CODE_FIELDS.join(", ")}.`,
      });
    } else if (typeof value !== "string") {
      issues.push({
        path: at,
        code: "invalid-code",
        severity: "error",
        message: `A document's code ${field} must be text.`,
      });
    }
  }
}

/**
 * The problems of a document's own code, judged by its shape alone, as a
 * save judges `settings.code`.
 */
export function documentCodeIssues(code: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  validateDocumentCode(code, "/settings/code", issues);
  return issues;
}

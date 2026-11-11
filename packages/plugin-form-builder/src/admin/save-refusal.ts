/**
 * Where a refused save is fixed: the page of the form editor that holds what
 * the refusal names, so the editor can say what to fix and take a person
 * there.
 *
 * @module admin/save-refusal
 */
import type { FormPageId } from "../form-pages";

/** What the editor says about a refused save, and where it is fixed. */
export interface SaveRefusal {
  message: string;
  /** The page holding what to fix, when the refusal names one. */
  page?: FormPageId;
}

/**
 * The page a stored path lives on: a field's on Builder, a notification's on
 * Notifications, and the form's own values (its name, ID, status, closed
 * message and settings) on Settings. `undefined` for a path none holds.
 */
function pageOfPath(path: string): FormPageId | undefined {
  const head = path.split(/[.[]/, 1)[0];
  if (head === "fields") return "builder";
  if (head === "notifications") return "notifications";
  if (
    head === "settings" ||
    head === "name" ||
    head === "slug" ||
    head === "status" ||
    head === "closedMessage"
  ) {
    return "settings";
  }
  return undefined;
}

/**
 * The page a refusal's body points at: the first of its issues whose path a
 * page holds. A refusal with no such issue (a version conflict, a server
 * failure) points nowhere, and the editor says what happened without a link.
 */
export function refusedPage(body: unknown): FormPageId | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return undefined;
  }
  const error = body.error;
  if (typeof error !== "object" || error === null || !("data" in error)) {
    return undefined;
  }
  const data = error.data;
  if (typeof data !== "object" || data === null || !("errors" in data)) {
    return undefined;
  }
  const issues = data.errors;
  if (!Array.isArray(issues)) return undefined;
  for (const issue of issues) {
    const path: unknown =
      typeof issue === "object" && issue !== null && "path" in issue
        ? issue.path
        : undefined;
    const page = typeof path === "string" ? pageOfPath(path) : undefined;
    if (page !== undefined) return page;
  }
  return undefined;
}

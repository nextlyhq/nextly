/**
 * Reading the document a form's redirect setting points at.
 *
 * Separate from `redirect-target` because this half has no dependencies and
 * the other half imports `nextly/config`: the admin picker needs to read a
 * stored reference to show what is selected, and pulling the config surface
 * into the browser bundle to do it would be a real cost for no gain.
 */

/** A document being turned into a URL. `id` is always present; the rest is the row. */
export interface RedirectTargetDocument {
  id: string;
  [field: string]: unknown;
}

/** A stored relationship value reduced to the collection and id it names. */
export interface RedirectReference {
  collection: string;
  id: string;
}

/**
 * The reference a `redirectPage` value holds, in any shape a read produces.
 *
 * Three arrive in practice and they are not interchangeable: a polymorphic
 * field stores `{ relationTo, value }`; a read at depth replaces `value` with
 * the populated row; and a single-target field stores the bare id. The last
 * names no collection, so it resolves only when exactly one is configured —
 * guessing which of several a bare id belongs to would send visitors to a
 * URL built from the wrong collection's pattern.
 */
export function parseRedirectReference(
  value: unknown,
  collections: readonly string[]
): RedirectReference | null {
  if (value == null) return null;

  if (typeof value === "string") {
    // Trimmed, as the object branch trims its collection name. A cleared or
    // whitespace-only `redirectPage` reads as a reference otherwise, which
    // validation accepts as a usable target while the collection hook refuses
    // it as missing and the submit path resolves to nothing.
    const id = value.trim();
    return id && collections.length === 1
      ? { collection: collections[0], id }
      : null;
  }

  if (typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const relationTo = record.relationTo;
  const inner = record.value;

  if (typeof relationTo === "string" && relationTo.trim()) {
    // Trimmed for the TEST and in the VALUE returned. A blank or whitespace
    // name is not a collection, and a padded one is not the same string as the
    // configured key — accepting `" pages "` while returning it unchanged
    // makes this read valid to the public validator and unusable to every
    // consumer that looks the name up.
    const id = referenceId(inner);
    return id ? { collection: relationTo.trim(), id } : null;
  }

  // A populated row with no `relationTo` beside it: same ambiguity as a bare
  // id, and the same answer.
  const id = referenceId(record);
  if (!id) return null;
  return collections.length === 1 ? { collection: collections[0], id } : null;
}

function referenceId(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const { id } = value as Record<string, unknown>;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

/**
 * The field the publish lifecycle puts on every row it manages.
 *
 * A collection without the lifecycle may legally define an ordinary field
 * named `status` — "active", "archived", anything — so the NAME `status` does
 * not identify a lifecycle and reading it as one marks live documents as
 * drafts. This field does identify it: it is written by the framework, not by
 * a schema author.
 *
 * Measured on 2026-08-25, creating one document in each kind of collection:
 * a `status: true` collection returns
 * `[createdAt, firstPublishedAt, id, slug, status, title, updatedAt]`, and a
 * plain collection carrying its own `status` text field returns the same list
 * WITHOUT `firstPublishedAt`. It is present on a never-published draft too, so
 * presence marks the lifecycle rather than the act of publishing.
 */
const PUBLISH_LIFECYCLE_FIELD = "firstPublishedAt";

/**
 * Whether this document comes from a collection with the publish lifecycle.
 *
 * Callers that project their reads must request
 * {@link PUBLISH_LIFECYCLE_FIELD}; a projection that omits it makes every
 * document look unmanaged, which reads as "always reachable".
 */
export function hasPublishLifecycle(document: RedirectTargetDocument): boolean {
  return PUBLISH_LIFECYCLE_FIELD in document;
}

/**
 * Whether a visitor can reach this document.
 *
 * Unmanaged documents are always reachable: there is no unpublished state for
 * them to be in. Managed ones are reachable only when published — every other
 * lifecycle state is one the public route does not serve.
 *
 * Lives here, beside the reference parser, because the save rule and the admin
 * picker have to agree about which pages are reachable. Two readers that agree
 * today would drift, and a picker marking the wrong rows as drafts still looks
 * like a working picker.
 */
export function documentIsReachable(document: RedirectTargetDocument): boolean {
  if (!hasPublishLifecycle(document)) return true;
  return document.status === "published";
}

/** The settings keys that can carry the document a form redirects to. */
export type PickedDocumentField = "redirectPage" | "redirectRelation";

/**
 * Which settings key names the document this form redirects to, if any.
 *
 * TWO options carry one. "Redirect to a page" stores `redirectPage`, and the
 * URL option falls back to `redirectRelation` when no URL is typed — the shape
 * code-first and legacy forms use, and one the submission path has always
 * resolved. One definition of the question, so the rule that guards a target
 * cannot recognise fewer shapes than the resolver that acts on it: a form the
 * rule skips is a form the resolver still redirects.
 *
 * The two are not equally strict about being EMPTY, deliberately. Naming
 * nothing under "Redirect to a page" contradicts the option itself, so it is
 * reported. Under the URL option an absent relation only means no destination
 * is configured yet — `validateFormConfig` already governs that, and refusing
 * it here would reject saves this rule never governed.
 */
export function pickedDocumentField(
  settings: Record<string, unknown>
): PickedDocumentField | null {
  if (settings.confirmationType === "relationship") return "redirectPage";
  if (
    settings.confirmationType === "redirect" &&
    !settings.redirectUrl &&
    settings.redirectRelation != null
  ) {
    return "redirectRelation";
  }
  return null;
}

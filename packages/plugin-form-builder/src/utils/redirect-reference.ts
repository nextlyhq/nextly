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
 * How reachable a document is, as one of three answers.
 *
 * Three rather than a boolean because one of the cases is genuinely
 * undecidable from a redirect target's row, and collapsing it into either
 * answer is wrong in a different direction.
 */
export type Reachability = "reachable" | "unreachable" | "unknown";

/**
 * Whether a visitor can reach this document.
 *
 * `collectionIsLocalized` is the caller's knowledge of the target collection's
 * `localized` setting, or `undefined` where the caller has no way to know.
 *
 * A localized collection publishes PER LOCALE, on a companion row that no read
 * available here returns. Measured on 2026-08-25 against a collection with
 * `localized: true` whose Spanish translation was published while the default
 * locale stayed a draft: `findByID` answers `status: "draft"` at the default
 * locale AND at `es`, and a `find` filtered to `status: "published"` returns
 * the document at no locale at all — no locale, `en` or `es`. So the main
 * row's `status` does not answer for a localized document, and reading it as
 * an answer marks a page visitors can reach as a draft, refuses a correct save
 * and drops a working redirect.
 *
 * `firstPublishedAt` is the one fact that survives that: it records whether the
 * document has ever been public in ANY language, so its absence is decisive
 * whether or not the collection is localized.
 */
export function documentReachability(
  document: RedirectTargetDocument,
  collectionIsLocalized: boolean | undefined
): Reachability {
  // No lifecycle at all: there is no unpublished state to be in.
  if (!hasPublishLifecycle(document)) return "reachable";
  if (document.status === "published") return "reachable";

  // Never public in any language. The only judgement that holds for a
  // localized collection and a plain one alike.
  if (!document.firstPublishedAt) return "unreachable";

  // Published before and not published now. Decisive only where the caller
  // knows no translation can be carrying it.
  if (collectionIsLocalized === false) return "unreachable";

  return "unknown";
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

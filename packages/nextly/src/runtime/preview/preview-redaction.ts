/**
 * Rendering a previewed document through the permissions of whoever shared it.
 *
 * A granted draft read is TRUSTED, and it has to be: the working-draft overlay
 * is gated on edit capability while a preview route resolves anonymously, so an
 * enforced read would return the published values and report success. That
 * decision is sound and this module does not change it.
 *
 * What it repairs is a consequence of it. ONE flag decides both row trust and
 * FIELD trust — `applyFieldReadAccess` returns immediately when `overrideAccess`
 * is set — so trusting the row switches field-level read rules off with it, and
 * the document comes back carrying every field. A link therefore showed its
 * recipient fields the person sharing it could not see, which makes it a way to
 * read past your own permissions by sending yourself one.
 *
 * So the row stays trusted and the FIELDS are judged separately, against the
 * identity the token recorded. The link then shows exactly what the sharer sees
 * and no more, which is both the safe answer and the one an editor expects from
 * something called "share".
 *
 * @module runtime/preview/preview-redaction
 */

import { buildUserContext } from "../../auth/user-context";
import { getCachedNextly } from "../../init";
import { listRoleSlugsForUser } from "../../services/lib/permissions";
import { applyFieldReadAccess } from "../../shared/lib/field-level-registry";

/** What the redaction applies to, and on whose behalf. */
export interface PreviewRedactionSubject {
  /** `collection` or `single`, for the field registry's lookup. */
  kind: "collection" | "single";
  /** The entity whose field rules are being applied. */
  slug: string;
  /** The id of the user who shared the link. */
  minter: string;
}

/**
 * Strip the fields the sharer could not read from a document about to render.
 *
 * Mutates in place, because that is what `applyFieldReadAccess` does and
 * returning a copy would leave the caller free to render the original.
 *
 * **The identity is rebuilt from the id and the roles it resolves to**, which is
 * what a role-based rule and an owner-only rule each need — the first reads
 * `roles`, the second compares the document's owner against `id`. A CUSTOM rule
 * that reads some other profile field sees it absent and therefore denies,
 * stripping more rather than less. That is the safe direction, and it is stated
 * here rather than left to be discovered: a rule keyed on an email domain will
 * withhold its field from a preview that the sharer can see in the admin.
 */
export async function redactAsMinter(
  document: Record<string, unknown>,
  { kind, slug, minter }: PreviewRedactionSubject
): Promise<void> {
  // Booted first: resolving roles reaches the container, and a preview can be
  // the first request a cold process handles.
  await getCachedNextly();

  const roles = await listRoleSlugsForUser(minter);

  await applyFieldReadAccess({
    kind,
    slug,
    entry: document,
    user: buildUserContext({ id: minter, roles }),
    // FALSE, which is the entire purpose. The row was read trusted so the draft
    // overlay would appear; the fields are judged as the sharer, so what appears
    // is what they can see.
    overrideAccess: false,
  });
}

/**
 * Who a previewed draft is rendered as.
 *
 * A granted draft read is TRUSTED, and it has to be: the working-draft overlay
 * is gated on edit capability while a preview route resolves anonymously, so an
 * enforced read would return the published values and report success. That
 * decision is sound and this module does not change it.
 *
 * What it repairs is a consequence of it. ONE flag decided both row trust and
 * FIELD trust — `applyFieldReadAccess` returns immediately when `overrideAccess`
 * is set — so trusting the row switched field-level read rules off with it, and
 * the document came back carrying every field. A link therefore showed its
 * recipient fields the person sharing it could not see, which makes it a way to
 * read past your own permissions by sending yourself one.
 *
 * The remedy is not a second redaction pass over the finished document. It is
 * an identity: the read keeps its row bypass, names this user, and asks for
 * field rules to be enforced — so they run in the query pipeline's own
 * before-and-after-hooks sandwich, where a hook cannot copy a denied field onto
 * an allowed one between the two passes.
 *
 * @module runtime/preview/preview-identity
 */

import { buildUserContext } from "../../auth/user-context";
import { getService } from "../../di/register";
import type { UserContext } from "../../domains/collections/services/collection-types";
import { getCachedNextly } from "../../init";
import { listRoleSlugsForUser } from "../../services/lib/permissions";

/**
 * Rebuild the `UserContext` the sharer's own request would be judged against.
 *
 * **Read live on every render rather than snapshotted into the token, and the
 * trade-off is deliberate.** A snapshot would reproduce the sharer's context
 * exactly, including claims this cannot reach — but it would also freeze their
 * permissions at the moment they pressed share, so a link would keep rendering
 * under access that was revoked an hour ago. Re-reading means a revocation
 * takes effect on the next render of every outstanding link.
 *
 * **What it reconstructs, and why these four fields are the right ones.** A
 * live request builds this object from the caller's verified token claims plus
 * the canonical identity ({@link buildUserContext}). This framework's own
 * session token carries no non-canonical claims, so `{ id, name, email, roles }`
 * read back from the user record is not an approximation of that object — it is
 * the same object.
 *
 * **The stored user record is deliberately NOT spread in.** Custom columns on
 * the users table are not claims: they never reach a live request's
 * `UserContext`, so a rule reading `user.department` denies there. Carrying them
 * here would make a preview show MORE than the sharer sees in the admin, which
 * is the direction this whole module exists to prevent.
 *
 * **The residual, stated rather than left to be found.** A deployment that
 * authenticates through its own provider can put arbitrary claims on a token,
 * and those exist only for the duration of a request. A rule reading one sees
 * it ABSENT here — and absence is not the safe direction: `user.tier !==
 * "restricted"` PASSES when `tier` is missing. Such a rule will show a field in
 * a preview that it withholds from the sharer's own admin view. Closing that
 * needs the sharer's claims carried out of the request that minted the link,
 * which is a design decision about the token, not about this function.
 *
 * @returns The identity, or `null` when it cannot be established — a deleted
 * user, or a database that will not answer. The caller must refuse the draft
 * rather than render without one: a preview with no identity is a preview with
 * no field rules, which is the defect itself.
 */
export async function resolvePreviewIdentity(
  minter: string
): Promise<UserContext | null> {
  // Booted first: both lookups below reach the container, and a preview link
  // can be the first request a cold process handles.
  await getCachedNextly();

  try {
    const [user, roles] = await Promise.all([
      getService("userService").findById(minter, {}),
      listRoleSlugsForUser(minter),
    ]);

    return buildUserContext({
      id: user.id,
      // `?? undefined` rather than passed through: the record stores an absent
      // name as null, and a rule comparing `user.name` against a string would
      // read the null as a value it can test rather than as nothing.
      name: user.name ?? undefined,
      email: user.email,
      roles,
    });
  } catch {
    // Fails CLOSED, and the caller turns this into "no draft". Rendering the
    // draft as nobody would apply no field rules at all, which is exactly the
    // leak; rendering it as a guessed identity would authorize a view nobody
    // asked for. The reviewer sees the published page or a 404, the same as an
    // expired link.
    return null;
  }
}

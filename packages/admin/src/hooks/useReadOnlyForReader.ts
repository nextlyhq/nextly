import { useCurrentUserPermissions } from "./useCurrentUserPermissions";

/**
 * What the server's capabilities answer says about the signed-in user
 * changing the collection or Single `slug`: allowed or refused; `switching`
 * while the content language changes and the answer on screen is the one
 * moved from, which grants nothing; `unknown` while no answer is in hand.
 */
export type UpdateAnswer = "allowed" | "refused" | "switching" | "unknown";

/** {@link UpdateAnswer} for `slug`, the one place it is read. */
export function useUpdateAnswer(slug: string): UpdateAnswer {
  const { content, canAccessCollection } = useCurrentUserPermissions();
  if (content.isPlaceholder) return "switching";
  if (!content.hasAnswer) return "unknown";
  return canAccessCollection(slug, "update") ? "allowed" : "refused";
}

/**
 * Whether an editor of `slug` offers changing the document: not where the
 * answer refuses it, nor while a language switch's answer is on its way, when
 * the editor stays mounted on the language moved from and nothing that saves
 * is offered for the new one.
 */
export function editsOffered(answer: UpdateAnswer): boolean {
  return answer !== "refused" && answer !== "switching";
}

/**
 * Whether the signed-in user may read the collection or Single `slug` but not
 * change it, as the server's capabilities answer says, so its editor opens
 * read-only.
 *
 * False until that answer is in hand: an editor is not turned read-only, and
 * its document claim released, on a guess while the answer is on its way. The
 * server refuses any change the answer would have refused either way, and
 * nothing that saves is offered meanwhile (see {@link useUpdateAnswer}).
 */
export function useReadOnlyForReader(slug: string): boolean {
  return useUpdateAnswer(slug) === "refused";
}

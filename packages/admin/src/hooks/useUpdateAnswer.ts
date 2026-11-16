import { useCurrentUserPermissions } from "./useCurrentUserPermissions";

/**
 * What the server's capabilities answer says about the signed-in user
 * changing the collection or Single `slug`: allowed or refused; `switching`
 * while the answer on screen is the language moved from, kept until this
 * one's arrives, which grants nothing; `unknown` while no answer is in hand. A page opens
 * read-only for a reader on `refused` alone, never on a guess while the
 * answer is on its way.
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

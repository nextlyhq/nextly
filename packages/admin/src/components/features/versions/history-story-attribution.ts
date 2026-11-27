/**
 * Who acted, in words, with who stood behind them: "Claude Code, for Sara
 * Malik, approved on phone", "Sara Malik, from the command line",
 * "Deployment (Vercel build, commit 3f2a1c9)".
 *
 * The one wording for it. The Team activity card and the entry history both
 * name an actor through this, so the two never say the same row two ways.
 * Pure, so every phrasing is tested once.
 *
 * @module components/features/versions/history-story-attribution
 */

/**
 * What a row says stood behind its actor, as the server sends it. Every part
 * is optional: an older server sends none, and a row nothing stood behind
 * sends nulls.
 */
export interface ActorAttributionWords {
  /** The agent that acted for the person ("Claude Code"). */
  agentName?: string | null;
  /** How the call arrived: `local`, `command`, `chat-app`, `rest-key` or `deploy`. */
  door?: string | null;
  /** Where an approval was given: `phone`, `browser` or `admin`. */
  approvedVia?: string | null;
  /** The deployment's host, or the machine it ran from. */
  deploymentHost?: string | null;
  /** The commit a pipeline deployment built. */
  deploymentCommit?: string | null;
}

/** Where an approval was given, as the sentence says it. */
const APPROVAL_PLACE_WORDS: Readonly<Record<string, string>> = {
  phone: "approved on phone",
  browser: "approved in the browser",
  admin: "approved in the admin",
};

/** How many characters of a commit are shown, as hosts and git show one. */
const SHORT_COMMIT_LENGTH = 7;

/**
 * A deployment, named in place of its actor: from a pipeline, by host and
 * short commit; from a person's machine against a live site, by the machine.
 */
function deploymentName(attribution: ActorAttributionWords): string | null {
  const host = attribution.deploymentHost;
  if (!host) return null;
  if (attribution.door === "local") return `Deployment (this machine, ${host})`;
  const commit = attribution.deploymentCommit
    ? attribution.deploymentCommit.slice(0, SHORT_COMMIT_LENGTH)
    : "unknown";
  return `Deployment (${host}, commit ${commit})`;
}

/**
 * Who acted, as one phrase: the person, or the agent for the person, then
 * "from the command line" when it ran there, then where an approval was
 * given. A deployment is named in place of the actor. A door or a place this
 * build has no words for says nothing rather than printing its code.
 *
 * @param person - The actor's name as the reader already shows it, a deleted
 *   person's label included.
 */
export function attributedActorName(
  person: string,
  attribution: ActorAttributionWords
): string {
  const deployment = deploymentName(attribution);
  if (deployment) return deployment;
  const parts = [
    attribution.agentName ? `${attribution.agentName}, for ${person}` : person,
  ];
  if (attribution.door === "local") parts.push("from the command line");
  const approval = attribution.approvedVia
    ? APPROVAL_PLACE_WORDS[attribution.approvedVia]
    : undefined;
  if (approval) parts.push(approval);
  return parts.join(", ");
}

/**
 * An actor's name as the subject of a sentence: followed by a comma when the
 * name carries clauses of its own ("Claude Code, for Ana, approved on phone,
 * saved Doc 1"), so the verb reads as the actor's and not the last clause's.
 * Commas inside parentheses are the name's own ("Deployment (Vercel build,
 * commit 3f2a1c9) saved Doc 1"), and a name without clauses is left as it is.
 */
export function asSentenceSubject(name: string): string {
  const outsideParentheses = name.replace(/\([^)]*\)/g, "");
  return outsideParentheses.includes(",") ? `${name},` : name;
}

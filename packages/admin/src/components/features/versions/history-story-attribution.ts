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
  /** The agent that acted for the actor ("Claude Code"). */
  agentName?: string | null;
  /** How the call arrived: `local`, `command`, `chat-app`, `rest-key` or `deploy`. */
  door?: string | null;
  /** Where an approval was given: `phone`, `browser` or `admin`. */
  approvedVia?: string | null;
  /** The deployment's host, or the machine it ran from. */
  deploymentHost?: string | null;
  /** The commit a pipeline deployment built. */
  deploymentCommit?: string | null;
  /**
   * Whether the actor is an API key rather than a person. An agent acts FOR a
   * person but WITH a key, so the phrase joins them differently.
   */
  actorIsKey?: boolean;
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

/** The phrase, and whether it added clauses to the actor's own name. */
function phraseOf(
  actor: string,
  attribution: ActorAttributionWords
): { text: string; clauses: boolean } {
  const deployment = deploymentName(attribution);
  if (deployment) return { text: deployment, clauses: false };
  const parts: string[] = [];
  if (attribution.agentName) {
    const joined = attribution.actorIsKey ? "with" : "for";
    parts.push(`${attribution.agentName}, ${joined} ${actor}`);
  } else {
    parts.push(actor);
  }
  if (attribution.door === "local") parts.push("from the command line");
  const approval = attribution.approvedVia
    ? APPROVAL_PLACE_WORDS[attribution.approvedVia]
    : undefined;
  if (approval) parts.push(approval);
  return {
    text: parts.join(", "),
    clauses: Boolean(attribution.agentName) || parts.length > 1,
  };
}

/**
 * Who acted, as one phrase: the actor, or the agent for the person (with the
 * key), then "from the command line" when it ran there, then where an
 * approval was given. A deployment is named in place of the actor. A door or
 * a place this build has no words for says nothing rather than printing its
 * code.
 *
 * @param actor - The actor's name as the reader already shows it, a deleted
 *   person's label included.
 */
export function attributedActorName(
  actor: string,
  attribution: ActorAttributionWords
): string {
  return phraseOf(actor, attribution).text;
}

/**
 * The same phrase as the subject of a sentence: closed with a comma when it
 * added clauses ("Claude Code, for Ana, approved on phone, saved Doc 1"), so
 * the verb reads as the actor's and not the last clause's. A name the phrase
 * left as it was is left alone, its own commas included ("Malik, Sara saved
 * Doc 1").
 */
export function actorSubject(
  actor: string,
  attribution: ActorAttributionWords
): string {
  const { text, clauses } = phraseOf(actor, attribution);
  return clauses ? `${text},` : text;
}

/**
 * What the publish dialog says and holds, from what the server has described
 * and refused so far. Pure: the dialog draws this one answer, so what it says
 * and what its button does cannot disagree.
 *
 * @module components/features/translations/page/publish-view
 */

import { outOfDateSharedFields } from "@admin/hooks/useSharedFieldsRecovery";
import type {
  PartsLanguageOutcome,
  PublishPartsResult,
} from "@admin/services/publishParts";

import {
  goingLiveTooSentence,
  publishes,
  publishSentence,
  refusalMessages,
  sharedGoLive,
  sharedGoLiveSentence,
  type LabelOf,
} from "./publish-language-words";

/** A language behind the published shared fields. */
export type BehindOutcome = Extract<
  PartsLanguageOutcome,
  { outcome: "out-of-date" }
>;

export interface PublishFacts {
  language: { code: string; label: string };
  labelOf: LabelOf;
  /** The other languages a first publish shows; see `languagesGoingLiveToo`. */
  goingLiveToo: readonly string[] | undefined;
  /** What was confirmed, else what the server describes now. */
  described: PublishPartsResult | undefined;
  /** Why the publish, or its description, was refused; null where neither was. */
  refusal: unknown;
  /** Whether the description itself was refused. */
  undescribed: boolean;
  /** Whether the publish was refused because the document changed. */
  changedSince: boolean;
  /** Whether the description is being asked for. */
  asking: boolean;
  /** Whether the publish is on its way. */
  publishing: boolean;
  /** Whether anything is on its way. */
  busy: boolean;
}

export interface PublishView {
  /** What the publish does, in order. */
  says: string[];
  /** Whether to list the fields left empty. */
  listsEmpty: boolean;
  /** Set where the language has to take the live values first. */
  behind: BehindOutcome | undefined;
  /** Whether the publish can't be confirmed now. */
  held: boolean;
  /** Why the server refuses, each reason once. */
  refused: string[];
}

/**
 * What the language would become: as described, or as a publish refused for
 * the same reason says, since the description and the publish are judged at
 * different moments.
 */
function outcomeOf({
  described,
  language,
  refusal,
}: PublishFacts): PartsLanguageOutcome | undefined {
  const behind = outOfDateSharedFields(refusal);
  if (behind !== null) {
    return { locale: language.code, outcome: "out-of-date", ...behind };
  }
  return described?.languages.find(each => each.locale === language.code);
}

/** Whether what the publish does is known: described, and not behind. */
function isKnown(
  { publishing, asking, undescribed }: PublishFacts,
  outcome: PartsLanguageOutcome | undefined
): boolean {
  if (publishing) return true;
  if (asking || undescribed) return false;
  return outcome !== undefined && outcome.outcome !== "out-of-date";
}

/** The sentences of a publish, and of what goes live with it. */
function sentencesOf(
  { language, labelOf, goingLiveToo, described }: PublishFacts,
  outcome: PartsLanguageOutcome | undefined,
  known: boolean
): string[] {
  const withShared = sharedGoLive(described);
  const first = publishSentence(outcome, language.label, withShared);
  if (!known || !withShared) return [first];
  const also = goingLiveTooSentence(goingLiveToo, labelOf);
  return [
    first,
    sharedGoLiveSentence(language.label),
    ...(also === undefined ? [] : [also]),
  ];
}

function refusedOf({ language, refusal }: PublishFacts): string[] {
  return refusalMessages(
    refusal,
    language.label,
    `${language.label} couldn't be published.`
  );
}

export function publishView(facts: PublishFacts): PublishView {
  const { asking, busy, changedSince, described } = facts;
  const outcome = outcomeOf(facts);
  const behind = outcome?.outcome === "out-of-date" ? outcome : undefined;
  const known = isKnown(facts, outcome);
  const does = known && publishes(outcome, sharedGoLive(described));
  // Nothing is said of a language behind while it is asked about again.
  const says = known || (behind !== undefined && !asking);
  return {
    says: says ? sentencesOf(facts, outcome, known) : [],
    listsEmpty: does,
    behind,
    // A publish that failed may be pressed again, unless it was refused because
    // the document changed: what is described is then another document.
    held: !does || busy || changedSince,
    refused: asking || behind !== undefined ? [] : refusedOf(facts),
  };
}

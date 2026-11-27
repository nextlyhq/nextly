/**
 * What can be done with the language being written, and what each action waits
 * for: which are offered, which is the main one, and what is said of them.
 * Pure, so the buttons, the menu and the sentences under them are drawn from
 * one answer.
 *
 * @module components/features/translations/page/language-actions
 */

import {
  hasSomethingToPublish,
  holdsStrandedDraft,
  offlineApplies,
  publishApplies,
  saveReach,
  saveReachSentence,
  type DraftRules,
  type LanguageStanding,
  type SaveReach,
} from "./language-standing";

export interface ActionFacts {
  /** The language's name. */
  language: string;
  rules: DraftRules;
  standing: LanguageStanding;
  mayPublish: boolean;
  mayUnpublish: boolean;
  /** Whether the reader may not write here. */
  readOnly: boolean;
  /** Whether nothing of the document may be written at all. */
  removed: boolean;
  isDirty: boolean;
  isSaving: boolean;
}

/** The action the main button is. */
export type MainAction = "publish" | "save" | "open";

export interface LanguageActions {
  main: MainAction;
  offersOffline: boolean;
  /** Whether Publish stores what is unsaved before it asks. */
  savesFirst: boolean;
  canPublishNow: boolean;
  /** What Save is called. */
  saveLabel: string;
  /** What to say before a save that readers see; undefined where none do. */
  note: string | undefined;
  /** Why Publish or Take offline waits; undefined where neither does. */
  waiting: string | undefined;
  /** Whether the language holds a draft that can never be published. */
  stranded: boolean;
}

/** Which action the main button is, and which the rest offer. */
function offered({
  rules,
  standing,
  mayPublish,
  mayUnpublish,
  readOnly,
  removed,
}: ActionFacts): Pick<LanguageActions, "main" | "offersOffline"> {
  const otherwise: MainAction = readOnly ? "open" : "save";
  if (removed) return { main: otherwise, offersOffline: false };
  const publish = mayPublish && publishApplies(rules, standing);
  return {
    main: publish ? "publish" : otherwise,
    offersOffline: mayUnpublish && offlineApplies(rules, standing),
  };
}

/** Why Publish or Take offline waits for what is unsaved. */
function waitingSentence(
  { isDirty, readOnly, language }: ActionFacts,
  publishWaits: boolean,
  offlineWaits: boolean
): string | undefined {
  if (!isDirty || (!publishWaits && !offlineWaits)) return undefined;
  if (readOnly) {
    return "Your unsaved changes can't be saved any more. Reload the page to go on.";
  }
  if (!publishWaits) {
    return `Save your changes before taking ${language} offline.`;
  }
  return offlineWaits
    ? `Save your changes before publishing ${language} or taking it offline.`
    : `Save your changes before publishing ${language}.`;
}

/**
 * Whether Publish stores what is unsaved first: only where no reader is shown
 * it by that save. Anywhere else Save does it, whose own sentence says so.
 */
function storesFirst(
  { isDirty, readOnly }: ActionFacts,
  reach: SaveReach
): boolean {
  return isDirty && !readOnly && reach === "nobody";
}

function publishableNow(
  { standing, isDirty, isSaving }: ActionFacts,
  savesFirst: boolean
): boolean {
  if (isSaving || (isDirty && !savesFirst)) return false;
  return hasSomethingToPublish(standing, isDirty);
}

/** A draft only where no reader is shown it: anywhere else a save is not one. */
function saveLabelOf({ rules }: ActionFacts, reach: SaveReach): string {
  return rules.hasStatus && reach === "nobody" ? "Save draft" : "Save";
}

export function languageActions(facts: ActionFacts): LanguageActions {
  const { rules, standing, readOnly, removed, language } = facts;
  const reach = saveReach(rules, standing);
  const { main, offersOffline } = offered(facts);
  const savesFirst = storesFirst(facts, reach);
  return {
    main,
    offersOffline,
    savesFirst,
    canPublishNow: publishableNow(facts, savesFirst),
    saveLabel: saveLabelOf(facts, reach),
    note: readOnly ? undefined : saveReachSentence(reach, rules, language),
    waiting: waitingSentence(
      facts,
      main === "publish" && !savesFirst,
      offersOffline
    ),
    stranded: !removed && holdsStrandedDraft(rules, standing),
  };
}

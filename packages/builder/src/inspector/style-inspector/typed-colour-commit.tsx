/**
 * The colour box's own handling of what is typed into it: the refusal it shows
 * for text that is neither a colour nor a variable's name, the suggestion
 * connected from the list under it, and the end-of-edit write that decides
 * between a colour, a variable and a refusal.
 *
 * Apart from `style-colour-field.tsx`, which draws the box, so the decisions
 * read on their own.
 *
 * @module inspector/style-inspector/typed-colour-commit
 */
import {
  checkColorValue,
  isTokenRef,
  type StyleValue,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { LiveDraft } from "../../live-draft";
import { focusAfterUnlink } from "../../panels/design/variable-choice";
import {
  colourVariablesMatching,
  type SiteVariable,
} from "../../styles/style-colour";

import type { CommitOutcome } from "./style-field-surroundings";

/** Text the colour box was left holding and did not take. */
interface TypedRefusal {
  readonly text: string;
  /** Whether it is the whole name of more than one variable. */
  readonly shared: boolean;
}

/** What the box says about text it did not take. */
function refusalWords(refused: TypedRefusal): string {
  return refused.shared
    ? `More than one variable is called "${refused.text}". Choose one from the list.`
    : `No color or variable is called "${refused.text}".`;
}

/**
 * Text the box was left holding that is neither a colour nor a variable's
 * name, said in the box's own words until the box is written another way.
 * `refusalId` names the line saying so, and is `undefined` while there is none,
 * so the box is described by it only while it shows.
 *
 * A refusal belongs to the text it was given for, `draft` being the text the
 * box holds now: once other text replaces it (an undo, a Reset, typing), the
 * box no longer holds what was refused, and says nothing about it.
 */
export function useTypedRefusal(draft: string): {
  refused: TypedRefusal | undefined;
  setRefused: (refused: TypedRefusal | undefined) => void;
  refusalId: string | undefined;
} {
  const id = React.useId();
  const [given, setRefused] = React.useState<TypedRefusal>();
  const refused = given?.text === draft.trim() ? given : undefined;
  return {
    refused,
    setRefused,
    refusalId: refused === undefined ? undefined : id,
  };
}

/**
 * The line under the box saying why its text was not taken. Not once a
 * variable is connected: the box, and the text it held, have given way to the
 * trigger naming the variable.
 */
export function TypedRefusalLine({
  id,
  refused,
  connected,
}: {
  id: string | undefined;
  refused: TypedRefusal | undefined;
  connected: boolean;
}): React.JSX.Element | null {
  if (refused === undefined || connected) return null;
  return (
    <p className="nx-inspector__error" id={id} role="alert">
      {refusalWords(refused)}
    </p>
  );
}

/**
 * A suggestion taken from the list under the box: its variable connected, as
 * a reference by identity, and focus moved to the trigger that names it now,
 * since the box gives way to that trigger rather than falling to the page.
 * A write refused (a locked design, a page at its size limit) leaves focus in
 * the box, which stays with its text, and the write's own refusal beside it.
 */
export function connectSuggestion(
  variable: SiteVariable,
  {
    fieldId,
    typesLive,
    live,
    commitColour,
    commitInstead,
    clearRefusal,
  }: {
    fieldId: string;
    /** Whether the box writes as it is typed (see `useTypesLive`). */
    typesLive: boolean;
    live: LiveDraft;
    commitColour: (value: StyleValue | null) => CommitOutcome;
    /** The write every other way of setting the value makes. */
    commitInstead: (value: StyleValue | null) => CommitOutcome;
    clearRefusal: () => void;
  }
): void {
  const row = document
    .getElementById(fieldId)
    ?.closest<HTMLElement>(".nx-style-inspector__colour");
  const token = { $token: variable.identity };
  let outcome: CommitOutcome;
  if (typesLive) {
    // In the edit's own run of typing, so a hex written as it was typed and
    // the variable chosen for it are one step of undo.
    clearRefusal();
    outcome = live.join(() => commitColour(token));
    live.end();
  } else outcome = commitInstead(token);
  if (outcome === "refused") return;
  focusAfterUnlink(() =>
    row?.querySelector<HTMLElement>(".nx-style-inspector__colour-pick")
  );
}

/**
 * The colour box's end-of-edit write.
 *
 * Text the engine's colour check takes is written as typed, even where a
 * variable has the same name ("red" and a variable "Red"): only a choice from
 * the list connects that variable. Otherwise a variable's whole name connects
 * it, ignoring case, spaces and hyphens, as the list under the box matches it.
 * A refusal of the write itself (a locked design, a page at its size limit)
 * is the write's to say. Text that is neither a
 * colour nor a variable's name is refused here, in the box's own words, and
 * nothing is written: the document keeps the value from before the edit.
 */
export function useTypedColourCommit({
  choices,
  stored,
  draft,
  typesLive,
  onCommit,
  commitColour,
  setRefused,
}: {
  choices: readonly SiteVariable[];
  stored: StyleValue | undefined;
  /** The text the box holds, which the field may have read as a variable. */
  draft: string;
  /** Whether the box writes as it is typed, so a keystroke's refusal may show. */
  typesLive: boolean;
  onCommit: (value: StyleValue | null) => CommitOutcome;
  commitColour: (value: StyleValue | null) => CommitOutcome;
  setRefused: (refused: TypedRefusal | undefined) => void;
}): (value: StyleValue | null) => CommitOutcome {
  return value => {
    setRefused(undefined);
    const read = readTypedColour(value, draft, choices);
    if (read.kind === "write") return commitColour(read.value);
    // A keystroke's write may have left its own refusal beside the box ("half
    // a hex colour"). Asking for the stored value clears it and moves nothing
    // on a block, the only target written as it is typed.
    if (read.afterKeystrokes && typesLive) onCommit(stored ?? null);
    setRefused(read.refusal);
    return "refused";
  };
}

/**
 * What the box's end-of-edit write makes of its text: the value to write, or
 * the refusal to show. `afterKeystrokes` marks a refusal of text the
 * keystrokes may already have written, as opposed to a variable's name.
 */
type TypedColourRead =
  | { kind: "write"; value: StyleValue | null }
  | { kind: "refuse"; refusal: TypedRefusal; afterKeystrokes: boolean };

/** See {@link useTypedColourCommit}: the value the field read, judged. */
function readTypedColour(
  value: StyleValue | null,
  draft: string,
  choices: readonly SiteVariable[]
): TypedColourRead {
  const typed = draft.trim();
  if (isTokenRef(value) && typed !== "") {
    return readTypedName(value, typed, choices);
  }
  if (typeof value !== "string") return { kind: "write", value };
  return readTypedText(value, choices);
}

/**
 * A variable the field read the typed name of. A colour the text already is
 * wins over it ("red" and a variable "Red"). Its name is checked against the
 * names the list matches too: one another variable shares, spaced or
 * hyphenated differently, is refused as shared rather than picked between.
 */
function readTypedName(
  value: StyleValue,
  typed: string,
  choices: readonly SiteVariable[]
): TypedColourRead {
  if (checkColorValue(typed) === null) return { kind: "write", value: typed };
  const whole = colourVariablesMatching(typed, choices).filter(
    match => match.whole
  );
  if (whole.length > 1) {
    return {
      kind: "refuse",
      refusal: { text: typed, shared: true },
      afterKeystrokes: false,
    };
  }
  return { kind: "write", value };
}

/**
 * Text the field kept as text: a colour is written as typed, a variable's
 * unique whole name connects it, and anything else is refused.
 */
function readTypedText(
  value: string,
  choices: readonly SiteVariable[]
): TypedColourRead {
  if (checkColorValue(value.trim()) === null) return { kind: "write", value };
  const matches = colourVariablesMatching(value, choices);
  const named = matches.find(match => match.exact);
  if (named !== undefined) {
    return { kind: "write", value: { $token: named.variable.identity } };
  }
  return {
    kind: "refuse",
    refusal: {
      text: value.trim(),
      shared: matches.filter(match => match.whole).length > 1,
    },
    afterKeystrokes: true,
  };
}

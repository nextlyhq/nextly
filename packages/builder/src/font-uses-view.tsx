/**
 * Where one of the site's fonts is used, as the Fonts screen draws it, and
 * the two things that follow from it: what Remove says of a font in use, and
 * the question a font that finishes adding asks.
 *
 * The rules are {@link font-uses}'s; how many places a font variable reaches
 * is the Variables tab's own usage read ({@link variable-usage-view}), so the
 * screen and the Colours rows say the same "Used in N places".
 *
 * @module font-uses-view
 */
import type {
  FontFaceDef,
  NamedClass,
  SiteTextMap,
  SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import { toast } from "@nextlyhq/ui";
import * as React from "react";

import { roleStack, type SiteFamily } from "./font-library";
import {
  familyUses,
  roleLabel,
  roleRefusal,
  nowYourFontWords,
  type FamilyUses,
} from "./font-uses";
import {
  roleFamilies,
  roleSnapshot,
  withFontRole,
  withRoleSnapshot,
  type FontRole,
} from "./site-font-roles-model";
import {
  combinedReach,
  variableRemoval,
  variableStatus,
  type VariableReach,
  type VariablesAccess,
} from "./variable-usage";
import { useVariableUsage } from "./variable-usage-view";

/** Where one family is used, and how many places its variables reach. */
export interface FamilyUsesHere {
  readonly uses: FamilyUses;
  /** The places its variables reach together; `undefined` until all are read. */
  readonly reach: VariableReach | undefined;
}

/** A family nothing is known to use. */
const UNUSED: FamilyUsesHere = {
  uses: { roles: [], variables: [], counted: [] },
  reach: undefined,
};

/**
 * Where each of the site's families is used, by its key: the roles and font
 * variables naming it, and their places read through `usage` once for every
 * family together. No places are read without `usage`.
 */
export function useFamiliesUses(
  families: readonly SiteFamily[],
  tokens: SiteTokenSet | undefined,
  usage: VariablesAccess | undefined,
  classes?: readonly NamedClass[]
): (key: string) => FamilyUsesHere {
  const byKey = React.useMemo(
    () =>
      new Map(
        families.map(family => [
          family.key,
          familyUses(family.key, tokens, classes),
        ])
      ),
    [families, tokens, classes]
  );
  const identities = React.useMemo(
    () => [...new Set([...byKey.values()].flatMap(uses => uses.counted))],
    [byKey]
  );
  const reads = useVariableUsage(usage, identities);
  return (key: string): FamilyUsesHere => {
    const uses = byKey.get(key);
    if (uses === undefined) return UNUSED;
    // Every variable naming it counts, a role's own included.
    const reach =
      uses.counted.length === 0
        ? undefined
        : combinedReach(
            uses.counted.map(identity => reads.values.get(identity))
          );
    return { uses, reach };
  };
}

/** The places a font's variables reach, when any do. */
function placesUsed(reach: VariableReach | undefined): string | undefined {
  return variableRemoval(reach) === "in-use"
    ? variableStatus(reach)
    : undefined;
}

/**
 * Where a font is used, in a family's details: "Body font", "Headings font"
 * and "Used in N places", each a link where the host can open it. Nothing
 * while nothing is known to use it.
 */
export function WhereUsed({
  here,
  onOpenRole,
  onOpenTokens,
}: {
  here: FamilyUsesHere;
  onOpenRole: ((role: FontRole) => void) | undefined;
  onOpenTokens: (() => void) | undefined;
}): React.JSX.Element | null {
  const places = placesUsed(here.reach);
  if (here.uses.roles.length === 0 && places === undefined) return null;
  const label = "Where it’s used";
  return (
    <div className="nx-vars-editor__field">
      <span className="nx-vars-editor__label" aria-hidden="true">
        {label}
      </span>
      <ul className="nx-fonts__uses" aria-label={label}>
        {here.uses.roles.map(role => (
          <li key={role}>
            <Linked
              words={roleLabel(role)}
              onOpen={
                onOpenRole === undefined ? undefined : () => onOpenRole(role)
              }
            />
          </li>
        ))}
        {places === undefined ? null : (
          <li>
            <Linked words={places} onOpen={onOpenTokens} />
          </li>
        )}
      </ul>
    </div>
  );
}

/** Words that open what they name where the host can, and are said otherwise. */
function Linked({
  words,
  onOpen,
}: {
  words: string;
  onOpen: (() => void) | undefined;
}): React.JSX.Element {
  if (onOpen === undefined) return <>{words}</>;
  return (
    <button type="button" className="nx-vars__link" onClick={onOpen}>
      {words}
    </button>
  );
}

/**
 * Why Remove does not go ahead for the Body or Headings font, in place of
 * its confirmation, with the way to choose another where the host has one.
 */
export function RoleRefusal({
  family,
  roles,
  onOpenRole,
  onBack,
}: {
  family: string;
  roles: readonly FontRole[];
  onOpenRole: ((role: FontRole) => void) | undefined;
  onBack: () => void;
}): React.JSX.Element {
  const [first] = roles;
  return (
    <div
      className="nx-vars-editor__confirm"
      role="group"
      aria-label={`${family} can’t be removed`}
    >
      <p>{roleRefusal(family, roles)}</p>
      <div className="nx-vars-editor__actions">
        <button type="button" className="nx-vars__link" onClick={onBack}>
          Keep
        </button>
        {onOpenRole === undefined || first === undefined ? null : (
          <button
            type="button"
            className="nx-vars__link"
            onClick={() => onOpenRole(first)}
          >
            Choose another font
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * What a removal says of the font variables that lose the font: how many
 * places use them, then each variable with what its text falls back to.
 */
export function FallbackList({
  family,
  here,
}: {
  family: string;
  here: FamilyUsesHere;
}): React.JSX.Element {
  const places = placesUsed(here.reach);
  const reach = places === undefined ? "" : ` It’s ${lowerFirst(places)}.`;
  return (
    <>
      <p>
        Remove <strong>{family}</strong>?{reach} These variables will fall back:
      </p>
      <ul className="nx-fonts__fallbacks">
        {here.uses.variables.map(variable => (
          <li key={variable.identity}>
            {`${variable.label} falls back to “${variable.fallback}”`}
          </li>
        ))}
      </ul>
      <p>The files stay in your media library.</p>
    </>
  );
}

/** "Used in 4 places" as the middle of a sentence. */
function lowerFirst(words: string): string {
  return `${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

/** A font that finished adding, waiting for the author to say how to use it. */
export interface Asked {
  readonly family: string;
  /** The catalogue's category, when it came from there. */
  readonly category?: string;
}

/** The answers to "Use <font> for", in their order, with the roles each sets. */
const ANSWERS: readonly (readonly [string, readonly FontRole[]])[] = [
  ["Body", ["body"]],
  ["Headings", ["heading"]],
  ["Both", ["body", "heading"]],
];

/** What the question needs from the host: the site's variables and a writer. */
export interface UseForHost {
  readonly tokens: SiteTokenSet | undefined;
  /** The site's faces, `undefined` while unread. */
  readonly faces: readonly FontFaceDef[] | undefined;
  readonly codeFaces: readonly FontFaceDef[];
  /** A role that may not change the design is never asked. */
  readonly readOnly: boolean;
  /** Absent, or while the variables are unread, nothing is asked. */
  readonly onTokensChange: ((tokens: SiteTokenSet) => void) | undefined;
  /** The Site text rows the site's code supplies, which a role change keeps. */
  readonly suppliedText: SiteTextMap | undefined;
  /**
   * Told once a role is chosen, so the upload editor the question sits in
   * closes: open, it holds the toast's Undo and the canvas out of reach.
   */
  readonly onChosen?: () => void;
}

/**
 * The question a font that finished adding asks, and its answers. Body,
 * Headings or Both sets the site's font at once and says so in a toast whose
 * Undo puts back the roles as they were, onto the variables as they are by
 * then; Not now asks nothing more.
 */
export function useUseFor(host: UseForHost): {
  readonly asked: Asked | null;
  readonly ask: (family: string, category?: string) => void;
  readonly answer: (roles: readonly FontRole[] | null) => void;
  /** Stop asking about a family once it is removed: it has no faces now. */
  readonly dismiss: (family: string) => void;
} {
  const [asked, setAsked] = React.useState<Asked | null>(null);
  // The toast whose Undo builds on this screen's copy of the variables. It
  // goes when the screen does: past that, the copy no longer follows edits
  // made elsewhere, and an Undo would write them away.
  const offered = React.useRef<string | number | undefined>(undefined);
  React.useEffect(
    () => () => {
      if (offered.current !== undefined) toast.dismiss(offered.current);
    },
    []
  );
  // The variables as last drawn, so an Undo pressed later builds on them.
  const latest = React.useRef(host.tokens);
  latest.current = host.tokens;
  const onTokensChange = host.readOnly ? undefined : host.onTokensChange;
  const ask = (family: string, category?: string): void => {
    if (onTokensChange === undefined || host.tokens === undefined) return;
    setAsked(category === undefined ? { family } : { family, category });
  };
  const answer = (roles: readonly FontRole[] | null): void => {
    const now = latest.current;
    setAsked(null);
    if (roles === null || asked === null || now === undefined) return;
    if (onTokensChange === undefined) return;
    const stack =
      roleFamilies(host.faces ?? [], host.codeFaces).find(
        each => each.family.toLowerCase() === asked.family.toLowerCase()
      )?.stack ?? roleStack(asked.family, asked.category);
    // Each role as it was, its variable whole and its rows' fonts, so Undo
    // puts back exactly these and nothing changed since.
    const before = roles.map(role => roleSnapshot(now, role));
    const set = roles.reduce(
      (tokens, role) => withFontRole(tokens, role, stack, host.suppliedText),
      now
    );
    onTokensChange(set);
    host.onChosen?.();
    offered.current = toast.success(nowYourFontWords(asked.family, roles), {
      action: {
        label: "Undo",
        onClick: () => {
          onTokensChange(
            before.reduce(
              (tokens, snapshot) =>
                withRoleSnapshot(tokens, snapshot, host.suppliedText),
              latest.current ?? set
            )
          );
        },
      },
    });
  };
  const dismiss = (family: string): void => {
    setAsked(current =>
      current !== null && current.family.toLowerCase() === family.toLowerCase()
        ? null
        : current
    );
  };
  return { asked, ask, answer, dismiss };
}

/**
 * "Use <font> for: Body / Headings / Both / Not now", in place, while a font
 * that finished adding waits for an answer; nothing otherwise.
 */
export function UseForQuestion({
  asked,
  onAnswer,
}: {
  asked: Asked | null;
  onAnswer: (roles: readonly FontRole[] | null) => void;
}): React.JSX.Element | null {
  const id = React.useId();
  if (asked === null) return null;
  const { family } = asked;
  return (
    <div className="nx-fonts-use" role="group" aria-labelledby={id}>
      <p className="nx-fonts-use__ask" id={id}>
        {`Use ${family} for:`}
      </p>
      <div className="nx-fonts-use__answers">
        {ANSWERS.map(([words, roles]) => (
          <button
            key={words}
            type="button"
            className="nx-vars__link"
            onClick={() => onAnswer(roles)}
          >
            {words}
          </button>
        ))}
        <button
          type="button"
          className="nx-vars__link"
          onClick={() => onAnswer(null)}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

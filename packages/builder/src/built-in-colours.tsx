"use client";

/**
 * "Show built-in colours": the site setting that ends the Colours tab, and
 * the colours it hides from every colour picker in the builder.
 *
 * Off, a built-in colour (one the site's code or the engine supplies) that
 * nothing the site stores uses is left out of the Colours list and out of
 * the pickers. It is never removed: it is still a variable, and still
 * written on every page, because core blocks read the built-in colours.
 * What is hidden is asked afresh on every read ({@link hiddenColours}), so
 * a colour that becomes used is listed again with no write of its own.
 *
 * The Colours tab asks the rule from the counts it reads for its rows. The
 * pickers sit in the inspector and elsewhere, away from the tab, so a host
 * reads the same rule once with {@link useHiddenColoursRead} and hands it
 * down through {@link HiddenColours}.
 *
 * @module built-in-colours
 */
import { tokenIdentity, type SiteTokenSet } from "@nextlyhq/blocks-engine";
import { Checkbox, Label } from "@nextlyhq/ui";
import * as React from "react";

import { hiddenColours } from "./colour-usage";
import { usageState, type VariablesAccess } from "./variable-usage";
import { useVariableUsage } from "./variable-usage-view";

/** The setting's label and hint, word for word. */
const LABEL = "Show built-in colours";
const HINT = "Hidden colours still work where core blocks use them";

/** No colour hidden. */
const NONE: ReadonlySet<string> = new Set();

/**
 * The colours every colour picker in the builder leaves out, by identity: a
 * host provides it around the builder. None where no host does.
 *
 * @experimental Settles with the built-in colours setting.
 */
export const HiddenColours: React.Context<ReadonlySet<string>> =
  React.createContext<ReadonlySet<string>>(NONE);

/** Whether the site lists the built-in colours it does not use: unset is yes. */
export function builtInColoursShown(tokens: SiteTokenSet | undefined): boolean {
  return tokens?.builtInColoursShown !== false;
}

/** The site's variables with the setting changed, everything else as it was. */
export function withBuiltInColoursShown(
  tokens: SiteTokenSet,
  shown: boolean
): SiteTokenSet {
  return { ...tokens, builtInColoursShown: shown };
}

/** The identities of the colours among `tokens` that `supplied` supplies. */
function builtInColourIds(
  tokens: SiteTokenSet | undefined,
  supplied: SiteTokenSet | undefined
): string[] {
  const builtIn = new Set((supplied?.tokens ?? []).map(tokenIdentity));
  return (tokens?.tokens ?? [])
    .filter(token => token.kind === "color")
    .map(tokenIdentity)
    .filter(identity => builtIn.has(identity));
}

/** How long after a change of the variables their use is read again. */
const READ_AGAIN_AFTER_MS = 800;

/**
 * The colours the pickers leave out, for a host to provide through
 * {@link HiddenColours}: each built-in colour the site's count has shown
 * unused and the open page does not use, while the site hides them. Reads
 * the built-in colours' use only then, and again a moment after the site's
 * variables change, since a variable naming one makes it used.
 *
 * @experimental Settles with the built-in colours setting.
 */
export function useHiddenColoursRead({
  tokens,
  supplied,
  access,
  usedOnPage,
}: {
  /** The site's variables, the setting among them. */
  tokens: SiteTokenSet | undefined;
  /** What the site's code and the engine supply: the built-in variables. */
  supplied: SiteTokenSet | undefined;
  /** The host's reads of how widely variables are used. */
  access: VariablesAccess | undefined;
  /** The variables the open page uses, before any save. */
  usedOnPage?: ReadonlySet<string> | undefined;
}): ReadonlySet<string> {
  const shown = builtInColoursShown(tokens);
  const builtIns = React.useMemo(
    () => (shown ? [] : builtInColourIds(tokens, supplied)),
    [shown, tokens, supplied]
  );
  const { values, readAgain } = useVariableUsage(access, builtIns);
  useHiddenReadAgain(shown, tokens, builtIns, readAgain);
  return React.useMemo(
    () =>
      hiddenColours(builtIns, {
        shown,
        stateOf: identity => usageState(values.get(identity)),
        builtIn: () => true,
        onPage: usedOnPage,
      }),
    [builtIns, shown, values, usedOnPage]
  );
}

/**
 * Reads the built-in colours' use again a moment after the site's variables
 * change, while the site hides them: a variable or a style made to name a
 * hidden colour makes it used once saved, and it is then listed again.
 */
export function useHiddenReadAgain(
  shown: boolean,
  tokens: SiteTokenSet | undefined,
  builtIns: readonly string[],
  readAgain: ((identities: readonly string[]) => Promise<void>) | undefined
): void {
  const seen = React.useRef(tokens);
  const latest = React.useRef({ builtIns, readAgain });
  latest.current = { builtIns, readAgain };
  React.useEffect(() => {
    const changed = seen.current !== tokens;
    seen.current = tokens;
    if (shown || !changed) return undefined;
    const timer = window.setTimeout(() => {
      // A failed read keeps the counts as they were: nothing to say here.
      latest.current
        .readAgain?.(latest.current.builtIns)
        .catch(() => undefined);
    }, READ_AGAIN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [shown, tokens]);
}

/**
 * The checkbox that ends the Colours tab, with its hint. A site setting:
 * the change goes to the site's variables, for every author, and is saved
 * at once by the commit it is handed.
 */
export function BuiltInColoursSetting({
  tokens,
  readOnly,
  onChange,
}: {
  tokens: SiteTokenSet;
  readOnly: boolean;
  /** Writes the changed variables and saves them at once. */
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="nx-built-in-colours">
      <div className="nx-built-in-colours__line">
        <Checkbox
          id={id}
          checked={builtInColoursShown(tokens)}
          disabled={readOnly}
          aria-describedby={`${id}-hint`}
          onCheckedChange={checked =>
            onChange(withBuiltInColoursShown(tokens, checked === true))
          }
        />
        <Label htmlFor={id} className="nx-built-in-colours__label">
          {LABEL}
        </Label>
      </div>
      <p id={`${id}-hint`} className="nx-built-in-colours__hint">
        {HINT}
      </p>
    </div>
  );
}

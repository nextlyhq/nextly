/**
 * The parts of a variable's editor beside its name and values: its code
 * name with Copy, how widely it is used with where, and, for a colour, its
 * contrast with the site's Background and Text in light and in dark. Kept
 * apart from the editor, which lays them out.
 *
 * @module variable-popup-parts
 */
import {
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import { Moon, Sun } from "lucide-react";
import * as React from "react";

import { contrastLine } from "./variable-contrast";
import {
  variableRemoval,
  variableStatus,
  type VariableReach,
} from "./variable-usage";
import { VariableUses, type VariableUsageHere } from "./variable-usage-view";

/** ☀ or ☾ beside "Light" or "Dark", for sight: the words name the field. */
export function ModeIcon({ mode }: { mode: TokenMode }): React.JSX.Element {
  const Icon = mode === "light" ? Sun : Moon;
  return (
    <Icon
      aria-hidden="true"
      size={12}
      className="nx-vars-editor__mode-icon"
      data-mode-icon={mode}
    />
  );
}

/** How long "Copied" shows after the code name is copied. */
const COPIED_FOR_MS = 2000;

/**
 * "Code name: --site-…" and its Copy button. A variable never saved shows
 * the code name its name would give it, so it changes as the name is
 * typed; a saved one keeps its code name through every rename, and says so.
 */
export function CodeName({
  id,
  property,
  isNew,
}: {
  /** The line's id, which the name field is described by. */
  id: string;
  /** The custom property, `--site-color-brand`. */
  property: string;
  isNew: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = (): void => {
    void navigator.clipboard?.writeText(property).then(
      () => setCopied(true),
      () => undefined
    );
  };
  return (
    <div className="nx-vars-editor__code-name">
      <p className="nx-vars-editor__code" id={id}>
        <span>Code name: </span>
        <code>{property}</code>
      </p>
      <button
        type="button"
        className="nx-vars__link nx-vars-editor__copy"
        aria-label="Copy code name"
        onClick={copy}
      >
        Copy
      </button>
      <span className="nx-vars-editor__copied" role="status">
        {copied ? "Copied" : ""}
      </span>
      {isNew ? null : (
        <p className="nx-vars-editor__hint">
          Stays the same when you rename, so CSS that uses it keeps working
        </p>
      )}
    </div>
  );
}

/**
 * How widely the variable is used, with where on request: the count in
 * words, then the places, listed as the reason Remove waits lists them.
 */
export function UsageLine({
  identity,
  reach,
  usage,
}: {
  identity: string;
  reach: VariableReach | undefined;
  usage: VariableUsageHere;
}): React.JSX.Element {
  const [listed, setListed] = React.useState(false);
  // Only something used has places to list.
  const used = variableRemoval(reach) === "in-use";
  return (
    <div
      className="nx-vars-editor__usage"
      role="group"
      aria-label="Where it's used"
    >
      <span className="nx-vars-editor__status">{variableStatus(reach)}</span>
      {used && !listed ? (
        <button
          type="button"
          className="nx-vars__link"
          onClick={() => setListed(true)}
        >
          Show where
        </button>
      ) : null}
      {listed ? <VariableUses identity={identity} usage={usage} /> : null}
    </div>
  );
}

/** The two colours a colour is measured against, by identity. */
const PARTNERS = [
  { identity: "color.background", name: "On Background", role: "background" },
  { identity: "color.text", name: "With Text", role: "foreground" },
] as const;

/**
 * A colour's contrast with the site's Background and Text, in light and in
 * dark, each a ratio and what it is good for. A colour with no dark value
 * keeps its light one in dark mode while Background may change, so its
 * dark line says "Same in dark mode". Background is measured with Text
 * only, and Text on Background only; a pair that cannot be read says
 * nothing.
 */
export function ColourContrast({
  token,
  tokens,
  suppliedOf,
}: {
  token: SiteToken;
  tokens: SiteTokenSet;
  suppliedOf: (identity: string) => SiteToken | undefined;
}): React.JSX.Element | null {
  const own = tokenIdentity(token);
  const pairs = PARTNERS.flatMap(partner => {
    if (partner.identity === own) return [];
    const other =
      tokens.tokens.find(candidate => tokenIdentity(candidate) === partner.identity) ??
      suppliedOf(partner.identity);
    return other === undefined ? [] : [{ ...partner, other }];
  });
  if (pairs.length === 0) return null;
  return (
    <div className="nx-vars-editor__contrast" role="group" aria-label="Contrast">
      <span className="nx-vars-editor__label">Contrast</span>
      {pairs.map(pair => (
        <ContrastPair
          key={pair.identity}
          name={pair.name}
          colour={token}
          other={pair.other}
          onTop={pair.role === "background"}
        />
      ))}
    </div>
  );
}

/** One partner's two lines: light, then dark. */
function ContrastPair({
  name,
  colour,
  other,
  onTop,
}: {
  name: string;
  colour: SiteToken;
  other: SiteToken;
  /** Whether the colour is drawn on the other, or the other on it. */
  onTop: boolean;
}): React.JSX.Element {
  const same =
    colour.values.dark === undefined && other.values.dark !== undefined;
  return (
    <div className="nx-vars-editor__contrast-pair" role="group" aria-label={name}>
      <span className="nx-vars-editor__contrast-name">{name}</span>
      {(["light", "dark"] as const).map(mode => {
        const mine = valueIn(colour, mode);
        const theirs = valueIn(other, mode);
        const line = onTop ? contrastLine(mine, theirs) : contrastLine(theirs, mine);
        return (
          <span
            key={mode}
            className="nx-vars-editor__contrast-line"
            data-mode={mode}
            data-band={line?.band}
          >
            <ModeIcon mode={mode} />
            <span className="nx-sr-only">{mode === "light" ? "Light: " : "Dark: "}</span>
            {line === undefined ? (
              "Can't be measured"
            ) : (
              <>
                <span className="nx-vars-editor__ratio">{line.ratio}</span>{" "}
                {line.band}
              </>
            )}
            {mode === "dark" && same ? (
              <span className="nx-vars-editor__same-dark"> · Same in dark mode</span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/** A variable's value in a mode, dark following light where it has none. */
function valueIn(token: SiteToken, mode: TokenMode): string {
  return mode === "dark"
    ? (token.values.dark ?? token.values.light)
    : token.values.light;
}

"use client";

/**
 * "Clean up unused…" on the Colours tab: every colour the site made that
 * nothing uses, listed ticked in a dialog, removed in one step.
 *
 * What is listed is the usage filter's own "unused" ({@link
 * cleanUpCandidates}), less the colours the open page uses, which may not be
 * saved yet. Built-in colours are never listed: they are never removed.
 *
 * The removal is the host's: it judges each colour again just before its
 * write, so one that became used since the list was read is kept and named
 * with where, and the rest go. The dialog then says what went and what
 * stayed; when all went, it closes.
 *
 * @module colour-cleanup
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import * as React from "react";

import { colourOrder } from "./colour-groups";
import { cleanUpCandidates } from "./colour-usage";
import { colourHexOf } from "./style-colour";
import type { VariableEntry, VariableGroup } from "./tokens-studio";
import { swatchStyle } from "./variable-swatch";
import { usageState } from "./variable-usage";
import type { VariableUsageHere } from "./variable-usage-view";

/**
 * One colour a clean-up kept, with why in words that name it and where it
 * is used.
 *
 * @experimental Settles with the Colours tab's clean-up.
 */
export interface ColourKept {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
}

/**
 * What a clean-up came to: the colours removed and the ones kept, by
 * identity; or why it could not be made at all.
 *
 * @experimental Settles with the Colours tab's clean-up.
 */
export type ColourCleanUpResult =
  | {
      readonly kind: "done";
      readonly removed: readonly string[];
      readonly kept: readonly ColourKept[];
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The host's clean-up: remove these colours, each judged on its own.
 *
 * @experimental Settles with the Colours tab's clean-up.
 */
export type CleanUpColours = (
  ids: readonly string[]
) => Promise<ColourCleanUpResult>;

/** "1 colour", "2 colours". */
function coloursWord(count: number): string {
  return `${count} ${count === 1 ? "colour" : "colours"}`;
}

/** One listed colour: its row, its identity and the swatch it shows. */
interface Listed {
  readonly identity: string;
  readonly label: string;
  readonly light: string | undefined;
}

/**
 * The Colours tab's clean-up control and its dialog. Nothing where the view
 * lists no colours, the author may not change Design, or the host cannot
 * clean up.
 */
export function ColourCleanUp({
  groups,
  readOnly,
  onCleanUp,
  ...reading
}: {
  groups: readonly {
    readonly group: VariableGroup;
    readonly entries: readonly VariableEntry[];
  }[];
  readOnly: boolean;
  onCleanUp: CleanUpColours | undefined;
} & Omit<CleanUpReading, "colours">): React.JSX.Element | null {
  const colours = groups.find(group => group.group === "colours");
  if (readOnly || onCleanUp === undefined || colours === undefined) {
    return null;
  }
  return (
    <CleanUpDialog
      reading={{ ...reading, colours: colours.entries }}
      onCleanUp={onCleanUp}
    />
  );
}

/** What the dialog reads its list from. */
interface CleanUpReading {
  readonly colours: readonly VariableEntry[];
  readonly tokens: SiteTokenSet;
  readonly usage: VariableUsageHere | undefined;
  readonly usedOnPage: ReadonlySet<string> | undefined;
  /** Whether a colour is built in: the site's code or the engine supplies it. */
  readonly builtIn: (identity: string) => boolean;
}

/** The colours listed, in the panel's order, and whether more may come. */
function listedOf(reading: CleanUpReading): {
  listed: Listed[];
  counting: boolean;
} {
  const byIdentity = new Map(
    reading.colours.map(entry => [entry.row.identity, entry])
  );
  const ordered = colourOrder(reading.tokens).flatMap(identity => {
    const entry = byIdentity.get(identity);
    if (entry === undefined) return [];
    const token = reading.tokens.tokens[entry.row.at];
    return [
      {
        identity,
        label: entry.label,
        light:
          token === undefined
            ? undefined
            : colourHexOf(token.values.light, undefined),
      },
    ];
  });
  return cleanUpCandidates(ordered, {
    stateOf: identity => usageState(reading.usage?.reachOf(identity)),
    builtIn: reading.builtIn,
    onPage: reading.usedOnPage,
  });
}

/** What the dialog shows once a clean-up kept some colours. */
interface Settled {
  readonly removed: number;
  readonly kept: readonly ColourKept[];
}

function CleanUpDialog({
  reading,
  onCleanUp,
}: {
  reading: CleanUpReading;
  onCleanUp: CleanUpColours;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  // Unticked rather than ticked, so a colour listed once its count arrives
  // is ticked as the rest are.
  const [unticked, setUnticked] = React.useState<ReadonlySet<string>>(
    new Set()
  );
  const [busy, setBusy] = React.useState(false);
  const [refusal, setRefusal] = React.useState<string | undefined>(undefined);
  const [settled, setSettled] = React.useState<Settled | undefined>(undefined);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const { listed, counting } = listedOf(reading);
  const chosen = listed
    .filter(colour => !unticked.has(colour.identity))
    .map(colour => colour.identity);

  const show = (next: boolean): void => {
    if (next) {
      setUnticked(new Set());
      setRefusal(undefined);
      setSettled(undefined);
    }
    setOpen(next);
  };
  const remove = async (): Promise<void> => {
    setBusy(true);
    setRefusal(undefined);
    const result = await onCleanUp(chosen);
    setBusy(false);
    if (result.kind === "refused") setRefusal(result.reason);
    else if (result.kept.length === 0) setOpen(false);
    else setSettled({ removed: result.removed.length, kept: result.kept });
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="nx-colour-cleanup__open"
        onClick={() => show(true)}
      >
        Clean up unused…
      </button>
      <Dialog open={open} onOpenChange={show}>
        <DialogContent
          className="max-w-sm"
          data-colour-cleanup=""
          // Back to the control that opened it, which a click does not
          // always focus first.
          onCloseAutoFocus={event => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Clean up unused colours</DialogTitle>
            <DialogDescription>
              Colours you made that nothing on the site uses. Untick any you
              want to keep.
            </DialogDescription>
          </DialogHeader>
          {settled === undefined ? (
            <CleanUpChoices
              listed={listed}
              counting={counting}
              unticked={unticked}
              onTick={(identity, ticked) =>
                setUnticked(current => toggled(current, identity, !ticked))
              }
              refusal={refusal}
            />
          ) : (
            <CleanUpSettled settled={settled} />
          )}
          <DialogFooter>
            {settled === undefined ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => show(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy || chosen.length === 0}
                  aria-busy={busy || undefined}
                  onClick={() => void remove()}
                >
                  {`Remove ${coloursWord(chosen.length)}`}
                </Button>
              </>
            ) : (
              <Button type="button" onClick={() => show(false)}>
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A set with one identity added or taken out. */
function toggled(
  set: ReadonlySet<string>,
  identity: string,
  present: boolean
): ReadonlySet<string> {
  const next = new Set(set);
  if (present) next.add(identity);
  else next.delete(identity);
  return next;
}

/** The colours to remove, each ticked, and what the dialog has to say. */
function CleanUpChoices({
  listed,
  counting,
  unticked,
  onTick,
  refusal,
}: {
  listed: readonly Listed[];
  counting: boolean;
  unticked: ReadonlySet<string>;
  onTick: (identity: string, ticked: boolean) => void;
  refusal: string | undefined;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <div className="nx-colour-cleanup">
      {counting ? (
        <p className="nx-colour-cleanup__note" role="status">
          Counting usage…
        </p>
      ) : null}
      {listed.length === 0 && !counting ? (
        <p className="nx-colour-cleanup__note">
          Every colour you made is in use.
        </p>
      ) : null}
      {listed.length === 0 ? null : (
        <ul className="nx-colour-cleanup__list">
          {listed.map(colour => (
            <li key={colour.identity} className="nx-colour-cleanup__row">
              <Checkbox
                id={`${id}-${colour.identity}`}
                aria-label={colour.label}
                checked={!unticked.has(colour.identity)}
                onCheckedChange={checked =>
                  onTick(colour.identity, checked === true)
                }
              />
              <span
                className="nx-vars__swatch nx-vars__swatch--main"
                aria-hidden="true"
                style={swatchStyle(colour.light)}
              />
              <label
                className="nx-colour-cleanup__name"
                htmlFor={`${id}-${colour.identity}`}
                title={colour.label}
              >
                {colour.label}
              </label>
            </li>
          ))}
        </ul>
      )}
      {refusal === undefined ? null : (
        <p className="nx-colour-cleanup__alert" role="alert">
          {refusal}
        </p>
      )}
    </div>
  );
}

/** What a clean-up that kept some colours did: what went, and what stayed. */
function CleanUpSettled({ settled }: { settled: Settled }): React.JSX.Element {
  const one = settled.kept.length === 1;
  return (
    <div className="nx-colour-cleanup" role="status">
      <p className="nx-colour-cleanup__note">
        {settled.removed === 0
          ? "No colour was removed."
          : `Removed ${coloursWord(settled.removed)}.`}
      </p>
      <p className="nx-colour-cleanup__note">
        {one ? "Kept, as it's in use now:" : "Kept, as they're in use now:"}
      </p>
      <ul className="nx-colour-cleanup__list">
        {settled.kept.map(kept => (
          <li key={kept.id} className="nx-colour-cleanup__kept">
            {kept.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * How widely a variable is used, as the Variables tab draws it: the reads
 * behind every row's count, the count itself, and the box Remove opens in a
 * variable's editor while it cannot be removed.
 *
 * The rules are {@link variable-usage}'s; the reads are the Design panel's
 * one usage machine ({@link usage-reads}), as the Shared styles tab reads
 * its counts.
 *
 * @module variable-usage-view
 */
import type { NamedClass, TokenKind } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import * as React from "react";

import { ChromeTooltip } from "./chrome-tooltip";
import { VARIABLE_LOSS_WORDS } from "./editor-words";
import { UsesTail, UsesUnread } from "./shared-style-details";
import { sharedStyleKindName } from "./shared-style-library";
import {
  CountedByJobs,
  countNowWords,
  useUsageReads,
  type CountNow,
  type UsageRead,
  type UsageReads,
  type UsageSource,
} from "./usage-reads";
import { useUses } from "./uses-read";
import {
  sharedStyleSets,
  variableCount,
  variableLossSentence,
  variableRemoval,
  type VariableReach,
  type VariablesAccess,
  type VariablesUsage,
  type VariableUse,
} from "./variable-usage";

/** A variables usage read, in the shape the usage reads take. */
type VariablesRead = UsageRead<VariableReach> & VariablesUsage;

/** The host's access as a usage source: each read's variables are its values. */
function variablesSource(
  access: VariablesAccess
): UsageSource<VariableReach, VariablesRead> {
  return {
    usage: async (ids, signal) => {
      const read = await access.usage(ids, signal);
      return { ...read, values: read.variables };
    },
    ...(access.count === undefined ? {} : { count: access.count }),
  };
}

/**
 * How widely the listed variables are used, by identity, read as the Shared
 * styles tab reads its styles'. None read without `access`.
 */
export function useVariableUsage(
  access: VariablesAccess | undefined,
  identities: readonly string[]
): UsageReads<VariableReach, VariablesRead> {
  const source = React.useMemo(
    () => (access === undefined ? undefined : variablesSource(access)),
    [access]
  );
  return useUsageReads(source, identities);
}

/** What a variable's row and editor know of its usage. */
export interface VariableUsageHere {
  /** Its usage, once read. */
  readonly reach: VariableReach | undefined;
  readonly access: VariablesAccess;
  /** Counting the pages now, when this author may and the host can. */
  readonly counter: CountNow | undefined;
  /** The site's shared styles, so one using it says what it sets. */
  readonly classes: readonly NamedClass[] | undefined;
}

/**
 * The count at the end of a variable's row: a bare number of places, muted
 * when nothing uses it, "2+" while it is a floor; nothing until it is read.
 * Said in words by the row's tooltip ({@link CountTip}), and by the row's own
 * name to a screen reader.
 */
export function VariableRowCount({
  reach,
}: {
  reach: VariableReach | undefined;
}): React.JSX.Element | null {
  if (reach === undefined) return null;
  const count = variableCount(reach);
  return (
    <span
      className="nx-vars__count"
      aria-hidden="true"
      data-zero={count.zero ? "" : undefined}
      data-floor={count.floor ? "" : undefined}
    >
      {count.text}
    </span>
  );
}

/**
 * The row's count in words, as the editor's tooltip: shown when the row is
 * pointed at or takes focus, so keyboard and touch users meet it too, not a
 * title on the hidden count. Above the row and at its end, over the count.
 * The row alone until its usage is read.
 */
export function CountTip({
  reach,
  children,
}: {
  reach: VariableReach | undefined;
  children: React.ReactElement;
}): React.JSX.Element {
  if (reach === undefined) return children;
  return (
    <TooltipProvider delayDuration={300}>
      <ChromeTooltip
        side="top"
        align="end"
        content={variableCount(reach).words}
      >
        {children}
      </ChromeTooltip>
    </TooltipProvider>
  );
}

/** How many places the in-use box names before "Show all". */
const FIRST_USES = 5;

/**
 * Why Remove cannot go ahead, opened in place by Remove: the places using
 * the variable, or that some pages are not counted yet, and the way forward.
 * Focus moves to its heading, so the reason is what is read next.
 */
export function VariableRefusal({
  name,
  kind,
  identity,
  usage,
}: {
  /** The variable's name, as its editor shows it. */
  name: string;
  kind: TokenKind;
  identity: string;
  usage: VariableUsageHere & { readonly reach: VariableReach };
}): React.JSX.Element {
  const id = React.useId();
  const heading = React.useRef<HTMLHeadingElement>(null);
  const inUse = variableRemoval(usage.reach) === "in-use";
  // Again whenever what the box says changes: a count can turn "not counted
  // yet" into "in use", and the new reason is the one to read.
  React.useEffect(() => {
    heading.current?.focus();
  }, [inUse]);
  return (
    <section className="nx-vars-refusal" aria-labelledby={id}>
      <h4
        className="nx-vars-refusal__heading"
        id={id}
        ref={heading}
        tabIndex={-1}
      >
        {inUse
          ? `${name} can't be removed while it's in use.`
          : `${name} can't be removed yet.`}
      </h4>
      {inUse ? (
        <InUse
          name={name}
          loss={VARIABLE_LOSS_WORDS[kind]}
          identity={identity}
          usage={usage}
        />
      ) : (
        <NotCounted counter={usage.counter} />
      )}
    </section>
  );
}

/** The places using a variable, the first few and then all, and what to do. */
function InUse({
  name,
  loss,
  identity,
  usage,
}: {
  name: string;
  loss: string;
  identity: string;
  usage: VariableUsageHere & { readonly reach: VariableReach };
}): React.JSX.Element {
  const { read, more } = useUses(usage.access.uses, identity);
  const [all, setAll] = React.useState(false);
  const { last, items } = read;
  const listed = all ? items : items.slice(0, FIRST_USES);
  return (
    <>
      <p className="nx-vars-refusal__text">
        {variableLossSentence(usage.reach, loss)}
      </p>
      {last === undefined || read.failed ? (
        <UsesUnread read={read} />
      ) : (
        <>
          {listed.length === 0 ? null : (
            <ul className="nx-shared-styles__uses nx-vars-refusal__uses">
              {listed.map(use => (
                // An id is unique only within its collection, so both key a row.
                <li key={JSON.stringify([use.collection, use.id])}>
                  <UseRow use={use} identity={identity} usage={usage} />
                </li>
              ))}
            </ul>
          )}
          {!all && last.total > FIRST_USES ? (
            <button
              type="button"
              className="nx-vars__link"
              onClick={() => setAll(true)}
            >
              {`Show all ${String(last.total)}`}
            </button>
          ) : null}
          <UsesTail
            last={last}
            listed={items.length}
            {...(all ? { onMore: more } : {})}
          />
        </>
      )}
      <p className="nx-vars-refusal__text">
        {`Change those blocks and styles to another variable, or clear the value there, then remove ${name}.`}
      </p>
    </>
  );
}

/**
 * One place: a page or component as a link to it, "Homepage · page"; a
 * shared style as a way to it in Shared styles, with what it sets with the
 * variable, "Card · shared style · sets text colour"; a block type's default
 * style by name alone, "Button · block default style".
 */
function UseRow({
  use,
  identity,
  usage,
}: {
  use: VariableUse;
  identity: string;
  usage: VariableUsageHere;
}): React.JSX.Element {
  if (use.kind === "block-default") {
    // A block type's own default style: named, with nowhere to open.
    return (
      <>
        <span className="nx-shared-styles__use-title">{use.title}</span>
        <span className="nx-shared-styles__meta">
          {" · block default style"}
        </span>
      </>
    );
  }
  if (use.kind === "shared-style") {
    const open = usage.access.openSharedStyle;
    return (
      <>
        {open === undefined ? (
          <span className="nx-shared-styles__use-title">{use.title}</span>
        ) : (
          <button
            type="button"
            className="nx-vars__link nx-shared-styles__use-title"
            onClick={() => open(use.id)}
          >
            {use.title}
          </button>
        )}
        <span className="nx-shared-styles__meta">
          {` · shared style · ${sharedStyleSets(usage.classes, use.id, identity)}`}
        </span>
      </>
    );
  }
  return (
    <>
      {use.href === undefined ? (
        <span className="nx-shared-styles__use-title">{use.title}</span>
      ) : (
        // A new tab, so the page open here keeps its own undo history.
        <a
          className="nx-vars__link nx-shared-styles__use-title"
          href={use.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {use.title}
        </a>
      )}
      <span className="nx-shared-styles__meta">
        {` · ${sharedStyleKindName(use.kind).toLowerCase()}`}
      </span>
    </>
  );
}

/**
 * While some pages are not counted yet: that it may still be in use, and
 * Count now where the author may and the host can, else who counts them.
 */
function NotCounted({
  counter,
}: {
  counter: CountNow | undefined;
}): React.JSX.Element {
  return (
    <>
      <p className="nx-vars-refusal__text">
        Some pages haven&rsquo;t been counted, so it may still be in use.
      </p>
      {counter === undefined ? (
        <CountedByJobs />
      ) : (
        <>
          {/* None once a count said another cannot get further. */}
          {counter.final ? null : (
            <p className="nx-vars__note">
              <button
                type="button"
                className="nx-vars__link"
                disabled={counter.busy}
                onClick={counter.run}
              >
                {countNowWords(counter)}
              </button>
              {" · usually a few seconds"}
            </p>
          )}
          {/* What the last count found, said as it changes. */}
          <p className="nx-vars__note nx-vars-refusal__said" role="status">
            {counter.said ?? ""}
          </p>
        </>
      )}
    </>
  );
}

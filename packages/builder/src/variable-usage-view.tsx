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
import type { NamedClass } from "@nextlyhq/blocks-engine";
import { TooltipProvider } from "@nextlyhq/ui";
import * as React from "react";

import { ChromeTooltip } from "./chrome-tooltip";
import { blockLabel } from "./inserter";
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
import { useUses, type UsesRead } from "./uses-read";
import {
  sharedStyleSets,
  variableCount,
  variableLossSentence,
  variableRemoval,
  type VariableReach,
  type VariablesAccess,
  type VariablesUsage,
  type VariableUse,
  type VariableUsesPage,
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

/** What a variable's row and editor know of usage. */
export interface VariableUsageHere {
  /** A variable's usage by identity, once read. */
  readonly reachOf: (identity: string) => VariableReach | undefined;
  /** Read these variables' usage again, settling once it is kept. */
  readonly readAgain: (identities: readonly string[]) => Promise<void>;
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

/** One variable a removal takes away: its identity, and its name in a list. */
export interface RemovedPart {
  readonly identity: string;
  /** What the part is called beside another: "size", "line height". */
  readonly name: string;
}

/**
 * Why Remove cannot go ahead, opened in place by Remove: the places using
 * what it would take away, or that some pages are not counted yet, and the
 * way forward. Focus moves to its heading, so the reason is what is read
 * next.
 */
export function VariableRefusal({
  name,
  loss,
  parts,
  reach,
  usage,
}: {
  /**
   * What Remove takes away, named: the variable, or the half of a type size
   * that goes ("Body's line height").
   */
  name: string;
  /** What the places would lose, in words: "colour", "line height". */
  loss: string;
  /** What Remove takes away: the variable, or a type size and its line height. */
  parts: readonly RemovedPart[];
  /** Their usage together. */
  reach: VariableReach;
  usage: VariableUsageHere;
}): React.JSX.Element {
  const id = React.useId();
  const heading = React.useRef<HTMLHeadingElement>(null);
  const inUse = variableRemoval(reach) === "in-use";
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
          loss={loss}
          parts={parts}
          reach={reach}
          usage={usage}
        />
      ) : (
        <NotCounted counter={usage.counter} />
      )}
    </section>
  );
}

/**
 * The places using what Remove would take away, a list for each part in
 * use, each named when there are two, and what to do.
 */
function InUse({
  name,
  loss,
  parts,
  reach,
  usage,
}: {
  name: string;
  loss: string;
  parts: readonly RemovedPart[];
  reach: VariableReach;
  usage: VariableUsageHere;
}): React.JSX.Element {
  // Only the parts something uses have places to list.
  const used = parts.filter(
    part => variableRemoval(usage.reachOf(part.identity)) === "in-use"
  );
  return (
    <>
      <p className="nx-vars-refusal__text">
        {variableLossSentence(reach, loss)}
      </p>
      {used.map(part => (
        <PartUses
          key={part.identity}
          identity={part.identity}
          heading={used.length > 1 ? part.name : undefined}
          usage={usage}
        />
      ))}
      <p className="nx-vars-refusal__text">
        {`Change those blocks and styles to another variable, or clear the value there, then remove ${name}.`}
      </p>
    </>
  );
}

/**
 * The places one variable is used: the first few, then, on "Show all", every
 * page the route lists, read one after another with the progress said.
 */
function PartUses({
  identity,
  heading,
  usage,
}: {
  identity: string;
  /** Said above the list when another part's list is beside it. */
  heading: string | undefined;
  usage: VariableUsageHere;
}): React.JSX.Element {
  const { read, all, showAll, reading } = useAllUses(usage.access, identity);
  const { last, items } = read;
  return (
    <>
      {heading === undefined ? null : (
        <p className="nx-vars-refusal__part">{capitalised(heading)}</p>
      )}
      {last === undefined || read.failed ? (
        <UsesUnread read={read} />
      ) : (
        <>
          <PlaceList
            uses={all ? items : items.slice(0, FIRST_USES)}
            identity={identity}
            usage={usage}
          />
          {!all && last.total > FIRST_USES ? (
            <button type="button" className="nx-vars__link" onClick={showAll}>
              {`Show all ${String(last.total)}`}
            </button>
          ) : null}
          <AllRead
            reading={reading}
            listed={items.length}
            total={last.total}
            done={all && !reading}
          />
          <UsesTail last={last} listed={items.length} />
        </>
      )}
    </>
  );
}

/** "Line height" from "line height". */
function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The places one variable is used, read a page at a time; once all are
 * asked for, every page that follows is read in turn, each once the one
 * before has arrived, until the route says none follows.
 */
function useAllUses(
  access: VariablesAccess,
  identity: string
): {
  read: UsesRead<VariableUsesPage>;
  all: boolean;
  showAll: () => void;
  /** Whether pages are still being read for "Show all". */
  reading: boolean;
} {
  const { read, more } = useUses(access.uses, identity);
  const [all, setAll] = React.useState(false);
  const reading =
    all && !read.failed && read.last !== undefined && read.last.hasNext;
  const arrived = read.loaded === read.page;
  React.useEffect(() => {
    if (reading && arrived) more();
  }, [reading, arrived, more]);
  return { read, all, showAll: () => setAll(true), reading };
}

/**
 * While "Show all" reads the pages that follow, how far it has got; once it
 * is done, the places the route would not list, past the most it names.
 */
function AllRead({
  reading,
  listed,
  total,
  done,
}: {
  reading: boolean;
  listed: number;
  total: number;
  done: boolean;
}): React.JSX.Element | null {
  if (reading) {
    return (
      <p className="nx-shared-styles__meta" role="status">
        {`Reading ${String(listed)} of ${String(total)}…`}
      </p>
    );
  }
  if (done && total > listed) {
    return (
      <p className="nx-shared-styles__meta">
        {`and ${String(total - listed)} more not listed`}
      </p>
    );
  }
  return null;
}

/** The places, each on its own line. */
function PlaceList({
  uses,
  identity,
  usage,
}: {
  uses: readonly VariableUse[];
  identity: string;
  usage: VariableUsageHere;
}): React.JSX.Element | null {
  if (uses.length === 0) return null;
  return (
    <ul className="nx-shared-styles__uses nx-vars-refusal__uses">
      {uses.map(use => (
        // An id is unique only within its collection, so both key a row.
        <li key={JSON.stringify([use.collection, use.id])}>
          <UseRow use={use} identity={identity} usage={usage} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One place: a page or component as a link to it, "Homepage · page"; a
 * shared style as a way to it in Shared styles, with what it sets with the
 * variable, "Card · shared style · sets text colour"; a block look as a way
 * to it in the inspector, "Primary · Button look · sets text colour"; a
 * block type's default style by name alone, "Button · block default style".
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
      <Place name={<Named title={use.title} />} chip="block default style" />
    );
  }
  if (use.kind === "shared-style") {
    return <StyleRow use={use} identity={identity} usage={usage} />;
  }
  return (
    <Place
      name={
        use.href === undefined ? (
          <Named title={use.title} />
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
        )
      }
      detail={sharedStyleKindName(use.kind).toLowerCase()}
    />
  );
}

/**
 * A shared style using the variable, or a block look, which is a shared
 * style bound to one block type: the Shared styles tab lists no looks, so a
 * look opens in the inspector's look editor. Each is plain text where the
 * host offers no way to open it.
 */
function StyleRow({
  use,
  identity,
  usage,
}: {
  use: VariableUse;
  identity: string;
  usage: VariableUsageHere;
}): React.JSX.Element {
  // A look is named by its id and its block type together, as the route
  // names it: two types' own looks may share an id.
  const { blockType } = use;
  const sets = sharedStyleSets(usage.classes, use.id, identity, blockType);
  if (blockType !== undefined) {
    const { openLook } = usage.access;
    return (
      <Place
        name={
          <Opens
            title={use.title}
            open={
              openLook === undefined
                ? undefined
                : () => openLook({ id: use.id, blockType })
            }
          />
        }
        chip={`${blockLabel(blockType)} look`}
        detail={sets}
      />
    );
  }
  const { openSharedStyle } = usage.access;
  return (
    <Place
      name={
        <Opens
          title={use.title}
          open={
            openSharedStyle === undefined
              ? undefined
              : () => openSharedStyle(use.id)
          }
        />
      }
      chip="shared style"
      detail={sets}
    />
  );
}

/** A place's name: a button where it can be opened, else its name alone. */
function Opens({
  title,
  open,
}: {
  title: string;
  open: (() => void) | undefined;
}): React.JSX.Element {
  if (open === undefined) return <Named title={title} />;
  return (
    <button
      type="button"
      className="nx-vars__link nx-shared-styles__use-title"
      onClick={open}
    >
      {title}
    </button>
  );
}

/** A place's name where there is nowhere to open it. */
function Named({ title }: { title: string }): React.JSX.Element {
  return <span className="nx-shared-styles__use-title">{title}</span>;
}

/**
 * One place's line: its name and what kind of place it is beside it, what
 * it does with the variable at the end. Read as one phrase, "Card · shared
 * style · sets text colour": the dots are said, not drawn.
 */
function Place({
  name,
  chip,
  detail,
}: {
  name: React.ReactNode;
  /** What kind of place it is, drawn as a small label beside the name. */
  chip?: string;
  /** What it is, or what it does with the variable, at the line's end. */
  detail?: string;
}): React.JSX.Element {
  return (
    <>
      <span className="nx-vars-refusal__place">
        {name}
        {chip === undefined ? null : (
          <>
            <span className="nx-sr-only"> · </span>
            <span className="nx-vars-refusal__kind">{chip}</span>
          </>
        )}
      </span>
      {detail === undefined ? null : (
        <>
          <span className="nx-sr-only"> · </span>
          <span className="nx-shared-styles__meta">{detail}</span>
        </>
      )}
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

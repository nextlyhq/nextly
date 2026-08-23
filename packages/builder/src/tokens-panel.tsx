/**
 * The tokens studio: the site's design tokens, and the edits an author makes.
 *
 * A panel over {@link tokens-studio}, which holds every rule this draws. The
 * split is the same one the style inspector uses: the projection decides what a
 * token IS and what an edit produces, this decides what it looks like, and the
 * rules stay testable without a DOM.
 *
 * ## The table is the editor
 *
 * Values are edited where they are read, rather than behind a detail form.
 * Figma's variables table and Tokens Studio both work this way, and the reason
 * is the shape of the work: the common edit is nudging one value, and a form
 * turns that into two clicks and a context switch. It also suits the rail,
 * which is narrow enough that a form would compete with the list it came from.
 *
 * ## Edits are lifted, not saved here
 *
 * Every control reports a NEW token set to the host and stores nothing. Saving
 * belongs to whoever owns the document — in the page builder that is the
 * section-scoped site-style write, which this package cannot reach and should
 * not — so this stays a controlled surface with no opinion about persistence.
 *
 * ## A colour value is typed, not picked, in this release
 *
 * Deliberate, and it is not a gap in the design. `@nextlyhq/ui`'s ColorPicker
 * holds unparseable hex in a private draft that is reset by `onBlur`, and a
 * dismissal is not a blur — so leaving it mid-edit commits the last value it
 * published rather than the one on screen. On a block that costs one
 * declaration. On a TOKEN it would silently change a value the whole site
 * resolves. The swatch here therefore previews and does not open, until that
 * contract is fixed.
 *
 * @module tokens-panel
 */
import {
  TOKEN_KINDS,
  tokenIdentity,
  type SiteToken,
  type SiteTokenSet,
  type TokenKind,
  type TokenMode,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@nextlyhq/ui";
import * as React from "react";

import { colourHexOf } from "./style-colour";
import {
  TOKEN_KIND_LABELS,
  addToken,
  clearDarkValue,
  removeToken,
  renameToken,
  setTokenValue,
  tokenCounts,
  tokenNameIssue,
  tokenRowsFor,
  type TokenRow,
} from "./tokens-studio";
import {
  exportCss,
  exportDtcg,
  importDtcg,
  type ExportResult,
} from "./tokens-transfer";

export interface TokensPanelProps {
  /**
   * The site's tokens, or `undefined` while the host has not read them yet.
   *
   * A real third state rather than an empty table: a site that has stored
   * nothing legitimately has no tokens, so a panel that drew the two the same
   * way would invite an author to add a token into a set that is about to be
   * replaced by the one still loading.
   */
  tokens: SiteTokenSet | undefined;
  /** An edit. The host owns the document and decides when to persist. */
  onChange: (tokens: SiteTokenSet) => void;
  /**
   * The tokens something ELSE supplies, which the stored ones layer over.
   *
   * Needed because these two are not equally editable. A supplied token can be
   * overridden and reset, and cannot be removed: absence from the stored tier
   * means "no override", so a removal would merge straight back on the next
   * read. Offering a Remove that quietly undoes itself is worse than not
   * offering one.
   *
   * Two sources arrive as one set — the site's own config, and the ENGINE's
   * defaults that `resolveSiteTokens` layers under everything. They behave
   * identically here, so the row says "Default" rather than naming a source
   * this panel cannot tell apart.
   */
  supplied?: SiteTokenSet;
  /** What the last save said, when it failed. Nothing while it is succeeding. */
  issue?: string;
  /** Whether the canvas is currently showing dark values. */
  prefersDark?: boolean;
  /**
   * Why there are no tokens to show, when there are none.
   *
   * `undefined` tokens has two causes and they need different words: a read
   * still in flight will finish, and a refused or failed one will not. Told
   * apart because a panel that says "reading…" forever after a 403 describes a
   * state the site is not in and gives the author nothing to do about it.
   */
  absence?: "pending" | "failed";
}

/**
 * The studio.
 *
 * `tokens === undefined` draws a note rather than an empty table, and rather
 * than a spinner: the read is usually instant and a flash of one reads as a
 * fault. An author who arrives before it lands sees a sentence.
 */
export function TokensPanel({
  tokens,
  onChange,
  supplied,
  issue,
  absence = "pending",
  prefersDark = false,
}: TokensPanelProps): React.JSX.Element {
  const [mode, setMode] = React.useState<TokenMode>(
    prefersDark ? "dark" : "light"
  );
  const counts = tokenCounts(tokens);

  if (tokens === undefined) {
    return (
      <div
        className="nx-tokens"
        data-empty={absence === "failed" ? "failed" : "loading"}
      >
        <p
          className="nx-inspector__note"
          role={absence === "failed" ? "alert" : undefined}
        >
          {absence === "failed"
            ? "This site\u2019s tokens could not be read, so none can be shown or changed. Reload to try again."
            : "Reading this site\u2019s tokens\u2026"}
        </p>
      </div>
    );
  }

  return (
    <div className="nx-tokens">
      <div className="nx-tokens__head">
        <h2 className="nx-tokens__title">Tokens</h2>
        <ModeSwitch mode={mode} onMode={setMode} />
      </div>
      <TokenTransfer tokens={tokens} onChange={onChange} />
      {issue === undefined ? null : (
        /*
         * A save that did not happen. `role="alert"` because it reports on an
         * action the author has already taken and believes is done — the table
         * still shows what they typed, and without this the only signal that
         * the site was never changed is the canvas failing to move.
         */
        <p className="nx-tokens__issue" role="alert">
          {issue}
        </p>
      )}
      <Tabs defaultValue="color" className="nx-tokens__tabs">
        <TabsList>
          {TOKEN_KINDS.map(kind => (
            <TabsTrigger key={kind} value={kind}>
              {TOKEN_KIND_LABELS[kind]}
              {counts[kind] > 0 ? (
                <span className="nx-tokens__count">{counts[kind]}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {TOKEN_KINDS.map(kind => (
          <TabsContent key={kind} value={kind}>
            <TokenList
              kind={kind}
              tokens={tokens}
              supplied={supplied}
              mode={mode}
              onChange={onChange}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/**
 * Bringing a token file in, and taking one out.
 *
 * ## In: a file, not a paste
 *
 * A design-token document is something a TOOL produced — Figma, Style
 * Dictionary — and lives on disk as a file. Asking for a paste would make the
 * author open it, select it and copy it first, for no gain. The one other
 * import in this product takes a paste, and rightly: it imports a list of
 * options somebody may have in a spreadsheet or an email, which is a different
 * artefact.
 *
 * ## Out: two files, because two audiences read them
 *
 * The token document goes back to a design tool and round-trips exactly. The
 * CSS is what a visitor's stylesheet contains, for someone wiring these values
 * into something this system does not render — and it is compiled by the same
 * function the site sheet is, so it cannot describe a site that does not exist.
 *
 * ## The report is not chrome
 *
 * Both directions can carry less than they were given, and both say what they
 * left behind. That report IS the feature: a designer handed a file with three
 * tokens missing has no way to know otherwise, and the ones that go missing are
 * the interesting ones. So it is shown until dismissed rather than flashed.
 */
function TokenTransfer({
  tokens,
  onChange,
}: {
  tokens: SiteTokenSet;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const id = React.useId();
  const [report, setReport] = React.useState<{
    tone: "done" | "refused";
    headline: string;
    detail: readonly string[];
  } | null>(null);

  /*
   * The set as it is NOW, read after the file comes back rather than captured
   * before it goes out.
   *
   * Reading a file is asynchronous, and an author can edit a token while it is
   * in flight. Merging into the set this render closed over would then discard
   * that edit and persist the stale result — an edit made, seen, and silently
   * undone by an import that was already running. A ref rather than a
   * dependency because the read must see the latest value, not the value the
   * callback was created with.
   */
  const current = React.useRef(tokens);
  // Assigned during RENDER rather than from an effect. An effect runs after
  // commit, so a read resolving between the commit of an edit and the effect
  // that records it would still merge into the previous set — the window this
  // ref exists to close, left open by the mechanism meant to close it. A ref is
  // a mutable box rather than state, so writing the newest value this component
  // has been given is idempotent and observed by nothing.
  current.current = tokens;

  /*
   * Which read is the current one.
   *
   * Two files can be in flight at once — an author picks one, then picks
   * another before the first answers — and their answers need not arrive in
   * order. Without this, a slow rejection lands after a fast success and
   * reports failure for an import that was applied and persisted. Same rule the
   * save path follows: an answer for a superseded operation says nothing.
   */
  const reads = React.useRef(0);
  /*
   * A read in flight when the panel goes away must not land.
   *
   * The shell renders one left panel at a time and keys them, so switching to
   * Layers while a large file is being read unmounts this — and the
   * continuation would still call `onChange`, changing the site AFTER the
   * author left the tool, with the report it produced discarded. The same
   * invalidation also stops a read from a previous mount racing one started
   * after the panel is reopened.
   *
   * Marked rather than cancelled: a `File` read cannot be aborted, so what is
   * available is refusing to act on its answer.
   *
   * LAYOUT-timed, for the same reason the latest-set ref is assigned in render.
   * A passive cleanup runs after the unmount commit, so a read settling in that
   * gap passes the sequence guard and calls back into a panel that is already
   * gone — the window this cleanup exists to close, left open by the mechanism
   * meant to close it. A layout cleanup is synchronous with the unmount.
   */
  React.useLayoutEffect(
    () => () => {
      reads.current = -1;
    },
    []
  );

  const read = async (file: File): Promise<void> => {
    const mine = reads.current + 1;
    reads.current = mine;
    let text: string;
    try {
      text = await file.text();
    } catch {
      if (mine !== reads.current) return;
      /*
       * The file could not be READ at all — removed between choosing and
       * opening, a permission refusal, a failing disk. Distinct from a file
       * that read fine and held nothing usable, and reported rather than
       * swallowed: without this the promise rejects into the `void` at the
       * call site and the import does nothing while saying nothing.
       */
      setReport({
        tone: "refused",
        headline:
          "That file could not be read. It may have been moved or renamed since you chose it.",
        detail: [],
      });
      return;
    }
    if (mine !== reads.current) return;
    const result = importDtcg(text, current.current);
    if (!result.ok) {
      setReport({
        tone: "refused",
        headline: result.error,
        detail: result.skipped,
      });
      return;
    }
    setReport({
      tone: "done",
      headline: `Imported ${String(result.imported)} ${
        result.imported === 1 ? "token" : "tokens"
      }.`,
      detail: result.skipped,
    });
    onChange(result.tokens);
  };

  const send = (made: ExportResult): void => {
    // Nothing to download is not a file worth handing over. An empty artefact
    // means the export could not be written, and the reason is in its report.
    if (made.text !== "") download(made);
    /*
     * A clean export says nothing and CLEARS nothing. Exporting is the common
     * next step after an import, and the import's report is the only list
     * naming what the source file could not carry — wiping it because a later
     * action had no news of its own destroys the one thing the author still
     * needed, and does it without them dismissing anything.
     *
     * The file arriving is the confirmation that an export worked. A report is
     * for what the author could not otherwise see.
     */
    if (made.skipped.length === 0) return;
    setReport({
      tone: "done",
      headline: `Saved ${made.filename}.`,
      detail: made.skipped,
    });
  };

  return (
    <div className="nx-tokens__transfer">
      <label className="nx-tokens__import" htmlFor={`${id}-file`}>
        Import
        {/*
          The input is the control; the label is what is seen. A button that
          forwards a click to a hidden input is a second mechanism for one
          affordance, and the one that breaks first is the keyboard.
        */}
        <input
          id={`${id}-file`}
          type="file"
          accept="application/json,.json,.tokens.json"
          onChange={event => {
            const file = event.target.files?.[0];
            // Cleared so choosing the SAME file twice fires again — after a
            // refusal an author edits the file and picks it back, and an input
            // holding the old value reports nothing.
            event.target.value = "";
            if (file !== undefined) void read(file);
          }}
        />
      </label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => send(exportDtcg(tokens))}
      >
        Export JSON
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => send(exportCss(tokens))}
      >
        Export CSS
      </Button>
      {report === null ? null : (
        <TransferReport report={report} onDismiss={() => setReport(null)} />
      )}
    </div>
  );
}

/** What an import or an export carried, and what it did not. */
function TransferReport({
  report,
  onDismiss,
}: {
  report: {
    tone: "done" | "refused";
    headline: string;
    detail: readonly string[];
  };
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div
      className="nx-tokens__report"
      data-tone={report.tone}
      role={report.tone === "refused" ? "alert" : "status"}
    >
      <p>{report.headline}</p>
      {report.detail.length === 0 ? null : (
        <ul>
          {report.detail.map(line => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

/**
 * Hand a generated file to the browser.
 *
 * An object URL rather than a data URL: a token document can run to tens of
 * kilobytes, and a data URL of that size is refused outright by some browsers
 * and truncated by others. Revoked immediately — the click has already happened
 * by the time the handler returns, and leaving it alive holds the whole file in
 * memory until the tab closes.
 */
function download(made: ExportResult): void {
  const url = URL.createObjectURL(new Blob([made.text], { type: made.mime }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = made.filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Which mode's values the table is editing.
 *
 * Two states of one property, so a segmented pair rather than two buttons that
 * happen to be adjacent — the same shape the style inspector's toggles take.
 * It sets what an EDIT writes, not merely what is shown, which is why it sits
 * above the tabs where it governs all of them rather than inside one.
 */
function ModeSwitch({
  mode,
  onMode,
}: {
  mode: TokenMode;
  onMode: (mode: TokenMode) => void;
}): React.JSX.Element {
  return (
    <div className="nx-tokens__modes" role="group" aria-label="Token mode">
      {(["light", "dark"] as const).map(candidate => (
        <button
          key={candidate}
          type="button"
          onClick={() => onMode(candidate)}
          aria-pressed={mode === candidate}
        >
          {candidate === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );
}

/** Every token of one kind, with the way to add another. */
function TokenList({
  kind,
  tokens,
  supplied,
  mode,
  onChange,
}: {
  kind: TokenKind;
  tokens: SiteTokenSet;
  supplied: SiteTokenSet | undefined;
  mode: TokenMode;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const rows = tokenRowsFor(tokens, kind, mode);
  return (
    <div className="nx-tokens__list">
      {rows.length === 0 ? (
        <p className="nx-inspector__note">
          No {TOKEN_KIND_LABELS[kind].toLowerCase()} tokens yet.
        </p>
      ) : (
        <ul>
          {rows.map(row => (
            <li key={row.key}>
              <TokenEntry
                row={row}
                tokens={tokens}
                from={suppliedTokenFor(supplied, row.identity)}
                mode={mode}
                onChange={onChange}
              />
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange(addToken(tokens, kind).tokens)}
      >
        Add {TOKEN_KIND_LABELS[kind].toLowerCase()} token
      </Button>
    </div>
  );
}

/**
 * One row: what it is called, what it holds, and how to remove it.
 *
 * Both fields commit on blur rather than on every keystroke. A token is read by
 * the whole site, so an edit per character would recompile the canvas for every
 * letter of a name — and it would put a half-typed name through the validator,
 * reporting a refusal about a value the author is still in the middle of.
 */
function TokenEntry({
  row,
  tokens,
  from,
  mode,
  onChange,
}: {
  row: TokenRow;
  tokens: SiteTokenSet;
  /** The site config's own version of this token, when it supplies one. */
  from: SiteToken | undefined;
  mode: TokenMode;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const id = React.useId();
  const [nameIssue, setNameIssue] = React.useState<string | null>(null);
  const noteId = `${id}-note`;

  const commitName = (next: string): void => {
    if (next.trim() === row.name) {
      setNameIssue(null);
      return;
    }
    const refusal = tokenNameIssue(tokens, row.at, next);
    setNameIssue(refusal ?? null);
    if (refusal === undefined) onChange(renameToken(tokens, row.at, next));
  };

  const said = [...(nameIssue === null ? [] : [nameIssue]), ...row.issues];

  return (
    <div className="nx-tokens__row">
      <Swatch kind={row.kind} value={row.value} />
      <div className="nx-tokens__fields">
        <label className="sr-only" htmlFor={`${id}-name`}>
          Name of {row.name}
        </label>
        <Input
          id={`${id}-name`}
          className="nx-tokens__name"
          defaultValue={row.name}
          // Keyed by identity so a rename does not remount the row, and a
          // reorder does not carry one row's draft into another's field.
          /*
           * The NAME as well as the row, because a refused save and Reset both
           * replace the token through props — and an uncontrolled input keeps
           * whatever the author typed, so the panel would go on showing an
           * override that storage and the canvas no longer hold. Typing does
           * not change props, so this is stable while the author is editing
           * and changes exactly when the value they are editing is replaced
           * underneath them.
           */
          key={`${row.key}-name-${row.name}`}
          aria-invalid={nameIssue === null ? undefined : true}
          aria-describedby={said.length > 0 ? noteId : undefined}
          onBlur={event => commitName(event.target.value)}
        />
        <label className="sr-only" htmlFor={`${id}-value`}>
          {mode === "dark" ? "Dark value" : "Value"} of {row.name}
        </label>
        <Input
          id={`${id}-value`}
          className="nx-tokens__value"
          defaultValue={row.value}
          key={`${row.key}-value-${mode}-${row.value}`}
          data-inherited={row.inherited ? "" : undefined}
          aria-describedby={said.length > 0 ? noteId : undefined}
          onBlur={event => {
            const next = event.target.value;
            /*
             * Compared against what this MODE actually holds, not against what
             * the row displays. In dark, a token with no dark value displays
             * the light one — so typing that same value is a real edit, the one
             * that PINS dark before light is changed later, and comparing
             * against the display would discard exactly it.
             */
            if (next !== row.stored) {
              onChange(setTokenValue(tokens, row.at, mode, next));
            }
          }}
        />
      </div>
      <TokenActions
        row={row}
        tokens={tokens}
        from={from}
        mode={mode}
        onChange={onChange}
      />
      {said.length > 0 ? (
        <p className="nx-tokens__issue" id={noteId} role="status">
          {said.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Removing a token, and dropping a dark value back to following light.
 *
 * Its own component because both are DESTRUCTIVE in a way the two fields above
 * are not — a field edit changes a value, and these two change what resolves
 * for pages nobody is looking at.
 */
function TokenActions({
  row,
  tokens,
  from,
  mode,
  onChange,
}: {
  row: TokenRow;
  tokens: SiteTokenSet;
  from: SiteToken | undefined;
  mode: TokenMode;
  onChange: (tokens: SiteTokenSet) => void;
}): React.JSX.Element {
  const [confirming, setConfirming] = React.useState(false);

  if (confirming) {
    return (
      <div className="nx-tokens__confirm" role="group">
        {/*
          Named rather than counted. Answering "how many pages use this" needs a
          search INSIDE a JSON column, which no dialect this ships on can do
          portably — so the warning says what removal MEANS rather than
          inventing a number it cannot stand behind.
        */}
        <p className="nx-tokens__issue">
          Any block using <strong>{row.name}</strong> loses that style. The page
          still renders.
        </p>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => onChange(removeToken(tokens, row.at))}
        >
          Remove
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setConfirming(false)}
        >
          Keep
        </Button>
      </div>
    );
  }

  return (
    <div className="nx-tokens__actions">
      {mode === "dark" && !row.inherited ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(clearDarkValue(tokens, row.at))}
        >
          Match light
        </Button>
      ) : null}
      {from === undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Remove ${row.name}`}
          onClick={() => setConfirming(true)}
        >
          Remove
        </Button>
      ) : (
        /*
         * A token the site's code supplies. It cannot be REMOVED here: the
         * stored tier expresses overrides, and absence from it means "no
         * override", so a removal would merge straight back on the next read.
         * Reset is the honest counterpart — it drops the override and lets the
         * site's own value through again, which is what an author actually
         * means by undoing their edit.
         */
        <>
          <span className="nx-tokens__origin">Default</span>
          {differs(row, from, mode) ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Reset ${row.name}`}
              onClick={() => onChange(resetToken(tokens, row.at, from))}
            >
              Reset
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Whether the author has changed this token away from the site's own value. */
function differs(row: TokenRow, from: SiteToken, mode: TokenMode): boolean {
  return (
    row.name !== from.name ||
    row.value !== (from.values[mode] ?? from.values.light)
  );
}

/** The site's own token back in place of the author's override. */
function resetToken(
  tokens: SiteTokenSet,
  at: number,
  from: SiteToken
): SiteTokenSet {
  const next = [...tokens.tokens];
  next[at] = from;
  return { ...tokens, tokens: next };
}

/** The site config's own version of a token, matched the way the merge does. */
function suppliedTokenFor(
  supplied: SiteTokenSet | undefined,
  identity: string
): SiteToken | undefined {
  return (supplied?.tokens ?? []).find(
    token => tokenIdentity(token) === identity
  );
}

/**
 * A preview of what the value is, where one can be drawn honestly.
 *
 * Only a colour gets painted, and only when this package can resolve it
 * WITHOUT the site's table — a token whose value is a `var()` would otherwise
 * resolve against the panel's own custom properties rather than the canvas's
 * and show a colour the page does not have. Every other kind gets nothing
 * rather than an approximation of itself.
 */
function Swatch({
  kind,
  value,
}: {
  kind: TokenKind;
  value: string;
}): React.JSX.Element {
  const hex = kind === "color" ? colourHexOf(value, undefined) : undefined;
  return (
    <span
      className="nx-tokens__swatch"
      aria-hidden="true"
      data-empty={hex === undefined ? "" : undefined}
      style={
        hex === undefined
          ? undefined
          : ({ "--nx-swatch": hex } as React.CSSProperties)
      }
    />
  );
}

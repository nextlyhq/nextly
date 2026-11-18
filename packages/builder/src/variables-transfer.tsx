/**
 * The Design panel's ⋯ menu ("More design actions"): bringing variables in
 * from design-token files, taking them out, and copying them as CSS.
 *
 * The menu sits in the Design panel's header. Importing opens the system's
 * file chooser through a hidden file input, so the visible control is a menu
 * item like every other and the keyboard reaches it the same way. Nothing is
 * applied until the author has seen what the files would change and confirmed
 * it, settling each conflict as they go. A message about values an import
 * refused stays until the author dismisses it, since it names what did not
 * arrive.
 *
 * An import carries more than the variables: the file's text styles, its
 * Site text rows, colour order, fluid range and built-in colours setting,
 * each listed in the preview and stored through the host's own writers (the
 * text styles through its one class writer). The fonts the file uses that
 * the site has no file for are listed too, with "Add from Google Fonts" for
 * a font the catalogue has.
 *
 * Exports write files straight away: the design token file (with a theme file
 * beside it when there are dark values), or one file per mode for Figma. A
 * short toast says what was written; what the files did not carry is one
 * click away, in "What wasn't exported", rather than in a box that stays.
 * "Copy CSS variables" puts the site's variable blocks on the clipboard.
 *
 * @module variables-transfer
 */
import {
  resolveTokenPrefix,
  tokenDisplayLabel,
  type NamedClass,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
  TooltipProvider,
} from "@nextlyhq/ui";
import { Ellipsis } from "lucide-react";
import * as React from "react";

import type { EditClasses } from "./block-style-actions";
import { ChromeTooltip } from "./chrome-tooltip";
import { DESIGN_ACTION_WORDS as WORDS } from "./editor-words";
import type { FontCatalogue } from "./font-catalogue-view";
import { FontChoicesContext } from "./font-family-field";
import { sharedStyleName } from "./shared-style-library";
import {
  applyImport,
  exportDtcgWithTheme,
  exportForFigma,
  planImport,
  variableCss,
  type ConflictChoice,
  type ExportGap,
  type ExportResult,
  type ImportPlan,
} from "./tokens-transfer";
import { siteDataLines } from "./tokens-transfer-extras";
import { MissingFonts } from "./variables-transfer-fonts";

type ReadyPlan = Extract<ImportPlan, { ok: true }>;

/** One of the menu's exports: what it makes, and how its toast names it. */
interface ExportKind {
  make: (
    set: SiteTokenSet,
    classes: readonly NamedClass[]
  ) => readonly ExportResult[];
  /** The toast's opening words, before the files it names. */
  done: string;
  /** How the files' labels are joined in the toast. */
  join: string;
  /** Where the list of what was not exported says it comes from. */
  from: string;
}

const DTCG_EXPORT: ExportKind = {
  make: exportDtcgWithTheme,
  done: "Design tokens exported",
  // "variables, and dark values in a theme file": the second is a phrase
  // of its own, so a comma keeps the two apart.
  join: ", and ",
  from: "From the design token files. A value kept for Nextly only is in the file as Nextly data: Nextly reads it back, and other design tools skip it.",
};

const FIGMA_EXPORT: ExportKind = {
  make: exportForFigma,
  done: "Exported for Figma",
  join: " and ",
  from: "From the Figma files.",
};

/** What "What wasn't exported" lists, and which export it is about. */
interface NotExported {
  gaps: readonly ExportGap[];
  from: string;
}

/** How long an export's toast stays when it offers its list: time to reach it. */
const WITH_LIST_MS = 10_000;

export interface VariablesTransfer {
  /** The header's ⋯ menu, with its hidden file input. */
  menu: React.JSX.Element;
  /**
   * The import preview and the list of what an export left out. Both are
   * dialogs drawn over the editor, so where a host mounts this draws nothing.
   */
  overlays: React.JSX.Element;
}

/**
 * The transfer controls and their state.
 *
 * `currentTokens` is asked at the moment a set is needed rather than captured,
 * because reading files is asynchronous and an author can edit a variable
 * while it runs; merging into an earlier set would undo that edit.
 */
export function useVariablesTransfer({
  onChange,
  currentTokens,
  readOnly,
  currentClasses,
  onEditClasses,
  catalogue,
}: {
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  readOnly: boolean;
  /**
   * The site's classes as they are now, whose text styles an export writes
   * and an import is matched with. Absent: none are exported or imported.
   */
  currentClasses?: () => readonly NamedClass[] | undefined;
  /** The host's one class writer, which an import's text styles are stored through. */
  onEditClasses?: EditClasses;
  /** The Google Fonts catalogue, which a missing font is added from. */
  catalogue?: FontCatalogue;
}): VariablesTransfer {
  // The site's fonts, from the host's Design frame: a font the file names
  // and none of these provide is listed as missing.
  const fonts = React.useContext(FontChoicesContext);
  const [plan, setPlan] = React.useState<ReadyPlan | null>(null);
  const [notExported, setNotExported] = React.useState<NotExported | null>(
    null
  );
  const input = React.useRef<HTMLInputElement>(null);
  // Where focus goes back to when the list closes: the toast that opened it
  // has gone by then.
  const trigger = React.useRef<HTMLButtonElement>(null);
  const hint = React.useId();
  // The callbacks as they are now, published at commit, for reads that
  // outlive the render that started them.
  const latest = React.useRef({
    onChange,
    currentTokens,
    currentClasses,
    onEditClasses,
  });
  React.useLayoutEffect(() => {
    latest.current = { onChange, currentTokens, currentClasses, onEditClasses };
  });
  // Which read is the current one: a later choice supersedes an earlier read
  // still in flight, and a read finishing after the panel has gone is ignored.
  const reads = React.useRef(0);
  React.useLayoutEffect(
    () => () => {
      reads.current = -1;
    },
    []
  );
  // The toast whose button opens the list. The list is this panel's state,
  // so when the panel goes the toast goes with it: left behind, its button
  // would open nothing, then or after the panel comes back.
  const listed = React.useRef<string | number | null>(null);
  React.useEffect(
    () => () => {
      if (listed.current !== null) toast.dismiss(listed.current);
    },
    []
  );

  const refuse = (headline: string, detail: readonly string[] = []): void =>
    sayUntilDismissed("error", headline, detail);

  const read = async (files: readonly File[]): Promise<void> => {
    const mine = reads.current + 1;
    reads.current = mine;
    let texts: { name: string; text: string }[];
    try {
      texts = await Promise.all(
        files.map(async file => ({ name: file.name, text: await file.text() }))
      );
    } catch {
      if (mine === reads.current) {
        refuse(
          "Those files could not be read. They may have been moved or renamed since you chose them."
        );
      }
      return;
    }
    if (mine !== reads.current) return;
    const into = latest.current.currentTokens();
    if (into === undefined) {
      refuse("This site's variables are not loaded, so nothing was imported.");
      return;
    }
    // Text styles only where the host can store them, and fonts only where
    // it says which the site has.
    const writesClasses = latest.current.onEditClasses !== undefined;
    const planned = planImport(texts, into, {
      ...(writesClasses
        ? { textStyles: latest.current.currentClasses?.() ?? [] }
        : {}),
      ...(fonts?.faces === undefined
        ? {}
        : { faces: [...fonts.faces, ...fonts.fromCode] }),
    });
    if (!planned.ok) {
      refuse(planned.error, planned.skipped);
      return;
    }
    setPlan(planned);
  };

  const apply = (choices: ReadonlyMap<string, ConflictChoice>): void => {
    if (plan === null) return;
    setPlan(null);
    const into = latest.current.currentTokens();
    if (into === undefined) {
      refuse("This site's variables are not loaded, so nothing was imported.");
      return;
    }
    const result = applyImport(plan, into, choices);
    if (!result.ok) {
      refuse(result.error, result.skipped);
      return;
    }
    latest.current.onChange(result.tokens);
    const edit = latest.current.onEditClasses;
    if (result.classes !== undefined && edit !== undefined) {
      void edit(result.classes).then(refusal => {
        if (refusal !== undefined) {
          refuse("The text styles weren't imported.", [refusal]);
        }
      });
    }
    const imported = importedWords(result.imported, result.textStyles ?? 0);
    if (result.skipped.length === 0) {
      toast(imported);
      return;
    }
    // Refused in part: what did not arrive is named, and stays named until
    // the author has read it.
    const refused = result.skipped.length;
    sayUntilDismissed(
      "warning",
      `${imported} ${counted(refused, "value was", "values were")} refused:`,
      result.skipped
    );
  };

  const send = (kind: ExportKind): void => {
    const set = latest.current.currentTokens();
    if (set === undefined) {
      toast.error(
        "This site's variables are not loaded, so nothing was exported."
      );
      return;
    }
    const made = kind.make(set, latest.current.currentClasses?.() ?? []);
    const written = made.filter(file => file.text !== "");
    for (const file of written) download(file);
    const gaps = oncePerVariable(made.flatMap(file => file.gaps));
    const list =
      gaps.length === 0
        ? {}
        : {
            duration: WITH_LIST_MS,
            action: {
              label: WORDS.notExported,
              onClick: () => {
                // Focus back on the menu first. The toaster returns focus to
                // where it came from as focus leaves it, and would otherwise
                // do so after the list has taken it, out from under the list.
                trigger.current?.focus();
                setNotExported({ gaps, from: kind.from });
              },
            },
          };
    const shown =
      written.length === 0
        ? toast.error(
            set.tokens.length === 0
              ? "No file was written: this site has no variables to write."
              : "No file was written.",
            list
          )
        : // Each file named in words, so an author knows which file holds
          // what without opening it, and how many files to look for.
          toast(
            `${kind.done}: ${written.map(file => file.label).join(kind.join)} (${counted(
              written.length,
              "file",
              "files"
            )})`,
            list
          );
    listed.current = gaps.length === 0 ? null : shown;
  };

  const copy = (): void => {
    const set = latest.current.currentTokens();
    if (set === undefined) {
      toast.error(
        "This site's variables are not loaded, so nothing was copied."
      );
      return;
    }
    const { css, skipped } = variableCss(set);
    if (css === "") {
      toast.error("This site has no variables to copy.");
      return;
    }
    const named = `named ${resolveTokenPrefix(set.prefix).prefix}\u2026`;
    const said = set.tokens.some(token => token.values.dark !== undefined)
      ? `CSS variables copied: light and dark values, ${named}`
      : `CSS variables copied, ${named}`;
    const refused = (): void => {
      toast.error(
        "The CSS variables couldn't be copied: this browser didn't allow the copy."
      );
    };
    // The editor's own clipboard: a page may not be allowed to write to it.
    const clipboard: Clipboard | undefined =
      typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      refused();
      return;
    }
    void clipboard.writeText(css).then(() => {
      if (skipped.length === 0) {
        toast(said);
        return;
      }
      // Copied in part: what is missing is named, and stays named until the
      // author has read it, as an import refused in part is.
      sayUntilDismissed(
        "warning",
        `${said}. ${counted(skipped.length, "variable was", "variables were")} left out:`,
        skipped
      );
    }, refused);
  };

  const menu = (
    <>
      <TooltipProvider delayDuration={300}>
        {/* Not modal: it opens the file chooser and the import preview from
            inside, and a modal menu would hide the rest of the editor from
            assistive technology while leaving it focusable. */}
        <DropdownMenu modal={false}>
          {/* The tooltip is the button's only visible name, as on every icon
              button beside the canvas; no browser tooltip. */}
          <ChromeTooltip content={WORDS.more}>
            <DropdownMenuTrigger asChild>
              <button
                ref={trigger}
                type="button"
                className="nx-vars__icon-button"
                aria-label={WORDS.more}
              >
                <Ellipsis aria-hidden="true" size={16} />
              </button>
            </DropdownMenuTrigger>
          </ChromeTooltip>
          <DropdownMenuContent align="end" className="nx-vars__menu">
            {readOnly ? null : (
              <>
                <DropdownMenuItem onSelect={() => input.current?.click()}>
                  {WORDS.importTokens}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {/* The format is a hint, not part of the name: an author picks
                "design tokens", and the version is there for whoever needs
                it. */}
            <DropdownMenuItem
              aria-label={WORDS.exportTokens}
              aria-describedby={hint}
              className="nx-design-more__item"
              onSelect={() => send(DTCG_EXPORT)}
            >
              <span>{WORDS.exportTokens}</span>
              <span id={hint} className="nx-design-more__hint">
                {WORDS.exportTokensHint}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => send(FIGMA_EXPORT)}>
              {WORDS.exportFigma}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={copy}>{WORDS.copyCss}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TooltipProvider>
      {readOnly ? null : (
        <input
          ref={input}
          type="file"
          multiple
          className="nx-sr-only"
          // Opened only from the menu's "Import design tokens…", so it is
          // kept out of the tab order and out of the accessibility tree: one
          // way to import, not a second bare file control beside the menu.
          tabIndex={-1}
          aria-hidden="true"
          aria-label="Choose variable files to import"
          accept=".json,.tokens,.tokens.json,application/json"
          onChange={event => {
            const files = [...(event.target.files ?? [])];
            // Cleared so choosing the same files again fires again.
            event.target.value = "";
            if (files.length > 0) void read(files);
          }}
        />
      )}
    </>
  );

  const overlays = (
    <>
      {notExported === null ? null : (
        <NotExportedList
          list={notExported}
          onClose={() => setNotExported(null)}
          returnTo={trigger}
        />
      )}
      {plan === null ? null : (
        <ImportPreview
          plan={plan}
          onCancel={() => setPlan(null)}
          onApply={apply}
          {...(catalogue === undefined ? {} : { catalogue })}
        />
      )}
    </>
  );

  return { menu, overlays };
}

/**
 * What the chosen files would change, before anything does.
 *
 * Counts first, then the conflicts, each with its own choice, then what the
 * files hold that this site cannot (listed, not dropped silently).
 */
function ImportPreview({
  plan,
  onCancel,
  onApply,
  catalogue,
}: {
  plan: ReadyPlan;
  onCancel: () => void;
  onApply: (choices: ReadonlyMap<string, ConflictChoice>) => void;
  catalogue?: FontCatalogue;
}): React.JSX.Element {
  const [choices, setChoices] = React.useState<Map<string, ConflictChoice>>(
    () => new Map()
  );
  const styles = plan.extras.textStyles;
  const counts = [
    count(plan.added.length, "to add"),
    count(plan.changed.length, "to update"),
    count(plan.unchanged.length, "unchanged"),
    count(plan.conflicts.length, "to settle"),
    count(
      styles.added.length + styles.updated.length,
      styles.added.length + styles.updated.length === 1
        ? "text style"
        : "text styles"
    ),
  ].filter(part => part !== "");
  const alsoInFile = siteDataLines(plan.extras.site);
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="nx-vars-import">
        <DialogHeader>
          <DialogTitle>Import variables</DialogTitle>
          <DialogDescription>{counts.join(" · ")}</DialogDescription>
        </DialogHeader>
        <div className="nx-vars-import__body">
          <NameList title="New" names={plan.added.map(tokenDisplayLabel)} />
          <NameList
            title="Updated (a dark value, a name or a note this site lacks, or another tool's data)"
            names={plan.changed.map(tokenDisplayLabel)}
          />
          <NameList
            title={WORDS.textStyles}
            names={[...styles.added, ...styles.updated].map(sharedStyleName)}
          />
          {alsoInFile.length === 0 ? null : (
            <section className="nx-vars-import__section">
              <h3>{WORDS.alsoInFile}</h3>
              <ul className="nx-vars-import__skipped">
                {alsoInFile.map(line => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>
          )}
          {plan.extras.missingFonts.length === 0 ? null : (
            <MissingFonts
              families={plan.extras.missingFonts}
              {...(catalogue === undefined ? {} : { catalogue })}
            />
          )}
          {plan.conflicts.length === 0 ? null : (
            <section className="nx-vars-import__section">
              <h3>Different from this site</h3>
              <ul className="nx-vars-import__conflicts">
                {plan.conflicts.map(conflict => {
                  const name = tokenDisplayLabel(conflict.mine);
                  const choice = choices.get(conflict.identity) ?? "use";
                  return (
                    <li key={conflict.identity}>
                      <span className="nx-vars-import__name">{name}</span>
                      {/* Every field that differs, so a conflict over a
                          dark value or a name says which and how. */}
                      <dl className="nx-vars-import__fields">
                        {conflict.fields.map(field => (
                          <div key={field.field}>
                            <dt>{field.field}</dt>
                            <dd className="nx-vars-import__values">
                              {`${field.mine} → ${field.imported}`}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <div
                        className="nx-vars__seg"
                        role="radiogroup"
                        aria-label={`${name}: keep or use`}
                      >
                        {(["keep", "use"] as const).map(option => (
                          <button
                            key={option}
                            type="button"
                            role="radio"
                            aria-checked={choice === option}
                            onClick={() =>
                              setChoices(held =>
                                new Map(held).set(conflict.identity, option)
                              )
                            }
                          >
                            {option === "keep" ? "Keep mine" : "Use imported"}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {plan.labelClashes.length === 0 ? null : (
            <section className="nx-vars-import__section">
              <h3>Names used twice</h3>
              <ul className="nx-vars-import__skipped">
                {plan.labelClashes.map(name => (
                  <li key={name}>
                    {`Two variables would be called "${name}". Keep this site's version of one, or rename one before importing.`}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {plan.skipped.length === 0 ? null : (
            <section className="nx-vars-import__section">
              <h3>Skipped</h3>
              <ul className="nx-vars-import__skipped">
                {plan.skipped.map((line, at) => (
                  <li key={`${String(at)}-${line}`}>{line}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onApply(choices)}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What an import's toast says it stored: "Imported 3 variables.", or with
 * the text styles beside them, "Imported 3 variables and 2 text styles.".
 */
function importedWords(variables: number, textStyles: number): string {
  const said = counted(variables, "variable", "variables");
  return textStyles === 0
    ? `Imported ${said}.`
    : `Imported ${said} and ${counted(textStyles, "text style", "text styles")}.`;
}

/** "3 to add", or nothing for none. */
function count(n: number, words: string): string {
  return n === 0 ? "" : `${String(n)} ${words}`;
}

function NameList({
  title,
  names,
}: {
  title: string;
  names: readonly string[];
}): React.JSX.Element | null {
  if (names.length === 0) return null;
  return (
    <section className="nx-vars-import__section">
      <h3>{title}</h3>
      <p className="nx-vars-import__names">{names.join(", ")}</p>
    </section>
  );
}

/**
 * "What wasn't exported": each variable a file did not write as other tools
 * read it, what happened to it, and why, in plain words.
 */
function NotExportedList({
  list,
  onClose,
  returnTo,
}: {
  list: NotExported;
  onClose: () => void;
  returnTo: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="nx-design-gaps"
        // Opened from a toast that has gone, so focus returns to the menu
        // the export started from.
        onCloseAutoFocus={event => {
          event.preventDefault();
          returnTo.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{WORDS.notExported}</DialogTitle>
          <DialogDescription>{list.from}</DialogDescription>
        </DialogHeader>
        <ul className="nx-design-gaps__list">
          {list.gaps.map(gap => (
            <li key={gapKey(gap)} className="nx-design-gaps__row">
              <span className="nx-design-gaps__name">
                {gap.label ?? "The whole file"}
              </span>
              <span
                className="nx-design-gaps__outcome"
                data-outcome={gap.outcome}
              >
                {OUTCOME_WORDS[gap.outcome]}
              </span>
              <span className="nx-design-gaps__why">{gap.why}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What happened to a variable, as the list says it. */
const OUTCOME_WORDS: Readonly<Record<ExportGap["outcome"], string>> = {
  kept: WORDS.kept,
  "left-out": WORDS.leftOut,
  "without-data": WORDS.withoutData,
};

/** One entry per variable and outcome, however many files named it. */
function oncePerVariable(gaps: readonly ExportGap[]): ExportGap[] {
  const seen = new Map<string, ExportGap>();
  for (const gap of gaps) {
    if (!seen.has(gapKey(gap))) seen.set(gapKey(gap), gap);
  }
  return [...seen.values()];
}

function gapKey(gap: ExportGap): string {
  return `${gap.outcome}|${gap.name ?? gap.why}`;
}

/**
 * A message that stays until the author dismisses it: what an import could
 * not bring in, each value named with why. A toast that left by itself would
 * take the only list of what did not arrive with it.
 */
function sayUntilDismissed(
  tone: "error" | "warning",
  headline: string,
  detail: readonly string[]
): void {
  toast[tone](headline, {
    ...(detail.length === 0
      ? {}
      : {
          description: (
            <ul className="nx-design-toast__list">
              {detail.map((line, at) => (
                <li key={`${String(at)}-${line}`}>{line}</li>
              ))}
            </ul>
          ),
        }),
    duration: Number.POSITIVE_INFINITY,
    cancel: { label: "Dismiss", onClick: () => undefined },
  });
}

/** "1 file", "2 files": a count with the word that fits it. */
function counted(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * Hand a generated file to the browser. Revoked on a later task, because the
 * download the click starts is asynchronous and revoking now can cancel it.
 */
function download(made: ExportResult): void {
  const url = URL.createObjectURL(new Blob([made.text], { type: made.mime }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = made.filename;
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

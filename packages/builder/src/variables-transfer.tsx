/**
 * Bringing variables in from design-token files, and taking them out.
 *
 * The menu sits in the Design panel's header. Importing opens the system's
 * file chooser through a hidden file input, so the visible control is a menu
 * item like every other and the keyboard reaches it the same way. Nothing is
 * applied until the author has seen what the files would change and confirmed
 * it, settling each conflict as they go.
 *
 * Exports write files straight away: the DTCG token file (with a theme file
 * beside it when there are dark values), one file per mode for Figma, or the
 * CSS the site's pages read.
 *
 * @module variables-transfer
 */
import { tokenDisplayLabel, type SiteTokenSet } from "@nextlyhq/blocks-engine";
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
} from "@nextlyhq/ui";
import { ArrowDownUp } from "lucide-react";
import * as React from "react";

import {
  applyImport,
  exportCss,
  exportDtcgWithTheme,
  exportForFigma,
  planImport,
  type ConflictChoice,
  type ExportResult,
  type ImportPlan,
} from "./tokens-transfer";

/** What an import or an export carried, and what it did not. */
interface Report {
  tone: "done" | "refused";
  headline: string;
  detail: readonly string[];
}

type ReadyPlan = Extract<ImportPlan, { ok: true }>;

export interface VariablesTransfer {
  /** The header's import-and-export menu, with its hidden file input. */
  menu: React.JSX.Element;
  /** The report and the import preview, drawn in the panel body. */
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
}: {
  onChange: (tokens: SiteTokenSet) => void;
  currentTokens: () => SiteTokenSet | undefined;
  readOnly: boolean;
}): VariablesTransfer {
  const [report, setReport] = React.useState<Report | null>(null);
  const [plan, setPlan] = React.useState<ReadyPlan | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  // The callbacks as they are now, published at commit, for reads that
  // outlive the render that started them.
  const latest = React.useRef({ onChange, currentTokens });
  React.useLayoutEffect(() => {
    latest.current = { onChange, currentTokens };
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

  const refuse = (headline: string, detail: readonly string[] = []): void =>
    setReport({ tone: "refused", headline, detail });

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
    const planned = planImport(texts, into);
    if (!planned.ok) {
      refuse(planned.error, planned.skipped);
      return;
    }
    setReport(null);
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
    setReport({
      tone: "done",
      headline: `Imported ${String(result.imported)} ${
        result.imported === 1 ? "variable" : "variables"
      }.`,
      detail: result.skipped,
    });
    latest.current.onChange(result.tokens);
  };

  const send = (make: (set: SiteTokenSet) => readonly ExportResult[]): void => {
    const set = latest.current.currentTokens();
    if (set === undefined) {
      refuse("This site's variables are not loaded, so nothing was exported.");
      return;
    }
    const made = make(set);
    const written = made.filter(file => file.text !== "");
    for (const file of written) download(file);
    const detail = made.flatMap(file => file.skipped);
    if (written.length === 0) {
      refuse(
        "No file was written, because this site has no variables to write.",
        detail
      );
    } else {
      // Always a status, so an earlier refusal never stays on screen beside
      // a file that was saved.
      setReport({
        tone: "done",
        headline: `Saved ${written.map(file => file.filename).join(" and ")}.`,
        detail,
      });
    }
  };

  const menu = (
    <>
      {/* Not modal: it opens the file chooser and the import preview from
          inside, and a modal menu would hide the rest of the editor from
          assistive technology while leaving it focusable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="nx-vars__icon-button"
            aria-label="Import or export"
            title="Import or export"
          >
            <ArrowDownUp aria-hidden="true" size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="nx-vars__menu">
          {readOnly ? null : (
            <>
              <DropdownMenuItem onSelect={() => input.current?.click()}>
                Import variables…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => send(exportDtcgWithTheme)}>
            Export (DTCG)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => send(exportForFigma)}>
            Export for Figma
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => send(set => [exportCss(set)])}>
            Export CSS
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {readOnly ? null : (
        <input
          ref={input}
          type="file"
          multiple
          className="nx-sr-only"
          // Opened only from the menu's "Import variables…", so it is kept
          // out of the tab order and out of the accessibility tree: one way
          // to import, not a second bare file control beside the menu.
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
      {report === null ? null : (
        <TransferReport report={report} onDismiss={() => setReport(null)} />
      )}
      {plan === null ? null : (
        <ImportPreview
          plan={plan}
          onCancel={() => setPlan(null)}
          onApply={apply}
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
}: {
  plan: ReadyPlan;
  onCancel: () => void;
  onApply: (choices: ReadonlyMap<string, ConflictChoice>) => void;
}): React.JSX.Element {
  const [choices, setChoices] = React.useState<Map<string, ConflictChoice>>(
    () => new Map()
  );
  const counts = [
    count(plan.added.length, "to add"),
    count(plan.changed.length, "to update"),
    count(plan.unchanged.length, "unchanged"),
    count(plan.conflicts.length, "to settle"),
  ].filter(part => part !== "");
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

/** A report shown until dismissed: what an import or export left behind. */
function TransferReport({
  report,
  onDismiss,
}: {
  report: Report;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div
      className="nx-vars__report"
      data-tone={report.tone}
      role={report.tone === "refused" ? "alert" : "status"}
    >
      <p>{report.headline}</p>
      {report.detail.length === 0 ? null : (
        <ul>
          {report.detail.map((line, at) => (
            <li key={`${String(at)}-${line}`}>{line}</li>
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

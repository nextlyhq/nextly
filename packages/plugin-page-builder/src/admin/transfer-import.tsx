"use client";

/**
 * "Import from file" above the Components, Patterns and Layouts lists, and the
 * preview an import is confirmed from.
 *
 * Nothing is written until the author has seen what the file would do and
 * confirmed it, the same promise the Design panel's variables import makes and
 * in the same shape: counts first, then each clash with its own choice, then
 * what this site cannot take. Every answer is the import route's own dry run,
 * asked again whenever a choice changes, so what the dialog shows is what the
 * server will do, refusals included.
 *
 * - A block type the site lacks is listed and the import cannot be confirmed:
 *   a file carries content, never a block's code.
 * - A breakpoint with no exact match on this site offers "Add to this site"
 *   (only to someone who may manage site settings, and only while there is
 *   room) or "Drop its styles"; cancelling is the dialog's Cancel.
 * - When the site changes between the preview and the import, the server
 *   refuses the stale import, and the dialog asks for a new preview and says
 *   why before the author confirms again.
 *
 * @module admin/transfer-import
 */
import {
  isApiError,
  navigateTo,
  writePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Spinner,
  toast,
} from "@nextlyhq/ui";
import { Upload } from "lucide-react";
import * as React from "react";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import {
  IMPORT_ROUTE_PATH,
  TRANSFER_FORMAT,
  TRANSFER_KIND_PATHS,
  type ImportBreakpointChoice,
  type ImportChoices,
  type ImportConflict,
  type ImportConflictChoice,
  type ImportConflictKind,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type ImportUnmatchedBreakpoint,
  type TransferFile,
} from "../transfer/transfer-contract";

import { focusAfterClose } from "./library-dialog";
import { refusalMessage } from "./save-pattern-client";

/** The mutation envelope the import route answers with. */
interface Envelope {
  readonly message: string;
  readonly item: ImportResult;
}

/** One call to the import route; a refusal rejects with the route's error. */
function send(body: ImportRequest): Promise<Envelope | undefined> {
  return writePluginRoute<Envelope>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: IMPORT_ROUTE_PATH,
    body,
  });
}

/** What each kind of thing is called in the preview. */
const KIND_WORDS: Record<ImportConflictKind, [one: string, many: string]> = {
  component: ["component", "components"],
  pattern: ["pattern", "patterns"],
  layout: ["Layout", "Layouts"],
  class: ["shared style", "shared styles"],
  token: ["variable", "variables"],
  media: ["media file", "media files"],
};

const UNEXPLAINED = "The file could not be imported. Try again.";

/**
 * The bar above a list: one button opening the system's file chooser, and the
 * preview once a file is read. Rendered by the list's `BeforeListTable` slot.
 */
export function TransferImport(): React.JSX.Element {
  const input = React.useRef<HTMLInputElement>(null);
  const opener = React.useRef<HTMLButtonElement>(null);
  const [file, setFile] = React.useState<TransferFile | null>(null);

  const read = async (chosen: File) => {
    try {
      const parsed: unknown = JSON.parse(await chosen.text());
      if (!looksExported(parsed)) {
        toast.error(
          `"${chosen.name}" is not a page builder export. Choose a file exported from a Components, Patterns or Layouts list.`
        );
        return;
      }
      setFile(parsed);
    } catch {
      toast.error(
        `"${chosen.name}" could not be read as a page builder export.`
      );
    }
  };

  return (
    <div className="nx-pb-transfer-bar">
      <p className="nx-pb-transfer-bar__hint">
        Bring in a pattern, component or Layout exported from another site.
      </p>
      <Button
        ref={opener}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => input.current?.click()}
      >
        <Upload className="h-4 w-4" aria-hidden="true" />
        Import from file
      </Button>
      <input
        ref={input}
        type="file"
        className="nx-sr-only"
        // Opened only from the button, so it is kept out of the tab order and
        // the accessibility tree: one way to import, not a second bare control.
        tabIndex={-1}
        aria-hidden="true"
        accept=".json,application/json"
        onChange={event => {
          const chosen = event.target.files?.[0];
          // Cleared so choosing the same file again fires again.
          event.target.value = "";
          if (chosen !== undefined) void read(chosen);
        }}
      />
      {file === null ? null : (
        <ImportDialog
          file={file}
          onClose={() => setFile(null)}
          returnFocusTo={() => opener.current}
        />
      )}
    </div>
  );
}

/**
 * Whether a parsed file has the shape the dialog reads before the server has
 * judged it: the format marker, a root, and lists of items. Everything past
 * that is the import route's to check.
 */
function looksExported(value: unknown): value is TransferFile {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  const items = (list: unknown) =>
    Array.isArray(list) &&
    list.every(item => typeof item === "object" && item !== null);
  return (
    file.format === TRANSFER_FORMAT &&
    typeof file.root === "object" &&
    file.root !== null &&
    items(file.components) &&
    items(file.patterns) &&
    items(file.layouts)
  );
}

/** The preview of one file, asked again whenever a choice changes. */
function ImportDialog({
  file,
  onClose,
  returnFocusTo,
}: {
  file: TransferFile;
  onClose: () => void;
  /** Where focus goes once the dialog closes: the button that opened it. */
  returnFocusTo: () => HTMLElement | null;
}): React.JSX.Element {
  const [choices, setChoices] = React.useState<ImportChoices>({});
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [asking, setAsking] = React.useState(true);
  const [importing, setImporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [changed, setChanged] = React.useState(false);
  // Bumped to ask for the preview again with the same file and choices.
  const [asked, setAsked] = React.useState(0);

  React.useEffect(() => {
    let current = true;
    setAsking(true);
    send({ file, choices, dryRun: true })
      .then(answer => {
        if (!current) return;
        setPreview(answer?.item.preview ?? null);
        setError(answer === undefined ? UNEXPLAINED : null);
      })
      .catch((failure: unknown) => {
        if (!current) return;
        setError(
          failure instanceof Error
            ? refusalMessage(failure, UNEXPLAINED)
            : UNEXPLAINED
        );
      })
      .finally(() => {
        if (current) setAsking(false);
      });
    return () => {
      current = false;
    };
  }, [file, choices, asked]);

  const confirm = async () => {
    if (preview === null) return;
    setImporting(true);
    try {
      const answer = await send({ file, choices, expect: preview.fingerprint });
      const result = answer?.item;
      toast.success(`Imported "${preview.root.title}".`);
      onClose();
      if (result?.rootId !== undefined) {
        navigateTo(
          `/admin/collections/${TRANSFER_KIND_PATHS[preview.root.kind]}/${encodeURIComponent(result.rootId)}`
        );
      }
    } catch (failure) {
      if (isApiError(failure) && failure.status === 409) {
        setChanged(true);
        setError(null);
        setAsked(n => n + 1);
      } else {
        setError(
          failure instanceof Error
            ? refusalMessage(failure, UNEXPLAINED)
            : UNEXPLAINED
        );
      }
    } finally {
      setImporting(false);
    }
  };

  const conflictChoice = (key: string, choice: ImportConflictChoice) =>
    setChoices(held => ({
      ...held,
      conflicts: { ...held.conflicts, [key]: choice },
    }));
  const breakpointChoice = (id: string, choice: ImportBreakpointChoice) =>
    setChoices(held => ({
      ...held,
      breakpoints: { ...held.breakpoints, [id]: choice },
    }));

  const title = preview?.root.title ?? rootTitleOf(file);
  return (
    <Dialog
      open
      onOpenChange={open => {
        // Not while the import is being written: closing would not stop it.
        if (!open && !importing) onClose();
      }}
    >
      <DialogContent
        className="nx-pb-transfer flex max-h-[85vh] flex-col"
        onCloseAutoFocus={focusAfterClose(returnFocusTo)}
      >
        <DialogHeader>
          <DialogTitle>{`Import "${title}"`}</DialogTitle>
          <DialogDescription>
            {preview === null ? "Reading the file…" : summary(preview)}
          </DialogDescription>
        </DialogHeader>
        <div className="nx-pb-transfer__body" aria-busy={asking}>
          {changed ? (
            <Alert>
              <AlertTitle>This site changed since the preview</AlertTitle>
              <AlertDescription>
                Nothing was imported. Review what the import would do now, then
                import again.
              </AlertDescription>
            </Alert>
          ) : null}
          {error === null ? null : (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {preview === null ? (
            <div className="nx-pb-transfer__loading" role="status">
              <Spinner size="sm" />
              <span>Reading the file…</span>
            </div>
          ) : (
            <PreviewBody
              preview={preview}
              choices={choices}
              onConflict={conflictChoice}
              onBreakpoint={breakpointChoice}
              disabled={importing}
            />
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            disabled={preview?.ready !== true || asking || importing}
          >
            {importing ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  preview,
  choices,
  onConflict,
  onBreakpoint,
  disabled,
}: {
  preview: ImportPreview;
  /** The choices made, shown at once while the server is asked again. */
  choices: ImportChoices;
  onConflict: (key: string, choice: ImportConflictChoice) => void;
  onBreakpoint: (id: string, choice: ImportBreakpointChoice) => void;
  disabled: boolean;
}): React.JSX.Element {
  const blocking = preview.problems.filter(
    problem => problem.code !== "BREAKPOINT_UNDECIDED"
  );
  return (
    <>
      {preview.missingBlockTypes.length === 0 ? null : (
        <Alert variant="destructive">
          <AlertTitle>This site is missing blocks the file uses</AlertTitle>
          <AlertDescription>
            <p>
              A file carries content, never a block&apos;s code. Add the plugin
              that provides these, then import again:
            </p>
            <ul className="nx-pb-transfer__list">
              {preview.missingBlockTypes.map(type => (
                <li key={type}>
                  <code>{type}</code>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {blocking.length === 0 ? null : (
        <Alert variant="destructive">
          <AlertTitle>The file cannot be imported as it stands</AlertTitle>
          <AlertDescription>
            <ul className="nx-pb-transfer__list">
              {blocking.map((problem, at) => (
                <li key={`${String(at)}-${problem.code}`}>{problem.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Names title="New on this site" entries={preview.added} />
      <Names
        title="Already on this site, used as they are"
        entries={preview.reused}
      />
      {preview.conflicts.length === 0 ? null : (
        <section
          className="nx-pb-transfer__section"
          aria-labelledby="nx-pb-transfer-conflicts"
        >
          <h3 id="nx-pb-transfer-conflicts">
            Same name as something on this site
          </h3>
          <p className="nx-pb-transfer__note">
            Nothing on this site is changed. Each one is added under a new name
            unless you choose to use the existing one.
          </p>
          <ul className="nx-pb-transfer__rows">
            {preview.conflicts.map(conflict => (
              <ConflictRow
                key={conflict.key}
                conflict={conflict}
                choice={choices.conflicts?.[conflict.key] ?? conflict.choice}
                onChoose={onConflict}
                disabled={disabled}
              />
            ))}
          </ul>
        </section>
      )}
      {preview.breakpoints.unmatched.length === 0 ? null : (
        <section
          className="nx-pb-transfer__section"
          aria-labelledby="nx-pb-transfer-breakpoints"
        >
          <h3 id="nx-pb-transfer-breakpoints">
            Breakpoints this site does not have
          </h3>
          <p className="nx-pb-transfer__note">
            Only a breakpoint with exactly the same width is matched. Choose
            what to do with each of these.
          </p>
          <ul className="nx-pb-transfer__rows">
            {preview.breakpoints.unmatched.map(entry => (
              <BreakpointRow
                key={entry.fileId}
                entry={entry}
                choice={choices.breakpoints?.[entry.fileId] ?? entry.choice}
                onChoose={onBreakpoint}
                disabled={disabled}
              />
            ))}
          </ul>
        </section>
      )}
      {preview.breakpoints.matched.length === 0 ? null : (
        <section className="nx-pb-transfer__section">
          <h3>Breakpoints matched</h3>
          <p className="nx-pb-transfer__names">
            {preview.breakpoints.matched
              .map(
                entry =>
                  `${entry.label} (${String(entry.maxWidth)}px) → ${entry.to.label}`
              )
              .join(", ")}
          </p>
        </section>
      )}
    </>
  );
}

function ConflictRow({
  conflict,
  choice,
  onChoose,
  disabled,
}: {
  conflict: ImportConflict;
  choice: ImportConflictChoice;
  onChoose: (key: string, choice: ImportConflictChoice) => void;
  disabled: boolean;
}): React.JSX.Element {
  const id = React.useId();
  return (
    <li className="nx-pb-transfer__row">
      <div className="nx-pb-transfer__what">
        <span className="nx-pb-transfer__name" id={`${id}-name`}>
          <NameWithDetail name={conflict.name} detail={conflict.detail} />
        </span>
        <span className="nx-pb-transfer__kind">
          {sentenceCase(KIND_WORDS[conflict.kind][0])}
        </span>
      </div>
      <RadioGroup
        value={choice}
        aria-labelledby={`${id}-name`}
        onValueChange={value =>
          onChoose(conflict.key, value as ImportConflictChoice)
        }
        disabled={disabled}
        className="nx-pb-transfer__choices"
      >
        <div className="nx-pb-transfer__choice">
          <RadioGroupItem value="rename" id={`${id}-rename`} />
          <Label
            htmlFor={`${id}-rename`}
          >{`Add as "${conflict.renamedTo}"`}</Label>
        </div>
        <div className="nx-pb-transfer__choice">
          <RadioGroupItem value="existing" id={`${id}-existing`} />
          <Label
            htmlFor={`${id}-existing`}
          >{`Use the existing "${conflict.existing.name}"`}</Label>
        </div>
      </RadioGroup>
    </li>
  );
}

function BreakpointRow({
  entry,
  choice,
  onChoose,
  disabled,
}: {
  entry: ImportUnmatchedBreakpoint;
  choice: ImportBreakpointChoice | undefined;
  onChoose: (id: string, choice: ImportBreakpointChoice) => void;
  disabled: boolean;
}): React.JSX.Element {
  const id = React.useId();
  const uses = [
    counted(entry.styles, "style"),
    counted(entry.hides, "hide setting"),
  ].filter(part => part !== "");
  return (
    <li className="nx-pb-transfer__row">
      <div className="nx-pb-transfer__what">
        <span className="nx-pb-transfer__name" id={`${id}-name`}>
          {`${entry.label} (${String(entry.maxWidth)}px${entry.axis === "container" ? ", container" : ""})`}
        </span>
        <span className="nx-pb-transfer__kind">
          {uses.length === 0
            ? "Used by nothing"
            : `Used by ${uses.join(" and ")}`}
        </span>
      </div>
      <RadioGroup
        value={choice ?? ""}
        aria-labelledby={`${id}-name`}
        aria-required
        onValueChange={value =>
          onChoose(entry.fileId, value as ImportBreakpointChoice)
        }
        disabled={disabled}
        className="nx-pb-transfer__choices"
      >
        <div className="nx-pb-transfer__choice">
          <RadioGroupItem
            value="add"
            id={`${id}-add`}
            disabled={!entry.mayAdd}
            aria-describedby={
              entry.whyNotAdd === undefined ? undefined : `${id}-why`
            }
          />
          <Label htmlFor={`${id}-add`}>Add to this site</Label>
        </div>
        <div className="nx-pb-transfer__choice">
          <RadioGroupItem value="drop" id={`${id}-drop`} />
          <Label htmlFor={`${id}-drop`}>
            Drop its styles and hide settings
          </Label>
        </div>
      </RadioGroup>
      {entry.whyNotAdd === undefined ? null : (
        <p
          className="nx-pb-transfer__note nx-pb-transfer__why"
          id={`${id}-why`}
        >
          {entry.whyNotAdd}
        </p>
      )}
    </li>
  );
}

function Names({
  title,
  entries,
}: {
  title: string;
  entries: readonly {
    kind: ImportConflictKind;
    name: string;
    detail?: string;
  }[];
}): React.JSX.Element | null {
  if (entries.length === 0) return null;
  const byKind = new Map<
    ImportConflictKind,
    { name: string; detail?: string }[]
  >();
  for (const entry of entries) {
    byKind.set(entry.kind, [...(byKind.get(entry.kind) ?? []), entry]);
  }
  return (
    <section className="nx-pb-transfer__section">
      <h3>{title}</h3>
      <dl className="nx-pb-transfer__groups">
        {[...byKind].map(([kind, names]) => (
          <div key={kind}>
            <dt>{KIND_WORDS[kind][names.length === 1 ? 0 : 1]}</dt>
            <dd>
              {names.map((entry, at) => (
                <React.Fragment key={`${String(at)}-${entry.name}`}>
                  {at === 0 ? null : ", "}
                  <NameWithDetail name={entry.name} detail={entry.detail} />
                </React.Fragment>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * A name as an author knows it, with the code name beside it muted where the
 * two differ: a variable reads "Accent", with `color.accent` after it, as the
 * Variables panel shows it.
 */
function NameWithDetail({
  name,
  detail,
}: {
  name: string;
  detail: string | undefined;
}): React.JSX.Element {
  return (
    <>
      {name}
      {detail === undefined || detail === name ? null : (
        <span className="nx-pb-transfer__detail"> {detail}</span>
      )}
    </>
  );
}

/** "3 new · 1 already here · 2 to settle", or what blocks the import. */
function summary(preview: ImportPreview): string {
  const undecided = preview.breakpoints.unmatched.filter(
    entry => entry.choice === undefined
  ).length;
  const parts = [
    counted(preview.added.length, "new", "new"),
    counted(preview.reused.length, "already here", "already here"),
    counted(preview.conflicts.length, "same name", "same names"),
    counted(undecided, "breakpoint to decide", "breakpoints to decide"),
  ].filter(part => part !== "");
  return parts.length === 0 ? "Nothing new to add." : parts.join(" · ");
}

/** "shared style" as "Shared style", for a label standing on its own. */
function sentenceCase(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function counted(n: number, one: string, many = `${one}s`): string {
  if (n <= 0) return "";
  return `${String(n)} ${n === 1 ? one : many}`;
}

function rootTitleOf(file: TransferFile): string {
  const all = [
    ...(file.components ?? []),
    ...(file.patterns ?? []),
    ...(file.layouts ?? []),
  ];
  return all.find(item => item.id === file.root?.id)?.title ?? "file";
}

"use client";

/**
 * The "Turn into component" form, mounted only while the author has asked
 * for one. One form for both ways of making a component from a selection:
 * replacing the blocks with a placement (a convert), or, with "Keep the
 * original blocks on this page" ticked, saving a copy and leaving the page
 * alone (a save). Where only one way is open, the choice is held there with
 * the reason the other is not.
 *
 * It names the component, offers the exposure picker, and says beforehand
 * what it will do to the page: the server's dry run runs when the form opens,
 * and again when the choice changes, so a refusal (the composed depth, a
 * lock) or a warning (a link the convert leaves pointing at nothing) is shown
 * before anything is made.
 *
 * On confirm the server creates the component, published. A save is then
 * done. A convert answers with the page ops, which are applied to the unsaved
 * page as ONE undoable step once the canvas holds the new definition, so the
 * placement never flashes as missing. If the apply is refused, the component
 * stays in the library unused and the author is told so: the page is
 * unchanged.
 *
 * @module admin/ComponentFromSelectionPrompt
 */
import type {
  BlockDocument,
  BuilderOp,
  RequestedProperty,
} from "@nextlyhq/blocks-engine";
import {
  ExposurePicker,
  useModalKeyboardHold,
  type EditorState,
  type TurnIntoChoice,
} from "@nextlyhq/builder/shell";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
  toast,
} from "@nextlyhq/ui";
import * as React from "react";

import type {
  ComponentFromSelectionAction,
  ComponentFromSelectionResult,
} from "../library-contract";

import {
  useComponentFromSelection,
  type ComponentFromSelectionWriter,
} from "./component-from-selection-client";
import type { ComponentLibraryRead } from "./component-library-client";
import { focusAfterClose, subjectOf } from "./library-dialog";

/** What the author asked for, snapshotted at the gesture. */
export interface ComponentRequest {
  /** The way the form opens on: replacing the blocks, or keeping them. */
  readonly action: ComponentFromSelectionAction;
  readonly document: BlockDocument;
  /** Which ways are open, with the reason for one that is not. */
  readonly choice?: TurnIntoChoice;
}

/** The editor and library this form acts on. */
export interface ComponentFromSelectionPromptProps {
  readonly request: ComponentRequest | null;
  /**
   * The editor: its selection, its block definitions for the picker's rules,
   * and the apply that makes a convert one undoable step.
   */
  readonly editor: Pick<
    EditorState,
    "selection" | "lockDefinitions" | "applyAll" | "select"
  >;
  /** The component library the canvas draws from, re-read after a create. */
  readonly library: Pick<
    ComponentLibraryRead,
    "definitions" | "components" | "retry"
  >;
  readonly onClose: () => void;
  readonly returnFocusTo?: () => HTMLElement | null;
}

/** How long a convert waits for the canvas to hold the new definition. */
const DEFINITION_WAIT_MS = 8000;

/** The form's one title, the menu item's own words. */
const TITLE = "Turn into component";

/** What the submit says and the toast reports, by the way chosen. */
const COPY: Record<
  ComponentFromSelectionAction,
  { submit: string; working: string; done: string }
> = {
  "save-as": {
    submit: "Save component",
    working: "Saving…",
    done: "Component saved",
  },
  convert: {
    submit: "Turn into component",
    working: "Turning into a component…",
    done: "Turned into a component",
  },
};

/** The form, or nothing while no one has asked. */
export function ComponentFromSelectionPrompt(
  props: Omit<ComponentFromSelectionPromptProps, "request"> & {
    readonly request: {
      readonly action: string;
      readonly document: BlockDocument;
      readonly choice?: TurnIntoChoice;
    } | null;
  }
): React.JSX.Element | null {
  const request = props.request;
  if (request === null) return null;
  if (request.action !== "save-as" && request.action !== "convert") {
    return null;
  }
  return (
    <ComponentForm
      {...props}
      request={{
        action: request.action,
        document: request.document,
        ...(request.choice === undefined ? {} : { choice: request.choice }),
      }}
    />
  );
}

/** The sentences a dry run's warnings become. */
function warningSentences(result: ComponentFromSelectionResult): string[] {
  return result.warnings.map(
    warning =>
      `A link elsewhere on this page points at “#${warning.domId}”, which will stop working: ids inside a component are made unique each time it is used.`
  );
}

/** What the dry run said when the form opened. */
type DryRunCheck =
  | { readonly state: "checking" }
  | { readonly state: "ready"; readonly warnings: readonly string[] }
  | { readonly state: "refused" };

/** What the author asked about, held still for the form's life. */
interface Asked extends ComponentRequest {
  readonly selectedIds: readonly string[];
  readonly subject: string;
}

/** The dry run, as the form opens and again whenever the way chosen changes. */
function useDryRun(
  preview: ComponentFromSelectionWriter["preview"],
  asked: Asked,
  action: ComponentFromSelectionAction
): DryRunCheck {
  const [check, setCheck] = React.useState<DryRunCheck>({
    state: "checking",
  });
  React.useEffect(() => {
    let live = true;
    setCheck({ state: "checking" });
    void preview({
      action,
      document: asked.document,
      selectedIds: asked.selectedIds,
      fields: { title: "Preview" },
    }).then(result => {
      if (!live) return;
      setCheck(
        result === undefined
          ? { state: "refused" }
          : { state: "ready", warnings: warningSentences(result) }
      );
    });
    return () => {
      live = false;
    };
  }, [preview, asked, action]);
  return check;
}

/** A created component's page ops, waiting for the canvas to hold it. */
interface PendingOps {
  readonly id: string;
  readonly ops: readonly BuilderOp[];
}

/**
 * A convert's ops, applied once the canvas holds the definition they place.
 * Never before: a placement of a definition the editor cannot draw would
 * stand on the page as a placeholder. If it has not arrived after a bounded
 * wait (the author may not read components, or the read failed), nothing is
 * applied and the author is told the component is in the library, unused.
 */
function usePendingApply(
  pending: PendingOps | null,
  props: ComponentFromSelectionPromptProps,
  done: string
): void {
  const definitions = props.library.definitions;
  const { applyAll, select } = props.editor;
  const onClose = props.onClose;
  React.useEffect(() => {
    if (pending === null) return;
    const unused = (why: string) => {
      toast.error(
        `The component was created, but ${why}. It is in your library, unused, and this page is unchanged.`
      );
      onClose();
    };
    if (!definitions.has(pending.id)) {
      const timer = window.setTimeout(
        () => unused("this editor could not load it"),
        DEFINITION_WAIT_MS
      );
      return () => window.clearTimeout(timer);
    }
    if (applyAll(pending.ops) === null) {
      unused("this page could not take it");
      return;
    }
    const inserted = pending.ops.find(op => op.kind === "insert");
    if (inserted?.kind === "insert") select(inserted.node.id, "replace");
    toast.success(done);
    onClose();
  }, [pending, definitions, applyAll, select, onClose, done]);
}

/** The categories the library already uses, offered as suggestions. */
function categoriesOf(
  components: ComponentFromSelectionPromptProps["library"]["components"]
): string[] {
  const names = components
    .map(component => component.category?.trim() ?? "")
    .filter(name => name !== "");
  return [...new Set(names)];
}

/** The metadata fields, as the author typed them. */
interface Metadata {
  readonly title: string;
  readonly description: string;
  readonly category: string;
}

/** The metadata as the route takes it, blanks left out. */
function fieldsOf(metadata: Metadata) {
  const description = metadata.description.trim();
  const category = metadata.category.trim();
  return {
    title: metadata.title.trim(),
    ...(description === "" ? {} : { description }),
    ...(category === "" ? {} : { category }),
  };
}

function ComponentForm(
  props: ComponentFromSelectionPromptProps & { request: ComponentRequest }
): React.JSX.Element {
  const { request, onClose, returnFocusTo } = props;
  const selectedIds = props.editor.selection.ids;
  const writer = useComponentFromSelection();
  // Held still for the form's life: the editor behind the modal may re-render,
  // and the subject and the selection sent must stay the ones asked about.
  const [asked] = React.useState<Asked>(() => ({
    ...request,
    selectedIds,
    subject: subjectOf(request.document, selectedIds),
  }));
  // The way chosen: replacing the blocks, or keeping them and saving a copy.
  const [action, setAction] = React.useState<ComponentFromSelectionAction>(
    asked.action
  );
  const copy = COPY[action];
  const [metadata, setMetadata] = React.useState<Metadata>({
    title: "",
    description: "",
    category: "",
  });
  const [exposed, setExposed] = React.useState<readonly RequestedProperty[]>(
    []
  );
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [pending, setPending] = React.useState<PendingOps | null>(null);
  const check = useDryRun(writer.preview, asked, action);
  usePendingApply(pending, props, copy.done);
  useModalKeyboardHold("component-from-selection-dialog", true);

  const unnamed = exposed.some(entry => entry.label.trim() === "");
  const complete =
    metadata.title.trim() !== "" && !unnamed && check.state === "ready";

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    // Kept from the page form around the editor, which would save the page.
    event.stopPropagation();
    if (busy || !complete) return;
    setBusy(true);
    setFailed(false);
    const result = await writer.create({
      action,
      document: asked.document,
      selectedIds: asked.selectedIds,
      fields: fieldsOf(metadata),
      exposure: {
        properties: exposed.map(entry => ({
          ...entry,
          label: entry.label.trim(),
        })),
      },
    });
    if (result === undefined) {
      setBusy(false);
      setFailed(true);
      return;
    }
    props.library.retry();
    if (action === "convert") {
      setPending({ id: result.component.id, ops: result.pageOps });
      return;
    }
    toast.success(copy.done);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={next => {
        // A dismissal while the write runs would not stop it, so it is not
        // offered: the button says what is happening.
        if (!busy && !next) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-lg"
        onCloseAutoFocus={focusAfterClose(returnFocusTo)}
      >
        <form
          onSubmit={event => void submit(event)}
          className="flex min-h-0 flex-col"
          aria-busy={busy || check.state === "checking"}
        >
          <DialogHeader>
            <DialogTitle>{TITLE}</DialogTitle>
            <DialogDescription>
              {action === "convert"
                ? `${asked.subject} will become a new component. Edit the component later and every page that uses it follows.`
                : `${asked.subject} will be saved as a new component. This page is not changed.`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 gap-4 overflow-y-auto py-4">
            <MetadataFields
              metadata={metadata}
              onChange={setMetadata}
              categories={categoriesOf(props.library.components)}
              disabled={busy}
            />
            <KeepOriginals
              action={action}
              choice={asked.choice}
              disabled={busy}
              onChange={setAction}
            />
            <ExposurePicker
              document={asked.document}
              selectedIds={asked.selectedIds}
              definitions={props.editor.lockDefinitions}
              value={exposed}
              onChange={setExposed}
              disabled={busy}
            />
            <FormNotes
              check={check}
              unnamed={unnamed}
              previewError={writer.previewError}
              createError={failed ? (writer.createError ?? "") : undefined}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!complete || busy}>
              {busy ? copy.working : copy.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Keep the original blocks on this page": ticked, the form saves a copy and
 * leaves the page alone; clear, it replaces the blocks with a placement. Held
 * where only one way is open, with the reason the other is not.
 */
function KeepOriginals({
  action,
  choice,
  disabled,
  onChange,
}: {
  action: ComponentFromSelectionAction;
  choice: TurnIntoChoice | undefined;
  disabled: boolean;
  onChange: (next: ComponentFromSelectionAction) => void;
}): React.JSX.Element {
  const held = choice?.replaceRefused ?? choice?.keepRefused;
  const reasonId = React.useId();
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Checkbox
          id="nx-component-keep"
          checked={action === "save-as"}
          disabled={disabled || held !== undefined}
          aria-describedby={held === undefined ? undefined : reasonId}
          onCheckedChange={checked =>
            onChange(checked === true ? "save-as" : "convert")
          }
        />
        <Label htmlFor="nx-component-keep">
          Keep the original blocks on this page
        </Label>
      </div>
      {held === undefined ? null : (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {held}
        </p>
      )}
    </div>
  );
}

/** Name, category and description. */
function MetadataFields({
  metadata,
  onChange,
  categories,
  disabled,
}: {
  metadata: Metadata;
  onChange: (next: Metadata) => void;
  categories: readonly string[];
  disabled: boolean;
}): React.JSX.Element {
  const listId = React.useId();
  const set = (key: keyof Metadata) => (value: string) =>
    onChange({ ...metadata, [key]: value });
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="nx-component-title">Name</Label>
        <Input
          id="nx-component-title"
          value={metadata.title}
          autoFocus
          required
          disabled={disabled}
          onChange={event => set("title")(event.target.value)}
          placeholder="Pricing card"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nx-component-category">
          Category <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="nx-component-category"
          value={metadata.category}
          list={listId}
          disabled={disabled}
          onChange={event => set("category")(event.target.value)}
          placeholder="Cards"
        />
        <datalist id={listId}>
          {categories.map(name => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="nx-component-description">
          Description <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="nx-component-description"
          value={metadata.description}
          rows={2}
          disabled={disabled}
          onChange={event => set("description")(event.target.value)}
          placeholder="What this is for, and when to reach for it."
        />
      </div>
    </>
  );
}

/**
 * What the form has to say under its fields: a pick left unnamed, the dry
 * run's progress, its refusal or warnings, and a refused create.
 */
function FormNotes({
  check,
  unnamed,
  previewError,
  createError,
}: {
  check: DryRunCheck;
  unnamed: boolean;
  previewError: string | undefined;
  /** Set once a create was refused; empty when the server gave no reason. */
  createError: string | undefined;
}): React.JSX.Element {
  return (
    <>
      {unnamed ? (
        <p className="text-xs text-destructive" role="status">
          Give every value you picked a name pages will see.
        </p>
      ) : null}
      {check.state === "checking" ? (
        <p className="text-xs text-muted-foreground" role="status">
          Checking what this will change…
        </p>
      ) : null}
      {check.state === "refused" ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {previewError ?? "This selection cannot be made into a component."}
          </AlertDescription>
        </Alert>
      ) : null}
      {check.state === "ready" && check.warnings.length > 0 ? (
        <Alert role="status">
          <AlertDescription>
            <ul className="grid gap-1">
              {check.warnings.map(warning => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {createError === undefined ? null : (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {createError === ""
              ? "The component could not be created. Try again."
              : createError}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

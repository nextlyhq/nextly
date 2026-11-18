"use client";

/**
 * What the canvas says over a Form block, in the editor's own colours: a
 * picked form that is a draft, closed or deleted, and a simple form whose
 * answers have nowhere to go (`form-states-model.ts` says which and why).
 *
 * The form itself is drawn by the block, as a visitor will see it: a picked
 * form from its provider's description, read as the author through the
 * editor's own route. This draws only the editor's words about it:
 *
 * - **A tag on the block's top edge** for a draft, a closed form, and a
 *   simple form with nowhere to send answers, so the form beneath stays in
 *   view.
 * - **A plate over the block** for a deleted form, which draws an empty box
 *   in its place where an author is looking; the box is given room for the
 *   plate on the canvas only, and its room is taken back once the plate goes.
 *
 * A closed or deleted form's notice offers "Pick another form": the forms
 * the author may pick, written as the inspector's picker writes them, so it
 * is one step to undo and refused where a lock holds the block's form.
 *
 * Drawn like `ImageStates`, in the overlay over the canvas, at each block's
 * measured rectangle, kept current by `watchCanvasFor`.
 *
 * @module canvas/form-states
 */
import { walkNodes } from "@nextlyhq/blocks-engine";
import { Select, SelectContent, SelectTrigger } from "@nextlyhq/ui";
import * as React from "react";

import type { ContentServices, PickedFormState } from "../content-services";
import { isHTMLElement } from "../dom-kind";
import type { EditorState } from "../editor-state";
import {
  FORM_BLOCK,
  FORM_WORDS,
  pickedFormOf,
  type PickedForm,
} from "../form-picked";
import {
  FormChoiceItems,
  formOfChoice,
  useFormSources,
  useShownAgain,
} from "../form-source-control";
import type { Rect } from "../geometry";
import { lockViewOf, propIsWritable, propPatch } from "../inspector";
import { selectionModeFor } from "../selection";
import { CANVAS_ROOT_CLASS } from "../shell-state";

import { CHROME_ATTRIBUTE } from "./canvas-chrome";
import { useCanvasFrame } from "./canvas-frame-context";
import { watchCanvasFor } from "./canvas-geometry-watch";
import {
  drawnForms,
  formNodeOf,
  noticeOf,
  pickedFormKey,
  type FormNoticeKind,
} from "./form-states-model";
import {
  layoutFragments,
  overlaySpaceOf,
  renderSkips,
  visiblePartOf,
} from "./geometry-dom";
import { nodeElements } from "./rendered-nodes";

/** @experimental Settles with the form provider contract. */
export interface FormStatesProps {
  readonly editor: EditorState;
  /** The host's reads of the author's forms; absent, a picked form is said nothing about. */
  readonly services?: Pick<ContentServices, "pickedFormState" | "listForms">;
  /** A block is being dragged: nothing is drawn, so the drag reaches the canvas. */
  readonly hidden?: boolean;
}

/** The room a deleted form's box is given for its plate, on the canvas only. */
const DELETED_ROOM = "6rem";

/** One notice, where the canvas draws it. */
interface Plate {
  readonly nodeId: string;
  readonly kind: FormNoticeKind;
  readonly rect: Rect;
}

/** The words of each notice. */
const NOTICE_WORDS: Readonly<Record<FormNoticeKind, string>> = {
  draft: FORM_WORDS.draft,
  closed: FORM_WORDS.closed,
  deleted: FORM_WORDS.deleted,
  nowhere: FORM_WORDS.nowhere,
};

/** Every form the document's Forms pick, each once. */
function pickedForms(document: EditorState["document"]): PickedForm[] {
  const picks = new Map<string, PickedForm>();
  walkNodes(document.nodes, node => {
    if (node.type !== FORM_BLOCK) return;
    const picked = pickedFormOf(node.props.form);
    if (picked !== undefined) picks.set(pickedFormKey(picked), picked);
  });
  return [...picks.values()];
}

/** What `usePickedFormStates` has asked, and in which round of asking. */
interface Asked {
  readonly read: ContentServices["pickedFormState"];
  readonly again: number;
  /** The round, bumped whenever everything is to be read afresh. */
  round: number;
  /** Each form asked in this round, by key. */
  readonly keys: Set<string>;
}

/**
 * Each picked form's state, read once per form, and read again for every
 * form when the author comes back to the editor (`useShownAgain`), since the
 * form may have changed in its own tab, or when the host's reader changes. A
 * form no longer picked is read afresh if it is picked again. A read that
 * fails leaves its form unread, so nothing is said over it, until the next
 * time everything is read. An answer from an earlier round is dropped, so a
 * slow old read never puts back a state that was read since.
 */
function usePickedFormStates(
  document: EditorState["document"],
  read: ContentServices["pickedFormState"]
): ReadonlyMap<string, PickedFormState> {
  const [states, setStates] = React.useState<
    ReadonlyMap<string, PickedFormState>
  >(() => new Map());
  const again = useShownAgain();
  const asked = React.useRef<Asked>({
    read,
    again,
    round: 0,
    keys: new Set(),
  });
  React.useEffect(() => {
    const kept = asked.current;
    if (kept.read !== read || kept.again !== again) {
      asked.current = { read, again, round: kept.round + 1, keys: new Set() };
    }
    const now = asked.current;
    if (read === undefined) return;
    const forms = pickedForms(document);
    const picked = new Set(forms.map(pickedFormKey));
    for (const key of now.keys) if (!picked.has(key)) now.keys.delete(key);
    for (const form of forms) {
      const key = pickedFormKey(form);
      if (now.keys.has(key)) continue;
      now.keys.add(key);
      const round = now.round;
      read(form).then(
        state => {
          if (asked.current.round !== round) return;
          setStates(current =>
            current.get(key) === state
              ? current
              : new Map(current).set(key, state)
          );
        },
        () => undefined
      );
    }
  }, [document, read, again]);
  return states;
}

/** Where a notice goes for an element: the part of it the page shows. */
function shownRectOf(
  element: Element,
  space: NonNullable<ReturnType<typeof overlaySpaceOf>>
): Rect | null {
  if (layoutFragments(element) === 0 || renderSkips(element)) return null;
  const visible = visiblePartOf(element, space.root);
  if (visible === null || visible === "hidden") return null;
  return space.place(visible);
}

/** Two lists of plates that draw the same. */
function samePlates(a: readonly Plate[], b: readonly Plate[]): boolean {
  return (
    a.length === b.length &&
    a.every((plate, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        other.nodeId === plate.nodeId &&
        other.kind === plate.kind &&
        other.rect.x === plate.rect.x &&
        other.rect.y === plate.rect.y &&
        other.rect.width === plate.rect.width &&
        other.rect.height === plate.rect.height
      );
    })
  );
}

/** Give a deleted form's box its plate's room; `kept` notes what was given. */
function reserveRoom(element: Element, kept: Map<Element, string>): void {
  if (!isHTMLElement(element)) return;
  if (!kept.has(element)) {
    kept.set(element, element.style.getPropertyValue("min-block-size"));
  }
  if (element.style.getPropertyValue("min-block-size") !== DELETED_ROOM) {
    element.style.setProperty("min-block-size", DELETED_ROOM);
  }
}

/** Take back the room given to every box no longer in `still`. */
function releaseRoom(
  kept: Map<Element, string>,
  still: ReadonlySet<Element>
): void {
  for (const [element, before] of kept) {
    if (still.has(element)) continue;
    kept.delete(element);
    if (!isHTMLElement(element)) continue;
    if (before === "") element.style.removeProperty("min-block-size");
    else element.style.setProperty("min-block-size", before);
  }
}

/** The canvas's notices over its Form blocks. */
export function FormStates({
  editor,
  services,
  hidden = false,
}: FormStatesProps): React.JSX.Element {
  const layer = React.useRef<HTMLDivElement | null>(null);
  const [plates, setPlates] = React.useState<readonly Plate[]>([]);
  const states = usePickedFormStates(
    editor.document,
    services?.pickedFormState
  );
  // Read by the measure, which outlives the render that made it.
  const latest = React.useRef({ document: editor.document, states });
  latest.current = { document: editor.document, states };
  const reserved = React.useRef(new Map<Element, string>());

  const measure = React.useCallback(() => {
    const element = layer.current;
    const space =
      element === null ? null : overlaySpaceOf(element, CANVAS_ROOT_CLASS);
    if (space === null) {
      releaseRoom(reserved.current, new Set());
      setPlates(current => (current.length === 0 ? current : []));
      return;
    }
    const { document, states: known } = latest.current;
    const next: Plate[] = [];
    const roomed = new Set<Element>();
    for (const form of drawnForms(nodeElements(space.root), document)) {
      const kind = noticeOf(
        form,
        form.picked === undefined
          ? undefined
          : known.get(pickedFormKey(form.picked))
      );
      if (kind === undefined) continue;
      if (kind === "deleted") {
        reserveRoom(form.element, reserved.current);
        roomed.add(form.element);
      }
      const rect = shownRectOf(form.element, space);
      if (rect !== null) next.push({ nodeId: form.nodeId, kind, rect });
    }
    releaseRoom(reserved.current, roomed);
    setPlates(current => (samePlates(current, next) ? current : next));
  }, []);

  const canvasFrame = useCanvasFrame();
  React.useLayoutEffect(() => {
    measure();
  }, [measure, editor.document, states, canvasFrame]);
  React.useEffect(
    () => watchCanvasFor(() => layer.current, measure),
    [measure, canvasFrame]
  );
  // Every box's own height comes back once the notices go.
  React.useEffect(() => {
    const kept = reserved.current;
    return () => releaseRoom(kept, new Set());
  }, []);

  const picking = plates.some(
    plate => plate.kind === "closed" || plate.kind === "deleted"
  );
  const sources = useFormSources(picking ? services?.listForms : undefined);

  return (
    <div ref={layer} className="nx-form-states" {...{ [CHROME_ATTRIBUTE]: "" }}>
      {hidden
        ? null
        : plates.map(plate => (
            <FormNotice
              key={plate.nodeId}
              plate={plate}
              editor={editor}
              sources={sources.status === "ready" ? sources.sources : []}
            />
          ))}
    </div>
  );
}

/** One notice: a tag on the block's top edge, or a plate over a deleted form. */
function FormNotice({
  plate,
  editor,
  sources,
}: {
  readonly plate: Plate;
  readonly editor: EditorState;
  readonly sources: Parameters<typeof FormChoiceItems>[0]["sources"];
}): React.JSX.Element {
  const { rect, kind, nodeId } = plate;
  const writable = propIsWritable(
    editor.document,
    nodeId,
    "form",
    lockViewOf(editor)
  );
  const pick = (value: string) => {
    const form = formOfChoice(value);
    const node = formNodeOf(editor.document, nodeId);
    if (form === undefined || node === undefined) return;
    editor.apply({
      kind: "update",
      id: nodeId,
      patch: propPatch(node, "form", form),
    });
  };
  const offersPick =
    (kind === "closed" || kind === "deleted") &&
    writable &&
    sources.some(source => source.forms.length > 0);
  return (
    <div
      className="nx-form-states__place"
      data-form-notice={kind}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
      }}
    >
      <div
        className={
          kind === "deleted" ? "nx-form-states__plate" : "nx-form-states__tag"
        }
        role="note"
        // The notice's own presses stay on it: the canvas beneath would
        // otherwise select whatever block is under the pointer. A click on
        // the notice selects its Form instead, so a deleted form's box,
        // which the plate covers, still opens its settings; the picker's
        // own presses stop at the picker.
        onClick={event => {
          event.stopPropagation();
          const mode = selectionModeFor(event);
          if (mode === "replace") editor.select(nodeId);
          else editor.select(nodeId, mode);
        }}
        onPointerDown={event => event.stopPropagation()}
        onContextMenu={event => event.stopPropagation()}
      >
        <span className="nx-form-states__words">{NOTICE_WORDS[kind]}</span>
        {offersPick ? (
          <span
            className="nx-form-states__picker"
            onClick={event => event.stopPropagation()}
          >
            <Select value="" onValueChange={pick}>
              <SelectTrigger
                className="nx-form-states__pick"
                aria-label={FORM_WORDS.pickAnother}
              >
                {FORM_WORDS.pickAnother}
              </SelectTrigger>
              <SelectContent>
                <FormChoiceItems sources={sources} />
              </SelectContent>
            </Select>
          </span>
        ) : null}
      </div>
    </div>
  );
}

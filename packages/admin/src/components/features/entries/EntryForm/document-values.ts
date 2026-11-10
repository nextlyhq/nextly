"use client";

/**
 * The document's live values, for a plugin's component inside the editor:
 * what is typed, before any save.
 *
 * A place's `entry` prop is the document as it was read; these hooks are the
 * document as it is being edited. They read the document's own form, which
 * the editor hands down here where it mounts it, never react-hook-form's
 * nearest form context: a plugin's component with a form of its own, or a
 * second copy of react-hook-form, would otherwise read its own form instead,
 * and the document's values would silently not be there.
 *
 * Each hook answers `null` outside a document editor, as the other document
 * hooks do: a component may be drawn in previews and pickers, where there is
 * no document, and that is an ordinary answer rather than an error.
 *
 * @module components/entries/EntryForm/document-values
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { UseFormReturn } from "react-hook-form";

/** The document's form, and whether its content may be written now. */
interface DocumentForm {
  form: UseFormReturn<Record<string, unknown>>;
  /** The document's content is held: a past version on screen, a colleague's
   *  claim, a reader's page, a recovery. Its fields are read-only. */
  contentHeld: boolean;
}

/**
 * What the hooks are handed: the form, the hold as of the last drawing, and
 * the hold as it is at the moment of asking, which a write checks so that a
 * setter kept from before a hold began still writes nothing once it has.
 */
interface DocumentFormSourceValue extends DocumentForm {
  heldNow: () => boolean;
}

const DocumentFormContext = createContext<DocumentFormSourceValue | null>(null);

/** Hands the document's form down to what the editor draws inside it. */
export function DocumentFormSource({
  form,
  contentHeld,
  children,
}: DocumentForm & { children: ReactNode }): ReactNode {
  // The hold as of this drawing, read by every setter handed out so far, as
  // the editors keep their own writes' hold (`writesHeldNow`).
  const held = useRef(contentHeld);
  held.current = contentHeld;
  const value = useMemo(
    () => ({ form, contentHeld, heldNow: () => held.current }),
    [form, contentHeld]
  );
  return createElement(DocumentFormContext.Provider, { value }, children);
}

/** Whether a change to field `changed` can change the value at `path`. */
function touches(changed: string | undefined, path: string): boolean {
  // No name: the whole form was set (a reset, a reload).
  if (changed === undefined) return true;
  return (
    changed === path ||
    changed.startsWith(`${path}.`) ||
    path.startsWith(`${changed}.`)
  );
}

/**
 * A value as it stands, detached from the form's own objects. A value that
 * cannot be copied, such as a function, is handed as it is.
 */
function copyOf(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

/** No document: nothing to subscribe to. */
const noSubscription = () => () => {};

/**
 * @experimental The live values of the named fields of the document being
 * edited, by their dot paths (`"seo.title"`): what is typed, before any save.
 * The component draws again only when one of them changes. `null` outside a
 * document editor.
 */
export function useDocumentValues(
  paths: readonly string[]
): Readonly<Record<string, unknown>> | null {
  const source = useContext(DocumentFormContext);
  const form = source?.form;
  // One key for the paths, so a new array of the same paths, as a literal
  // gives on every render, is not a new subscription.
  const key = paths.join("\u0000");
  // The answer handed out, and the count of changes it was read at. The form
  // changes a group's object in place, so a group read cannot be judged
  // unchanged by its identity: a change that touches a read path counts
  // instead, and only a counted change reads the values again.
  const last = useRef<{
    form: unknown;
    key: string;
    seen: number;
    values: Readonly<Record<string, unknown>>;
  } | null>(null);
  const changes = useRef(0);

  const subscribe = useCallback(
    (changed: () => void) => {
      if (form === undefined) return () => {};
      // Counted once as listening starts, so the next reading looks again: a
      // write made after the first drawing and before this, by another
      // component's layout effect, sent no change to hear.
      changes.current += 1;
      const named = key === "" ? [] : key.split("\u0000");
      const subscription = form.watch((_values, { name }) => {
        if (!named.some(path => touches(name, path))) return;
        changes.current += 1;
        changed();
      });
      return () => subscription.unsubscribe();
    },
    [form, key]
  );

  const snapshot = useCallback((): Readonly<Record<string, unknown>> | null => {
    if (form === undefined) return null;
    const previous = last.current;
    // Nothing the paths read has changed: the same answer, so nothing draws
    // again for a change that touched none of them.
    if (
      previous !== null &&
      previous.form === form &&
      previous.key === key &&
      previous.seen === changes.current
    ) {
      return previous.values;
    }
    const named = key === "" ? [] : key.split("\u0000");
    // Copies, so a group handed out is the reader's own, never the form's
    // object that the next keystroke changes in place.
    const values = Object.fromEntries(
      named.map(path => [path, copyOf(form.getValues(path))])
    );
    last.current = { form, key, seen: changes.current, values };
    return values;
  }, [form, key]);

  return useSyncExternalStore(
    form === undefined ? noSubscription : subscribe,
    snapshot,
    snapshot
  );
}

/** @experimental One field of the document being edited, to read and write. */
export interface DocumentField {
  /** What the field holds now, as typed. */
  value: unknown;
  /** Whether a write would be taken now; false while the content is held. */
  writable: boolean;
  /**
   * Sets the field as the person typing into it would, marking the document
   * changed. Writes nothing and answers false while the document's content is
   * held. `set(null)` returns a field to its automatic value.
   */
  set: (next: unknown) => boolean;
}

/**
 * @experimental One field of the document being edited, by its dot path:
 * its live value, and a write that follows the document's own hold on its
 * content. `null` outside a document editor.
 */
export function useDocumentField(path: string): DocumentField | null {
  const source = useContext(DocumentFormContext);
  const values = useDocumentValues([path]);
  const set = useCallback(
    (next: unknown): boolean => {
      // The hold as it is now, not as it was when this setter was handed out.
      if (source === null || source.heldNow()) return false;
      const { form } = source;
      // Checked as typing into the field would be: once a save has been
      // refused, a field is checked as it changes; before, it is not.
      form.setValue(path, next, {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      });
      return true;
    },
    [source, path]
  );
  if (source === null || values === null) return null;
  return { value: values[path], writable: !source.contentHeld, set };
}

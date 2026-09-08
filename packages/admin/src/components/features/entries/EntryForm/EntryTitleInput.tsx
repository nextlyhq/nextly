"use client";

/**
 * The document's title, as one control that reads the form rather than a copy.
 *
 * Its own component for two reasons, and the first is a hard requirement. The
 * header returns early when it is rendered outside a form — a legitimate
 * arrangement — and a hook cannot sit after that return. Registering the input
 * was not a hook and could; reading the form's value IS one, so the control
 * moves to where it is only ever mounted with a form around it and its hook
 * runs unconditionally.
 *
 * The second is that the title is about to be drawn somewhere other than the
 * header, and a second copy of this would be the exact defect it was extracted
 * to fix.
 *
 * CONTROLLED, deliberately. Registered, the input kept a private copy of the
 * value: React Hook Form seeds the DOM once and an edit made through any other
 * surface never reaches it. That became real the moment a takeover field could
 * rename the document — the page builder's settings panel renames a page, this
 * input goes on showing the old name behind the editor, and the author's next
 * keystroke saves the old name back over the rename.
 *
 * @module components/features/entries/EntryForm/EntryTitleInput
 */

import { useController, type Control } from "react-hook-form";

import { cn } from "@admin/lib/utils";

/**
 * The value types a text box can show, which is every primitive it can be
 * handed.
 *
 * A SET rather than a chain of `typeof` comparisons, because this list grew by
 * one TWICE — numbers, then booleans — and each omission read as a deliberate
 * narrowing rather than a case nobody had listed. The shape was the defect: a
 * chain invites adding the type in front of you, a set invites asking which
 * types exist.
 *
 * Measured against the registered input this replaced, which is the parity
 * being kept: handed `true` it displayed `true`, handed `42` it displayed
 * `42`. Anything refused here shows as "Untitled" over saved content, which
 * lies about the document — strictly worse than showing an odd value.
 *
 * `symbol` and `function` are absent deliberately rather than forgotten:
 * neither survives the API round trip, and `String(Symbol())` throws.
 */
const PRIMITIVE_TITLES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "bigint",
  "boolean",
]);

export interface EntryTitleInputProps {
  /** The form field holding the title. */
  name: string;
  /** The form this title belongs to. */
  control: Control<Record<string, unknown>>;
  /** Accessible name, from the field's own label. */
  label: string;
  /** Whether an empty title should be refused. */
  required: boolean;
  /** Whether the document's identity is fixed — a Single's, for instance. */
  locked: boolean;
  /** Whether the form is mid-submit. */
  submitting: boolean;
  /** Whether this title is being edited in a right-to-left language. */
  rtl: boolean;
  /** Published so the header can focus it when creating. */
  inputRef?: (element: HTMLInputElement | null) => void;
  className?: string;
}

export function EntryTitleInput({
  name,
  control,
  label,
  required,
  locked,
  submitting,
  rtl,
  inputRef,
  className,
}: EntryTitleInputProps) {
  const { field } = useController({
    control,
    name,
    rules: { required: required && !locked ? "Title is required" : false },
  });

  /*
   * PRIMITIVES ARE SHOWN, not just strings.
   *
   * `title` is an ownable system column and a code-first schema may redefine
   * it with any field type: core covers a required NUMBER title, and a
   * `checkbox` owning the column reaches this as a boolean. A document holding
   * `42` must read `42` here, and one holding `true` must read `true`. Accepting only strings would show such a title as
   * "Untitled" while the form held its real value — the author would see an
   * empty box over saved content, which is the reverse of the defect this
   * control was extracted to fix. The registered input this replaced rendered
   * primitives natively, so this keeps what it displayed.
   *
   * Anything else — an object, an array, null — becomes empty rather than
   * `[object Object]`, and an empty string keeps the input controlled, where
   * `undefined` would make it uncontrolled again and reintroduce the private
   * copy.
   *
   * What this does NOT change is the write. A text input yields a string
   * whatever the column's type, exactly as it did before, so editing a numeric
   * title still produces a string its schema will refuse. Drawing the title
   * through its own configured field control is the fix for that, and it is a
   * different change from this one.
   */
  const raw: unknown = field.value;
  const value = PRIMITIVE_TITLES.has(typeof raw) ? String(raw) : "";

  return (
    <input
      name={field.name}
      value={value}
      onChange={field.onChange}
      onBlur={field.onBlur}
      ref={element => {
        field.ref(element);
        inputRef?.(element);
      }}
      type="text"
      placeholder="Untitled"
      aria-label={label}
      disabled={submitting}
      readOnly={locked}
      {...(rtl ? { dir: "rtl" as const } : {})}
      className={cn(
        "w-full text-xl font-semibold tracking-tight text-foreground",
        "bg-transparent outline-none placeholder:text-muted-foreground",
        submitting && "opacity-60 cursor-not-allowed",
        locked && "cursor-default text-foreground/80",
        className
      )}
    />
  );
}

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
   * A title is text, and anything else is a schema this control cannot draw.
   * Coerced rather than passed through, so a misconfigured field cannot put
   * `[object Object]` on screen or hand React a value it refuses — and an
   * empty string keeps the input controlled and editable, where `undefined`
   * would silently make it uncontrolled again and reintroduce the private copy.
   */
  const value = typeof field.value === "string" ? field.value : "";

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

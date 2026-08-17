"use client";

import { Input } from "@nextlyhq/ui";
import { useRef, useState } from "react";
import type { Control, FieldPath } from "react-hook-form";

import { Eye, EyeOff, X } from "@admin/components/icons";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";

import { SettingsRow } from "../SettingsRow";

import {
  isMaskedSecret,
  type ProviderFormValues,
} from "./schemas/emailProviderSchema";

// ============================================================
// Secret Field (password / API key with reveal toggle)
//
// Rendered as a SettingsRow so it visually matches the rest of the
// settings forms (small grey label on the left, control on the right).
// ============================================================

/**
 * A credential input whose stored value is never sent to the browser.
 *
 * The server returns a mask in place of the real value, and the form carries
 * that mask as the field's value: echoing it back is what "leave this alone"
 * means on the wire. Focusing clears it so typing replaces rather than appends,
 * and leaving without typing puts it back — otherwise a glance at the field
 * would turn an untouched credential into an empty one, which for a required
 * credential is a validation error the user did nothing to earn.
 *
 * Whether the current value IS that mask is a question about where it came
 * from, not about how it is spelled. A password of four bullets is
 * character-identical to a mask, so a field reading only its own contents
 * would treat one the user just typed as the server's placeholder and wipe it
 * on the first reveal. `storedSecret` says whether the server sent one, and
 * the field stops trusting it the moment anything is typed.
 */
export function SecretField({
  label,
  placeholder,
  description,
  name,
  control,
  disabled,
  storedSecret,
  clearable,
}: {
  label: string;
  placeholder?: string;
  description?: string;
  name: FieldPath<ProviderFormValues>;
  control: Control<ProviderFormValues>;
  disabled?: boolean;
  /** Whether the server returned a mask for this field — a credential exists. */
  storedSecret: boolean;
  /**
   * Whether removing the stored credential is something the field can express.
   *
   * False for a required credential, where an empty value is a validation
   * error rather than an instruction to the server.
   */
  clearable?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  // Set by the first keystroke and never cleared while the form is open. After
  // it, the value in this field is the user's own — whatever it looks like —
  // so nothing here may treat it as the server's placeholder again.
  const [replaced, setReplaced] = useState(false);
  // The input itself, so revealing can focus it. The reveal button carries
  // `tabIndex={-1}` and therefore never moves focus on its own.
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Whether the field is showing itself as empty so the user can type over the
  // mask. This is a DISPLAY state only — the form still holds the mask — so
  // there is no moment at which an unsubmitted form contains an empty
  // credential the user did not empty.
  const [editing, setEditing] = useState(false);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const currentValue = typeof field.value === "string" ? field.value : "";
        const isMaskedPlaceholder =
          storedSecret && !replaced && isMaskedSecret(currentValue);

        // Offered only over a stored credential, since it is the stored one
        // this removes. Once the field holds something typed, emptying it is
        // already expressible with the keyboard.
        const showClear = clearable === true && isMaskedPlaceholder;

        const helperText = isMaskedPlaceholder
          ? (description ? `${description} ` : "") +
            (showClear
              ? "Existing secret is configured. Focus and type a new value to replace it, or remove it."
              : "Existing secret is configured. Focus and type a new value to replace it.")
          : description;

        // Blanked for TYPING, not for submitting. Focusing shows an empty box
        // so a new credential replaces rather than appends, while the form
        // still holds the mask — so every submit path, including Enter from
        // inside the field and any button that does not move focus first,
        // reads an untouched credential as untouched.
        //
        // Clearing the form value instead needed a restoration on blur, and
        // any submit that did not blur first deleted the credential. Nothing
        // has to be restored now, because nothing was taken away.
        const displayValue = isMaskedPlaceholder && editing ? "" : currentValue;

        return (
          <FormItem className="m-0">
            <SettingsRow label={label} description={helperText}>
              {/* FormControl sits on the Input rather than around this wrapper.
                  It is a Radix Slot, so it clones onto its single child: with
                  the wrapper inside it, the row's id, aria-describedby and
                  aria-invalid all landed on a positioning <div>. A <label for>
                  cannot name a div, so this field had no accessible name and
                  its error was never announced — while the id resolved, so
                  every check short of asking what KIND of element received it
                  reported the field as correctly wired. */}
              <div className="relative">
                <FormControl>
                  <Input
                    {...field}
                    ref={node => {
                      // Both: React Hook Form needs its own ref for focus
                      // management and validation, and the spread above would
                      // otherwise be overwritten by this one.
                      field.ref(node);
                      inputRef.current = node;
                    }}
                    type={visible ? "text" : "password"}
                    placeholder={placeholder}
                    autoComplete="off"
                    className={showClear ? "pr-20" : "pr-10"}
                    disabled={disabled}
                    value={displayValue}
                    onFocus={() => setEditing(true)}
                    onChange={event => {
                      // Any keystroke, including the one that empties the
                      // field, makes what is left the user's decision — and it
                      // is the first moment the FORM stops holding the mask.
                      setReplaced(true);
                      field.onChange(event.target.value);
                    }}
                    onBlur={() => {
                      setEditing(false);
                      field.onBlur();
                    }}
                  />
                </FormControl>
                {showClear && (
                  <button
                    type="button"
                    className="absolute right-10 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive transition-colors"
                    disabled={disabled}
                    onClick={() => {
                      // The keyboard cannot express this. The field shows
                      // itself as empty while the form holds the mask, so
                      // Backspace over the displayed blank changes no value
                      // and fires no `onChange` — leaving an operator who
                      // wants the credential GONE with no gesture that says
                      // so. This is that gesture.
                      setReplaced(true);
                      field.onChange("");
                      // The button is about to stop rendering, so focus has
                      // to be put somewhere deliberate rather than dropped
                      // onto the document.
                      inputRef.current?.focus();
                    }}
                    aria-label="Remove stored value"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  // Disabled with the field, as the clear button beside it
                  // is. Revealing exposes nothing the server did not send,
                  // but the click also focuses the input, so a submitting
                  // form would move the caret into a field it has locked.
                  disabled={disabled}
                  onClick={() => {
                    // A stored secret cannot be revealed — the server never
                    // sent it. Focusing lets the user type a replacement and
                    // watch it as they do; typing nothing leaves the stored
                    // credential exactly as it was.
                    setVisible(current => !current);
                    inputRef.current?.focus();
                  }}
                  aria-label={visible ? "Hide value" : "Show value"}
                >
                  {visible ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <FormMessage className="mt-1.5" />
            </SettingsRow>
          </FormItem>
        );
      }}
    />
  );
}

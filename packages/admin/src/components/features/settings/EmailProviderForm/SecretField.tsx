"use client";

import { Input } from "@nextlyhq/ui";
import { useRef, useState } from "react";
import type { Control, FieldPath } from "react-hook-form";

import { Eye, EyeOff } from "@admin/components/icons";
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
}: {
  label: string;
  placeholder?: string;
  description?: string;
  name: FieldPath<ProviderFormValues>;
  control: Control<ProviderFormValues>;
  disabled?: boolean;
  /** Whether the server returned a mask for this field — a credential exists. */
  storedSecret: boolean;
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

        const helperText = isMaskedPlaceholder
          ? (description ? `${description} ` : "") +
            "Existing secret is configured. Focus and type a new value to replace it."
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
              <FormControl>
                <div className="relative">
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
                    className="pr-10"
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
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
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
              </FormControl>
              <FormMessage className="mt-1.5" />
            </SettingsRow>
          </FormItem>
        );
      }}
    />
  );
}

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
 */
export function SecretField({
  label,
  placeholder,
  description,
  name,
  control,
  disabled,
}: {
  label: string;
  placeholder?: string;
  description?: string;
  name: FieldPath<ProviderFormValues>;
  control: Control<ProviderFormValues>;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  // The mask this field started with, so it can be restored when the user
  // clears it by focusing and leaves without typing anything.
  const storedMask = useRef<string | null>(null);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const currentValue = typeof field.value === "string" ? field.value : "";
        const isMaskedPlaceholder = isMaskedSecret(currentValue);

        const helperText = isMaskedPlaceholder
          ? (description ? `${description} ` : "") +
            "Existing secret is configured. Focus and type a new value to replace it."
          : description;

        const clearMaskForEditing = () => {
          if (isMaskedPlaceholder) {
            storedMask.current = currentValue;
            field.onChange("");
          }
        };

        return (
          <FormItem className="m-0">
            <SettingsRow label={label} description={helperText}>
              <FormControl>
                <div className="relative">
                  <Input
                    {...field}
                    type={visible ? "text" : "password"}
                    placeholder={placeholder}
                    autoComplete="off"
                    className="pr-10"
                    disabled={disabled}
                    value={currentValue}
                    onFocus={clearMaskForEditing}
                    onBlur={() => {
                      // Restore the mask when the field was cleared for editing
                      // and nothing was typed, so an untouched credential stays
                      // untouched.
                      if (storedMask.current !== null && currentValue === "") {
                        field.onChange(storedMask.current);
                      }
                      storedMask.current = null;
                      field.onBlur();
                    }}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => {
                      // A stored secret cannot be revealed — the server never
                      // sent it. Clearing the mask on the first reveal lets the
                      // user type a replacement and watch it as they do.
                      clearMaskForEditing();
                      setVisible(current => !current);
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

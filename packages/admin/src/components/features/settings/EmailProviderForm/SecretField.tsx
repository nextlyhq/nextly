import { Input } from "@revnixhq/ui";
import { useState } from "react";
import { Control, type FieldValues } from "react-hook-form";

import { Eye, EyeOff } from "@admin/components/icons";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";

const MASKED_SECRET = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

// ============================================================
// Secret Field (password / API key with reveal toggle)
// ============================================================

export function SecretField({
  label,
  placeholder,
  description,
  name,
  control,
}: {
  label: string;
  placeholder?: string;
  description?: string;
  name: string;
  control: Control<FieldValues>;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const currentValue = typeof field.value === "string" ? field.value : "";
        const isMaskedPlaceholder =
          currentValue === MASKED_SECRET || /^\*+$/.test(currentValue);

        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <FormControl>
              <div className="relative">
                <Input
                  type={visible ? "text" : "password"}
                  placeholder={placeholder}
                  autoComplete="off"
                  className="pr-10"
                  {...field}
                  onFocus={() => {
                    // Keep existing secret in backend unless user starts editing.
                    // Clearing masked placeholder on focus makes reveal behavior intuitive.
                    if (isMaskedPlaceholder) {
                      field.onChange("");
                    }
                  }}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => {
                    // Existing secrets are masked by backend and cannot be revealed.
                    // On first reveal click in edit mode, clear placeholder so users
                    // can immediately type and view a replacement value.
                    if (isMaskedPlaceholder && !visible) {
                      field.onChange("");
                    }
                    setVisible(v => !v);
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
            {description && <FormDescription>{description}</FormDescription>}
            {isMaskedPlaceholder && (
              <FormDescription>
                Existing secret is configured. Focus and type a new value to
                replace it.
              </FormDescription>
            )}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}

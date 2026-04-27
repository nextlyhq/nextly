import { Input } from "@revnixhq/ui";
import type { Control, type FieldValues } from "react-hook-form";

import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@admin/components/ui/form";

interface ValidationPatternFieldProps {
  control: Control<FieldValues>;
  name?: string;
  placeholder?: string;
  description?: string;
}

/**
 * Reusable Validation Pattern Field Component
 * Used in field editors that support regex pattern validation
 */
export function ValidationPatternField({
  control,
  name = "validation.pattern",
  placeholder = "^[a-zA-Z0-9]+$",
  description = "RegEx pattern for validation (optional)",
}: ValidationPatternFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>Validation Pattern</FormLabel>
          <FormControl>
            <Input {...field} placeholder={placeholder} />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

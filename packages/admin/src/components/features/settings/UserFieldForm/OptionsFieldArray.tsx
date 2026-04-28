"use client";

import { Button, Input } from "@revnixhq/ui";
import { useFieldArray, type UseFormReturn } from "react-hook-form";

import { Plus, Trash2 } from "@admin/components/icons";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";

import {
  generateFieldName,
  type UserFieldFormValues,
} from "./schemas/userFieldSchema";

/** Inline editor for select/radio option pairs */
export function OptionsEditor({
  form,
  disabled,
}: {
  form: UseFormReturn<UserFieldFormValues>;
  disabled?: boolean;
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "options",
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">Options</h3>
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ label: "", value: "" })}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add Option
          </Button>
        )}
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          No options defined. Add at least one option for this field type.
        </p>
      )}

      {fields.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_36px] gap-2 px-1">
            <span className="text-xs text-muted-foreground">Label</span>
            <span className="text-xs text-muted-foreground">Value</span>
            <span />
          </div>
          {fields.map((field, index) => (
            <div
              key={field.id}
              className="grid grid-cols-[1fr_1fr_36px] gap-2 items-start"
            >
              <FormField
                control={form.control}
                name={`options.${index}.label`}
                render={({ field: inputField }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder="Option label"
                        disabled={disabled}
                        {...inputField}
                        onChange={e => {
                          const newLabel = e.target.value;
                          const prevLabel = inputField.value;
                          const currentVal = form.getValues(
                            `options.${index}.value`
                          );
                          const prevAutoVal = generateFieldName(prevLabel);

                          inputField.onChange(newLabel);

                          // Auto-generate value if empty or still matches auto-generated
                          if (!currentVal || currentVal === prevAutoVal) {
                            form.setValue(
                              `options.${index}.value`,
                              generateFieldName(newLabel)
                            );
                          }
                        }}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`options.${index}.value`}
                render={({ field: inputField }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        placeholder="option_value"
                        disabled={disabled}
                        {...inputField}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  className="mt-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Show validation errors for the options array */}
      <FormField
        control={form.control}
        name="options"
        render={() => (
          <FormItem>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

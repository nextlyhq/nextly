"use client";

import { Button, Input, Switch } from "@nextlyhq/ui";
import type { useForm } from "react-hook-form";
import { useFieldArray } from "react-hook-form";

import { Plus, Trash2 } from "@admin/components/icons";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";

import { BUILT_IN_VARIABLES } from "./sample-data";
import { type TemplateFormValues, type TemplateFormVariable } from "./schema";

// ============================================================
// Rail: Variables tab
// ============================================================

function VariableChip({
  name,
  onInsert,
}: {
  name: string;
  onInsert: (name: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInsert(name)}
      title={`Insert {{${name}}}`}
      // Full-strength foreground on hover so the border state change is perceivable.
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-foreground transition-colors hover:border-foreground hover:bg-muted"
    >
      <Plus className="h-3 w-3 text-muted-foreground" />
      {`{{${name}}}`}
    </button>
  );
}

export function VariablesRail({
  control,
  declared,
  onInsert,
}: {
  control: ReturnType<typeof useForm<TemplateFormValues>>["control"];
  declared: TemplateFormVariable[];
  onInsert: (name: string) => void;
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "variables",
  });
  const builtInNames = new Set(BUILT_IN_VARIABLES.map(v => v.name));
  const declaredNames = declared
    .map(v => v.name)
    .filter(n => n && !builtInNames.has(n));

  return (
    <div className="space-y-5">
      <div>
        <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Insert a variable
        </h4>
        <p className="mb-2 text-xs text-muted-foreground">
          Click to insert at the cursor. Built-in variables are always
          available.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {BUILT_IN_VARIABLES.map(v => (
            <VariableChip key={v.name} name={v.name} onInsert={onInsert} />
          ))}
          {declaredNames.map(n => (
            <VariableChip key={n} name={n} onInsert={onInsert} />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Declared variables
          </h4>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              append({ name: "", description: "", required: false })
            }
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add
          </Button>
        </div>
        {fields.length > 0 ? (
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div
                key={field.id}
                className="rounded-md border border-border bg-muted p-2.5"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1.5">
                    <FormField
                      control={control}
                      name={`variables.${index}.name`}
                      render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormControl>
                            <Input
                              placeholder="variableName"
                              className="h-8 font-mono text-sm"
                              {...f}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={control}
                      name={`variables.${index}.description`}
                      render={({ field: f }) => (
                        <FormItem className="space-y-1">
                          <FormControl>
                            <Input
                              placeholder="Description (optional)"
                              className="h-8 text-sm"
                              {...f}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(index)}
                    aria-label="Remove variable"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <FormField
                  control={control}
                  name={`variables.${index}.required`}
                  render={({ field: f }) => (
                    <FormItem className="mt-2 flex items-center gap-1.5">
                      <FormControl>
                        <Switch
                          checked={f.value}
                          onCheckedChange={f.onChange}
                          className="scale-75"
                        />
                      </FormControl>
                      <FormLabel className="!mt-0 text-xs text-muted-foreground">
                        Required
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            No custom variables. Add one to document what this template expects.
          </p>
        )}
      </div>
    </div>
  );
}

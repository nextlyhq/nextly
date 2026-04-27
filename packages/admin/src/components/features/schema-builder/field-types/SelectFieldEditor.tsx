import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Checkbox,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";
import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";

import { Plus, Trash, GripVertical } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@admin/components/ui/form";
import { createSlugSchema } from "@admin/lib/validation";
import type { SelectFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

// Define schema for select field form
const selectFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  allow_multiple_selection: z.boolean().default(false),
  options: z
    .array(
      z.object({
        label: z.string().min(1, "Option label is required"),
        value: z.string().min(1, "Option value is required"),
      })
    )
    .min(1, "At least one option is required"),
  validation: z
    .object({
      required: z.boolean().default(false),
    })
    .default({ required: false }),
});

type SelectFieldFormValues = z.infer<typeof selectFieldSchema>;

interface SelectFieldEditorProps {
  initialData?: Partial<SelectFieldConfig>;
  onSubmit: (data: Omit<SelectFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Select Field Editor Component
 * Used for configuring select/dropdown field type properties
 */
export function SelectFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: SelectFieldEditorProps) {
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [newOptionValue, setNewOptionValue] = useState("");

  // Create default form values from initial data or empty values
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    allow_multiple_selection: initialData?.allow_multiple_selection || false,
    options: initialData?.options || [],
    validation: {
      required: initialData?.validation?.required || false,
    },
  };

  // Use form with validation
  const form = useForm({
    resolver: zodResolver(selectFieldSchema),
    defaultValues,
  });

  // Get the current options
  const {
    fields: options,
    append,
    remove,
  } = useFieldArray({
    control: form.control,
    name: "options",
    keyName: "id",
  });

  // Add a new option
  const addOption = () => {
    if (newOptionLabel.trim() && newOptionValue.trim()) {
      // Check if value already exists
      const existingOption = options.find(
        opt => opt.value === newOptionValue.trim()
      );
      if (existingOption) {
        // Could show an error message here
        return;
      }

      append({
        label: newOptionLabel.trim(),
        value: newOptionValue.trim(),
      });
      setNewOptionLabel("");
      setNewOptionValue("");
    }
  };

  // Handle form submission
  const handleSubmit = form.handleSubmit((data: SelectFieldFormValues) => {
    // Create field config with form data and the SELECT type
    const fieldConfig: Omit<SelectFieldConfig, "id"> = {
      ...data,
      type: FieldType.SELECT,
    };
    onSubmit(fieldConfig);
  });

  return (
    <Form {...form}>
      <form
        ref={formRef}
        id="field-form"
        onSubmit={(e) => { void handleSubmit(e); }}
        className="space-y-3"
      >
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="w-full rounded-md">
            <TabsTrigger value="basic" className="flex-1">
              Basic
            </TabsTrigger>
            <TabsTrigger value="options" className="flex-1">
              Options
            </TabsTrigger>
            <TabsTrigger value="advanced" className="flex-1">
              Advanced
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 pt-3">
            <div className="grid grid-cols-2 gap-4">
              {/* Display Name */}
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="My Field Label" />
                    </FormControl>
                    <FormDescription>
                      Shown in the content editor interface
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Field ID */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Field ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="my_field_name" />
                    </FormControl>
                    <FormDescription>
                      System identifier (lowercase with underscores)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Allow Multiple Selection */}
            <FormField
              control={form.control}
              name="allow_multiple_selection"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">
                      Allow Multiple Selection
                    </FormLabel>
                    <FormDescription className="text-xs">
                      Users can select multiple options
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="options" className="space-y-4 pt-3">
            <div className="space-y-4">
              <div className="flex flex-col space-y-2">
                <FormLabel>Options</FormLabel>
                <FormDescription>
                  Define the options available for selection
                </FormDescription>
              </div>

              {/* Options Table */}
              {options.length > 0 ? (
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12"></TableHead>
                        <TableHead>Label</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {options.map((option, index: number) => (
                        <TableRow key={option.id}>
                          <TableCell>
                            <GripVertical className="h-4 w-4 text-gray-400" />
                          </TableCell>
                          <TableCell>{option.label}</TableCell>
                          <TableCell>{option.value}</TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => remove(index)}
                              className="h-8 w-8"
                            >
                              <Trash className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center p-4 border rounded-md bg-muted">
                  <p className="text-muted-foreground">No options defined</p>
                </div>
              )}

              {/* Add Option Form */}
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <div>
                  <FormLabel className="text-sm">Label</FormLabel>
                  <Input
                    value={newOptionLabel}
                    onChange={e => setNewOptionLabel(e.target.value)}
                    placeholder="Display Text"
                  />
                </div>
                <div>
                  <FormLabel className="text-sm">Value</FormLabel>
                  <Input
                    value={newOptionValue}
                    onChange={e => setNewOptionValue(e.target.value)}
                    placeholder="Stored Value"
                  />
                </div>
                <Button
                  type="button"
                  onClick={addOption}
                  className="shrink-0"
                  disabled={!newOptionLabel.trim() || !newOptionValue.trim()}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Option
                </Button>
              </div>

              {form.formState.errors.options && (
                <p className="text-sm font-medium text-destructive">
                  {form.formState.errors.options.message}
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 pt-3">
            {/* Required Field */}
            <FormField
              control={form.control}
              name="validation.required"
              render={({ field }) => (
                <FormItem className="flex items-center space-x-2">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm">Required Field</FormLabel>
                    <FormDescription className="text-xs">
                      This field must have a value
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}

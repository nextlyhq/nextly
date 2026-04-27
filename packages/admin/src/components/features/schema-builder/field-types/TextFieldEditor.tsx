import { zodResolver } from "@hookform/resolvers/zod";
import {
  Checkbox,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";
import { type Control, type FieldValues, useForm } from "react-hook-form";
import { z } from "zod";

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
import { TextFieldConfig, FieldType } from "@admin/types/field-types";

import { ValidationPatternField } from "./shared/ValidationPatternField";

// Define schema for text field form
const textFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  validation: z
    .object({
      required: z.boolean().default(false),
      pattern: z.string().optional(),
      min_length: z.number().optional(),
      max_length: z.number().optional(),
    })
    .default({ required: false }),
});

type TextFieldFormValues = z.infer<typeof textFieldSchema>;

interface TextFieldEditorProps {
  initialData?: Partial<TextFieldConfig>;
  onSubmit: (data: Omit<TextFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Text Field Editor Component
 * Used for configuring text field type properties
 */
export function TextFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: TextFieldEditorProps) {
  // Create default form values from initial data or empty values
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    validation: {
      required: initialData?.validation?.required || false,
      pattern: initialData?.validation?.pattern || "",
      min_length: initialData?.validation?.min_length ?? undefined,
      max_length: initialData?.validation?.max_length ?? undefined,
    },
  };

  // Use form with validation
  const form = useForm({
    resolver: zodResolver(textFieldSchema),
    defaultValues,
  });

  // Handle form submission
  const handleSubmit = form.handleSubmit((data: TextFieldFormValues) => {
    // Create field config with form data and the TEXT type
    const fieldConfig: Omit<TextFieldConfig, "id"> = {
      ...data,
      type: FieldType.TEXT,
    };
    onSubmit(fieldConfig);
  });

  return (
    <Form {...form}>
      <form
        ref={formRef}
        id="field-form"
        onSubmit={handleSubmit}
        className="space-y-3"
      >
        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="w-full rounded-md">
            <TabsTrigger value="basic" className="flex-1">
              Basic
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

            {/* Validation Pattern */}
            <ValidationPatternField
              control={form.control as unknown as Control<FieldValues>}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* Minimum Length */}
              <FormField
                control={form.control}
                name="validation.min_length"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Length</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={field.value ?? ""}
                        onChange={e => {
                          const value = e.target.value
                            ? parseInt(e.target.value)
                            : undefined;
                          field.onChange(value);
                        }}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormDescription>
                      Minimum number of characters (optional)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Maximum Length */}
              <FormField
                control={form.control}
                name="validation.max_length"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum Length</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        placeholder="255"
                        value={field.value ?? ""}
                        onChange={e => {
                          const value = e.target.value
                            ? parseInt(e.target.value)
                            : undefined;
                          field.onChange(value);
                        }}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormDescription>
                      Maximum number of characters (optional)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}

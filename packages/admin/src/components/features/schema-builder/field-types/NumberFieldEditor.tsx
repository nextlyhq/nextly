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
import type { NumberFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

import { ValidationPatternField } from "./shared/ValidationPatternField";

// Define schema for number field form
const numberFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  validation: z
    .object({
      required: z.boolean().default(false),
      min: z.number().optional(),
      max: z.number().optional(),
    })
    .default({ required: false }),
});

type NumberFieldFormValues = z.infer<typeof numberFieldSchema>;

interface NumberFieldEditorProps {
  initialData?: Partial<NumberFieldConfig>;
  onSubmit: (data: Omit<NumberFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Number Field Editor Component
 * Used for configuring number field type properties
 */
export function NumberFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: NumberFieldEditorProps) {
  // Create default form values from initial data or empty values
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    validation: {
      required: initialData?.validation?.required || false,
      min: initialData?.validation?.min ?? undefined,
      max: initialData?.validation?.max ?? undefined,
    },
  };

  // Use form with validation
  const form = useForm({
    resolver: zodResolver(numberFieldSchema),
    defaultValues,
  });

  // Handle form submission
  const handleSubmit = form.handleSubmit((data: NumberFieldFormValues) => {
    // Create field config with form data and the NUMBER type
    const fieldConfig: Omit<NumberFieldConfig, "id"> = {
      ...data,
      type: FieldType.NUMBER,
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
              placeholder="^[0-9]+$"
              description="RegEx pattern for number validation (optional)"
            />
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}

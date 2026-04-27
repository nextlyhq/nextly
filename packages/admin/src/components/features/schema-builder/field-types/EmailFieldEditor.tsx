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
import { EmailFieldConfig, FieldType } from "@admin/types/field-types";

import { ValidationPatternField } from "./shared/ValidationPatternField";

// Define schema for email field form
const emailFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  validation: z
    .object({
      required: z.boolean().default(false),
      pattern: z.string().optional(),
      custom_validation: z.boolean().default(true),
    })
    .default({ required: false, custom_validation: true }),
  ui: z
    .object({
      description: z.string().optional(),
      placeholder: z.string().optional(),
    })
    .default({}),
});

type EmailFieldFormValues = z.infer<typeof emailFieldSchema>;

interface EmailFieldEditorProps {
  initialData?: Partial<EmailFieldConfig>;
  onSubmit: (data: Omit<EmailFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Email Field Editor Component
 * Used for configuring email field type properties
 */
export function EmailFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: EmailFieldEditorProps) {
  // Create default form values from initial data or empty values
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    validation: {
      required: initialData?.validation?.required || false,
      pattern: initialData?.validation?.pattern || "",
      custom_validation: initialData?.validation?.custom_validation ?? true,
    },
    ui: {
      description: initialData?.ui?.description || "",
      placeholder: initialData?.ui?.placeholder || "Enter email address",
    },
  };

  // Use form with validation
  const form = useForm({
    resolver: zodResolver(emailFieldSchema),
    defaultValues,
  });

  // Handle form submission
  const handleSubmit = form.handleSubmit((data: EmailFieldFormValues) => {
    // Create field config with form data and the EMAIL type
    const fieldConfig: Omit<EmailFieldConfig, "id"> = {
      ...data,
      type: FieldType.EMAIL,
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
                      <Input {...field} placeholder="Email Address" />
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
                      <Input {...field} placeholder="email_field" />
                    </FormControl>
                    <FormDescription>
                      System identifier (lowercase with underscores)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Description */}
            <FormField
              control={form.control}
              name="ui.description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Enter a valid email address"
                    />
                  </FormControl>
                  <FormDescription>
                    Help text shown below the field
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Placeholder */}
            <FormField
              control={form.control}
              name="ui.placeholder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Placeholder</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="user@example.com" />
                  </FormControl>
                  <FormDescription>
                    Placeholder text shown in the input field
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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

            {/* Email Validation */}
            <FormField
              control={form.control}
              name="validation.custom_validation"
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
                    <FormLabel className="text-sm">Email Validation</FormLabel>
                    <FormDescription className="text-xs">
                      Validate that the input is a proper email format
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />

            {/* Custom Validation Pattern */}
            <ValidationPatternField
              control={form.control as unknown as Control<FieldValues>}
            />
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}

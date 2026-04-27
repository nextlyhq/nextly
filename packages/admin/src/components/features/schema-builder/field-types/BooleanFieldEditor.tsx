import { zodResolver } from "@hookform/resolvers/zod";
import {
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";
import { useForm } from "react-hook-form";
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
import type { BooleanFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

// Define schema for boolean field form
const booleanFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  validation: z
    .object({
      required: z.boolean().default(false),
    })
    .default({ required: false }),
  ui: z
    .object({
      label_position: z.enum(["left", "right"]).default("right"),
      true_label: z.string().default("Yes"),
      false_label: z.string().default("No"),
      display_type: z.enum(["checkbox", "switch"]).default("checkbox"),
      description: z.string().optional(),
      placeholder: z.string().optional(),
    })
    .default({
      label_position: "right",
      true_label: "Yes",
      false_label: "No",
      display_type: "checkbox",
      description: undefined,
      placeholder: undefined,
    }),
});

type BooleanFieldFormValues = z.infer<typeof booleanFieldSchema>;

interface BooleanFieldEditorProps {
  initialData?: Partial<BooleanFieldConfig>;
  onSubmit: (data: Omit<BooleanFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Boolean Field Editor Component
 * Used for configuring boolean field type properties
 */
export function BooleanFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: BooleanFieldEditorProps) {
  // Create default form values from initial data or empty values
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    validation: {
      required: initialData?.validation?.required || false,
    },
    ui: {
      label_position: initialData?.ui?.label_position || "right",
      true_label: initialData?.ui?.true_label || "Yes",
      false_label: initialData?.ui?.false_label || "No",
      display_type: initialData?.ui?.display_type || "checkbox",
      description: initialData?.ui?.description || "",
      placeholder: initialData?.ui?.placeholder || "",
    },
  };

  // Use form with validation
  const form = useForm({
    resolver: zodResolver(booleanFieldSchema),
    defaultValues,
  });

  // Handle form submission
  const handleSubmit = form.handleSubmit((data: BooleanFieldFormValues) => {
    // Create field config with form data and the BOOLEAN type
    const fieldConfig: Omit<BooleanFieldConfig, "id"> = {
      ...data,
      type: FieldType.BOOLEAN,
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
            <TabsTrigger value="display" className="flex-1">
              Display
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

            {/* Description */}
            <FormField
              control={form.control}
              name="ui.description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Optional description..." />
                  </FormControl>
                  <FormDescription>
                    Help text shown below the field
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="display" className="space-y-4 pt-3">
            {/* Display Type */}
            <FormField
              control={form.control}
              name="ui.display_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select display type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="checkbox">Checkbox</SelectItem>
                      <SelectItem value="switch">Switch</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    How the boolean field will be displayed
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Label Position */}
            <FormField
              control={form.control}
              name="ui.label_position"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label Position</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select label position" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="right">Right</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Position of the label relative to the input
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* True Label */}
              <FormField
                control={form.control}
                name="ui.true_label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>True Label</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Yes" />
                    </FormControl>
                    <FormDescription>
                      Label for the true/checked state
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* False Label */}
              <FormField
                control={form.control}
                name="ui.false_label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>False Label</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="No" />
                    </FormControl>
                    <FormDescription>
                      Label for the false/unchecked state
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

            {/* Placeholder */}
            <FormField
              control={form.control}
              name="ui.placeholder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Placeholder</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Optional placeholder text..."
                    />
                  </FormControl>
                  <FormDescription>
                    Placeholder text when no value is selected
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}

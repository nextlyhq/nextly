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
import type { DatePickerFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

// Define schema for date picker field form
const datePickerFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  validation: z
    .object({
      required: z.boolean().default(false),
      min_date: z.string().optional(),
      max_date: z.string().optional(),
    })
    .optional()
    .default({ required: false }),
  date_format: z.enum(["dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"]).optional(),
});

type DatePickerFieldFormValues = z.infer<typeof datePickerFieldSchema>;

interface DatePickerFieldEditorProps {
  initialData?: Partial<DatePickerFieldConfig>;
  onSubmit: (data: Omit<DatePickerFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Date Picker Field Editor Component
 * Used for configuring date picker field properties
 */
export function DatePickerFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: DatePickerFieldEditorProps) {
  // Create default form values from initial data or empty values
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    validation: {
      required: initialData?.validation?.required || false,
      min_date: initialData?.validation?.min_date || "",
      max_date: initialData?.validation?.max_date || "",
    },
    date_format: initialData?.date_format || "yyyy-MM-dd",
  };

  // Use form with validation
  const form = useForm({
    resolver: zodResolver(datePickerFieldSchema),
    defaultValues,
  });

  // Handle form submission
  const handleSubmit = form.handleSubmit((data: DatePickerFieldFormValues) => {
    // Create field config with form data and the DATE_PICKER type
    const fieldConfig: Omit<DatePickerFieldConfig, "id"> = {
      ...data,
      type: FieldType.DATE_PICKER,
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
          <TabsList className="w-full rounded-none">
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
                      <Input {...field} placeholder="Publication Date" />
                    </FormControl>
                    <FormDescription>
                      Label shown in the content editor
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
                      <Input {...field} placeholder="publication_date" />
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
            <div className="space-y-4">
              {/* Required Field */}
              <FormField
                control={form.control}
                name="validation.required"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Required Field</FormLabel>
                      <FormDescription>
                        Make this field mandatory
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              {/* Date Format */}
              <FormField
                control={form.control}
                name="date_format"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date Format</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select date format" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="yyyy-MM-dd">
                          yyyy-MM-dd (2024-01-15)
                        </SelectItem>
                        <SelectItem value="dd/MM/yyyy">
                          dd/MM/yyyy (15/01/2024)
                        </SelectItem>
                        <SelectItem value="MM/dd/yyyy">
                          MM/dd/yyyy (01/15/2024)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Display format for the date picker
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                {/* Minimum Date */}
                <FormField
                  control={form.control}
                  name="validation.min_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minimum Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormDescription>
                        Earliest selectable date (optional)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Maximum Date */}
                <FormField
                  control={form.control}
                  name="validation.max_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maximum Date</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormDescription>
                        Latest selectable date (optional)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}

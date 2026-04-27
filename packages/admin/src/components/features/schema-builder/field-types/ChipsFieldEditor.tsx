import { zodResolver } from "@hookform/resolvers/zod";
import {
  Checkbox,
  Input,
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
import type { ChipsFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

const chipsFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  maxChips: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  validation: z
    .object({
      required: z.boolean().default(false),
    })
    .default({ required: false }),
  ui: z
    .object({
      description: z.string().optional(),
      placeholder: z.string().optional(),
    })
    .default({}),
});

type ChipsFieldFormValues = z.infer<typeof chipsFieldSchema>;

interface ChipsFieldEditorProps {
  initialData?: Partial<ChipsFieldConfig>;
  onSubmit: (data: Omit<ChipsFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Chips Field Editor Component
 * Used for configuring chips field type properties in the Schema Builder
 */
export function ChipsFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: ChipsFieldEditorProps) {
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    maxChips: initialData?.maxChips ?? undefined,
    validation: {
      required: initialData?.validation?.required || false,
    },
    ui: {
      description: initialData?.ui?.description || "",
      placeholder: initialData?.ui?.placeholder || "",
    },
  };

  const form = useForm({
    resolver: zodResolver(chipsFieldSchema),
    defaultValues,
  });

  const handleSubmit = form.handleSubmit((data: ChipsFieldFormValues) => {
    const fieldConfig: Omit<ChipsFieldConfig, "id"> = {
      ...data,
      type: FieldType.CHIPS,
      maxChips: data.maxChips || undefined,
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
                      <Input {...field} placeholder="Tags" />
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
                      <Input {...field} placeholder="tags" />
                    </FormControl>
                    <FormDescription>
                      System identifier (lowercase with underscores)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Max Chips */}
            <FormField
              control={form.control}
              name="maxChips"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Max Chips</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      value={(field.value as number | string | undefined) ?? ""}
                      type="number"
                      min={1}
                      placeholder="Unlimited"
                    />
                  </FormControl>
                  <FormDescription>
                    Maximum number of chips allowed (leave empty for unlimited)
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description */}
            <FormField
              control={form.control}
              name="ui.description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Add tags to categorize..." />
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
                  <FormLabel>Input Placeholder</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Type and press Enter to add"
                    />
                  </FormControl>
                  <FormDescription>
                    Placeholder text for the chip input
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
                      At least one chip must be added
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

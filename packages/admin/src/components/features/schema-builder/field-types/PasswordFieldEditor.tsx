"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Checkbox,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@revnixhq/ui";
import type React from "react";
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
import type { PasswordFieldConfig} from "@admin/types/field-types";
import { FieldType } from "@admin/types/field-types";

import { ValidationPatternField } from "./shared/ValidationPatternField";

// Define schema for password field form
const passwordFieldSchema = z.object({
  name: createSlugSchema(),
  label: z.string().min(1, "Display Name is required"),
  validation: z.object({
    required: z.boolean().default(false),
    pattern: z.string().optional(),
    min_length: z.number().min(1).optional(),
    max_length: z.number().min(1).optional(),
    require_uppercase: z.boolean().default(true),
    require_lowercase: z.boolean().default(true),
    require_numbers: z.boolean().default(true),
    require_special: z.boolean().default(true),
  }), // Removed .default({}) as individual properties have defaults
  ui: z.object({
    description: z.string().optional(),
    placeholder: z.string().optional(),
    show_password_toggle: z.boolean().default(true),
    show_strength_indicator: z.boolean().default(true),
  }), // Removed .default({}) as individual properties have defaults
});

type PasswordFieldFormValues = z.infer<typeof passwordFieldSchema>;

interface PasswordFieldEditorProps {
  initialData?: Partial<PasswordFieldConfig>;
  onSubmit: (data: Omit<PasswordFieldConfig, "id">) => void;
  formRef?: React.RefObject<HTMLFormElement | null>;
}

/**
 * Password Field Editor Component
 * Used for configuring password field type properties
 */
export function PasswordFieldEditor({
  initialData,
  onSubmit,
  formRef,
}: PasswordFieldEditorProps) {
  // Create default form values from initial data or empty values
  const defaultValues = {
    name: initialData?.name || "",
    label: initialData?.label || "",
    validation: {
      required: initialData?.validation?.required || false,
      pattern: initialData?.validation?.pattern || "",
      min_length: initialData?.validation?.min_length || 8,
      max_length: initialData?.validation?.max_length || undefined,
      require_uppercase: initialData?.validation?.require_uppercase ?? true,
      require_lowercase: initialData?.validation?.require_lowercase ?? true,
      require_numbers: initialData?.validation?.require_numbers ?? true,
      require_special: initialData?.validation?.require_special ?? true,
    },
    ui: {
      description: initialData?.ui?.description || "",
      placeholder: initialData?.ui?.placeholder || "Enter password",
      show_password_toggle: initialData?.ui?.show_password_toggle ?? true,
      show_strength_indicator: initialData?.ui?.show_strength_indicator ?? true,
    },
  };

  // Use form with validation
  const form = useForm({
    resolver: zodResolver(passwordFieldSchema),
    defaultValues,
  });

  // Handle form submission
  const handleSubmit = form.handleSubmit((data: PasswordFieldFormValues) => {
    // Create field config with form data and the PASSWORD type
    const fieldConfig: Omit<PasswordFieldConfig, "id"> = {
      ...data,
      type: FieldType.PASSWORD,
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
            <TabsTrigger value="validation" className="flex-1">
              Validation
            </TabsTrigger>
            <TabsTrigger value="advanced" className="flex-1">
              Advanced
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4 pt-3">
            <div className="grid grid-cols-2 gap-4">
              {/* Display Name */}
              <FormField
                control={form.control as unknown as Control<FieldValues>}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Password" />
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
                control={form.control as unknown as Control<FieldValues>}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Field ID</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="password_field" />
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
              control={form.control as unknown as Control<FieldValues>}
              name="ui.description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Enter a secure password" />
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
              control={form.control as unknown as Control<FieldValues>}
              name="ui.placeholder"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Placeholder</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Enter password" />
                  </FormControl>
                  <FormDescription>
                    Placeholder text shown in the input field
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </TabsContent>

          <TabsContent value="validation" className="space-y-4 pt-3">
            {/* Required Field */}
            <FormField
              control={form.control as unknown as Control<FieldValues>}
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

            <div className="grid grid-cols-2 gap-4">
              {/* Minimum Length */}
              <FormField
                control={form.control as unknown as Control<FieldValues>}
                name="validation.min_length"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Length</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        placeholder="8"
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
                      Minimum number of characters
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Maximum Length */}
              <FormField
                control={form.control as unknown as Control<FieldValues>}
                name="validation.max_length"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum Length</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={200}
                        placeholder="64"
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

            {/* Password Requirements */}
            <div className="space-y-4">
              <FormLabel>Password Requirements</FormLabel>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="validation.require_uppercase"
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
                          Require Uppercase
                        </FormLabel>
                        <FormDescription className="text-xs">
                          Must contain A-Z characters
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="validation.require_lowercase"
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
                          Require Lowercase
                        </FormLabel>
                        <FormDescription className="text-xs">
                          Must contain a-z characters
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="validation.require_numbers"
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
                          Require Numbers
                        </FormLabel>
                        <FormDescription className="text-xs">
                          Must contain 0-9 characters
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control as unknown as Control<FieldValues>}
                  name="validation.require_special"
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
                          Require Special Characters
                        </FormLabel>
                        <FormDescription className="text-xs">
                          Must contain !@#$%^&* etc.
                        </FormDescription>
                      </div>
                    </FormItem>
                  )}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4 pt-3">
            {/* UI Options */}
            <div className="space-y-4">
              <FormLabel>UI Options</FormLabel>

              <FormField
                control={form.control as unknown as Control<FieldValues>}
                name="ui.show_password_toggle"
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
                        Show Password Toggle
                      </FormLabel>
                      <FormDescription className="text-xs">
                        Add an eye icon to show/hide password
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control as unknown as Control<FieldValues>}
                name="ui.show_strength_indicator"
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
                        Show Strength Indicator
                      </FormLabel>
                      <FormDescription className="text-xs">
                        Display password strength meter
                      </FormDescription>
                    </div>
                  </FormItem>
                )}
              />
            </div>

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

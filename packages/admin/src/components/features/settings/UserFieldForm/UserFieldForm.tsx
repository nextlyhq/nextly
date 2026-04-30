"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Input,
  Switch,
  Textarea,
} from "@revnixhq/ui";
import { useEffect, useCallback, useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { Info, Loader2, SlidersHorizontal } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import type {
  UserFieldType,
  UserFieldDefinitionRecord,
} from "@admin/services/userFieldsApi";

import { DefaultValueField } from "./DefaultValueField";
import { FieldTypePicker } from "./FieldTypeSelector";
import { OptionsEditor } from "./OptionsFieldArray";
import {
  buildUserFieldSchema,
  DEFAULT_VALUES,
  fieldToFormValues,
  generateFieldName,
  type UserFieldFormValues,
} from "./schemas/userFieldSchema";

// ============================================================
// UserFieldForm Component
// ============================================================

export interface UserFieldFormProps {
  mode: "create" | "edit";
  userField?: UserFieldDefinitionRecord;
  isPending: boolean;
  onSubmit: (values: UserFieldFormValues) => void;
}

export function UserFieldForm({
  mode,
  userField,
  isPending,
  onSubmit,
}: UserFieldFormProps) {
  const isEdit = mode === "edit";
  const isCodeSourced = isEdit && userField?.source === "code";
  const nameTouchedRef = useRef(false);
  const schema = buildUserFieldSchema(mode);

  const form = useForm<UserFieldFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<UserFieldFormValues>,
    defaultValues: userField ? fieldToFormValues(userField) : DEFAULT_VALUES,
  });

  const selectedType = form.watch("type");
  const showOptions = selectedType === "select" || selectedType === "radio";
  const showPlaceholder =
    selectedType === "text" ||
    selectedType === "textarea" ||
    selectedType === "email";

  // Populate form when field data loads in edit mode
  useEffect(() => {
    if (userField && isEdit) {
      form.reset(fieldToFormValues(userField));
    }
  }, [userField, isEdit, form]);

  // Auto-generate field name from label (create mode only)
  const handleLabelChange = useCallback(
    (value: string, onChange: (v: string) => void) => {
      onChange(value);
      if (!isEdit && !nameTouchedRef.current) {
        form.setValue("name", generateFieldName(value), {
          shouldValidate: true,
        });
      }
    },
    [isEdit, form]
  );

  // Reset type-specific fields when switching field type
  const handleTypeChange = useCallback(
    (newType: string) => {
      const current = form.getValues();
      form.reset({
        ...current,
        type: newType as UserFieldType,
        options:
          newType === "select" || newType === "radio" ? current.options : [],
        placeholder:
          newType === "text" || newType === "textarea" || newType === "email"
            ? current.placeholder
            : "",
        defaultValue: "",
      });
    },
    [form]
  );

  return (
    <div className="space-y-6">
      {/* Code-sourced field banner */}
      {isCodeSourced && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Code-defined field</AlertTitle>
          <AlertDescription>
            This field is defined in code (defineConfig) and cannot be edited
            here. To modify it, update your application configuration file.
          </AlertDescription>
        </Alert>
      )}

      {/* Form */}
      <Form {...form}>
        <form
          onSubmit={e => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Page Header */}
            <div className="border-b border-border bg-muted/20 px-6 py-5">
              <div className="flex items-center gap-3">
                <div
                  className="shrink-0 flex items-center justify-center w-9 h-9 rounded-[6px] border border-primary/25 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground/80"
                  style={{
                    borderRadius: "6px",
                    border: "1px solid hsl(var(--primary) / 0.25)",
                  }}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {isEdit
                      ? isCodeSourced
                        ? "View User Field"
                        : "Edit User Field"
                      : "New User Field"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {isEdit
                      ? isCodeSourced
                        ? "This field is defined in your application code"
                        : "Update the user field configuration"
                      : "Add a custom field to user profiles"}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6">
              {/* Two-column layout: Left for form, Right for field type selection */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-16">
                {/* Left Column: Form Fields */}
                <div className="space-y-6">
                  {/* Section: Field Details */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                      Field Details
                    </h3>

                    {/* Label */}
                    <FormField
                      control={form.control}
                      name="label"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Label</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. Phone Number"
                              disabled={isCodeSourced}
                              {...field}
                              onChange={e =>
                                handleLabelChange(
                                  e.target.value,
                                  field.onChange
                                )
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Field Name */}
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Field Name</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="e.g. phone_number"
                              disabled={isCodeSourced}
                              {...field}
                              onChange={e => {
                                field.onChange(e.target.value);
                                if (!isEdit) {
                                  nameTouchedRef.current = true;
                                }
                              }}
                            />
                          </FormControl>
                          <FormDescription>
                            {isEdit
                              ? "Field name for database column"
                              : "Auto-generated from label (snake_case)"}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Description/Additional Info */}
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Description/Additional Info{" "}
                            <span className="text-muted-foreground font-normal">
                              (Optional)
                            </span>
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Helper text or field description (Optional)"
                              className="min-h-20"
                              disabled={isCodeSourced}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Section: Type Configuration (conditional) */}
                  {(showOptions || showPlaceholder) && (
                    <div className="space-y-4">
                      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                        Type Configuration (Dynamically Updates)
                      </h3>

                      {/* Placeholder (text/textarea/email) */}
                      {showPlaceholder && (
                        <FormField
                          control={form.control}
                          name="placeholder"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Placeholder</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="e.g. Enter your phone number"
                                  disabled={isCodeSourced}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      )}

                      {/* Options (select/radio) */}
                      {showOptions && (
                        <OptionsEditor form={form} disabled={isCodeSourced} />
                      )}
                    </div>
                  )}

                  {/* Default Value */}
                  <DefaultValueField form={form} disabled={isCodeSourced} />
                </div>

                {/* Right Column: Field Type Selection */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                    Field Type Selection
                  </h3>
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <FieldTypePicker
                            value={field.value}
                            onChange={val => {
                              field.onChange(val);
                              handleTypeChange(val);
                            }}
                            disabled={isCodeSourced}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                      Field Rules & Default
                    </h3>

                    {/* Field Behavior - Required and Active inline */}
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium text-foreground">
                        Field Behavior
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Required */}
                        <FormField
                          control={form.control}
                          name="required"
                          render={({ field }) => (
                            <FormItem className="flex items-center justify-between rounded-md p-4 border border-primary/25">
                              <div className="space-y-0.5">
                                <FormLabel>Required</FormLabel>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  disabled={isCodeSourced}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        {/* Active */}
                        <FormField
                          control={form.control}
                          name="isActive"
                          render={({ field }) => (
                            <FormItem className="flex items-center justify-between rounded-md p-4 border border-primary/25">
                              <div className="space-y-0.5">
                                <FormLabel>Active</FormLabel>
                              </div>
                              <FormControl>
                                <Switch
                                  checked={field.value}
                                  onCheckedChange={field.onChange}
                                  disabled={isCodeSourced}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Form Actions */}
            {!isCodeSourced && (
              <div className="border-t border-border px-6 py-4 bg-muted/20">
                <div className="flex justify-end gap-3">
                  <Link href={ROUTES.USERS_FIELDS}>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPending}
                    >
                      Cancel
                    </Button>
                  </Link>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {isEdit ? "Updating..." : "Creating..."}
                      </>
                    ) : isEdit ? (
                      "Update Field"
                    ) : (
                      "Create Field"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}

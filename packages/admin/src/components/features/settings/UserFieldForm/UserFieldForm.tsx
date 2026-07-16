"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import { USER_FIELD_TYPE_CATALOG } from "nextly/field-catalog";
import { useEffect, useCallback, useRef } from "react";
import { useForm, type Resolver } from "react-hook-form";

import { FieldTypePicker } from "@admin/components/field-ui";
import { ChevronDown, Info, Loader2 } from "@admin/components/icons";
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
import { OptionsEditor } from "./OptionsFieldArray";
import {
  buildUserFieldSchema,
  DEFAULT_VALUES,
  fieldToFormValues,
  generateFieldName,
  LENGTH_BOUND_TYPES,
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

/** Types that render a placeholder input on the profile form. */
const PLACEHOLDER_TYPES: readonly UserFieldType[] = [
  "text",
  "textarea",
  "email",
  "url",
  "phone",
];

export function UserFieldForm({
  mode,
  userField,
  isPending,
  onSubmit,
}: UserFieldFormProps) {
  const isEdit = mode === "edit";
  const isCodeSourced = isEdit && userField?.source === "code";
  // Name, type, and the multi-value flag identify the backing database
  // column, which the schema reconciler only ever adds to — changing any of
  // them would strand the existing column and its data. The server refuses
  // all three; the form matches it rather than offering an edit that cannot
  // succeed.
  const isIdentityLocked = isEdit || isCodeSourced;
  const nameTouchedRef = useRef(false);
  const schema = buildUserFieldSchema(mode);

  const form = useForm<UserFieldFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<UserFieldFormValues>,
    defaultValues: userField ? fieldToFormValues(userField) : DEFAULT_VALUES,
  });

  const selectedType = form.watch("type");
  const showOptions = selectedType === "select" || selectedType === "radio";
  const showPlaceholder = PLACEHOLDER_TYPES.includes(selectedType);
  const showLengthBounds = LENGTH_BOUND_TYPES.includes(selectedType);
  const showNumberBounds = selectedType === "number";
  const showValidation = showLengthBounds || showNumberBounds;

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

  // Reset type-specific fields when switching field type, so a default or a
  // bound declared for one type never survives into a type it cannot fit.
  const handleTypeChange = useCallback(
    (newType: UserFieldType) => {
      const current = form.getValues();
      form.reset({
        ...current,
        type: newType,
        options:
          newType === "select" || newType === "radio" ? current.options : [],
        hasMany: newType === "select" ? current.hasMany : false,
        placeholder: PLACEHOLDER_TYPES.includes(newType)
          ? current.placeholder
          : "",
        minLength: LENGTH_BOUND_TYPES.includes(newType)
          ? current.minLength
          : "",
        maxLength: LENGTH_BOUND_TYPES.includes(newType)
          ? current.maxLength
          : "",
        minValue: newType === "number" ? current.minValue : "",
        maxValue: newType === "number" ? current.maxValue : "",
        defaultValue: "",
      });
    },
    [form]
  );

  const boundInput = (
    name: "minLength" | "maxLength" | "minValue" | "maxValue",
    label: string
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            {label}{" "}
            <span className="text-muted-foreground font-normal">
              (Optional)
            </span>
          </FormLabel>
          <FormControl>
            <Input
              type="number"
              placeholder="No limit"
              disabled={isCodeSourced}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
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
          <div className="bg-card border border-border rounded-none overflow-hidden">
            {/* Single column: the type governs everything below it, so it is
                the first decision the form asks for. */}
            <div className="mx-auto max-w-3xl space-y-8 p-6">
              {/* Section: Field Type */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  Field Type
                </h3>
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FieldTypePicker
                          entries={USER_FIELD_TYPE_CATALOG}
                          columns={4}
                          value={field.value}
                          onChange={val => {
                            field.onChange(val);
                            handleTypeChange(val);
                          }}
                          disabled={isIdentityLocked}
                        />
                      </FormControl>
                      {isEdit && (
                        <FormDescription>
                          Sets the database column type, so it cannot change
                          once the field exists. Create a new field instead.
                        </FormDescription>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Section: Field Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  Field Details
                </h3>

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
                            handleLabelChange(e.target.value, field.onChange)
                          }
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Field Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. phone_number"
                          disabled={isIdentityLocked}
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
                          ? "Names the database column, so it cannot change once the field exists. Create a new field instead."
                          : "Auto-generated from label (snake_case)"}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Description{" "}
                        <span className="text-muted-foreground font-normal">
                          (Optional)
                        </span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Helper text shown under the input"
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
                    Type Configuration
                  </h3>

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

                  {showOptions && (
                    <OptionsEditor form={form} disabled={isCodeSourced} />
                  )}

                  {selectedType === "select" && (
                    <FormField
                      control={form.control}
                      name="hasMany"
                      render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-none border border-border p-4">
                          <div className="space-y-0.5">
                            <FormLabel>Allow multiple selections</FormLabel>
                            <FormDescription>
                              {isEdit
                                ? "Decides the column type, so it cannot change once the field exists."
                                : "Store a list of values instead of one."}
                            </FormDescription>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              disabled={isIdentityLocked}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {/* Section: Validation (collapsed — Required covers the common case) */}
              {showValidation && (
                <Collapsible>
                  <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-none border border-border p-4 text-left">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                        Validation
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {showLengthBounds
                          ? "Length limits for the value"
                          : "Numeric range for the value"}
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid grid-cols-1 gap-4 border border-t-0 border-border p-4 sm:grid-cols-2">
                      {showLengthBounds && (
                        <>
                          {boundInput("minLength", "Minimum length")}
                          {boundInput("maxLength", "Maximum length")}
                        </>
                      )}
                      {showNumberBounds && (
                        <>
                          {boundInput("minValue", "Minimum value")}
                          {boundInput("maxValue", "Maximum value")}
                        </>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}

              {/* Section: Default Value */}
              <DefaultValueField form={form} disabled={isCodeSourced} />

              {/* Section: Behavior */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  Behavior
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="required"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-none border border-border p-4">
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
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-none border border-border p-4">
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

            {/* Form Actions */}
            {!isCodeSourced && (
              <div className="border-t border-border px-6 py-4 bg-primary/5">
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
                        <Loader2 className="h-4 w-4 animate-spin" />
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

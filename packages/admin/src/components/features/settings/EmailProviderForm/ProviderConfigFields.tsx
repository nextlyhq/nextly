"use client";

import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nextlyhq/ui";
import type { Control, FieldPath } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import type {
  EmailProviderConfigField,
  EmailProviderDescriptor,
} from "@admin/services/emailProviderApi";

import { SettingsRow } from "../SettingsRow";
import { SettingsSection } from "../SettingsSection";

import type { ProviderFormValues } from "./schemas/emailProviderSchema";
import { SecretField } from "./SecretField";

/**
 * Where a descriptor field lives in the form.
 *
 * Field names are dotted PATHS, not keys. Registering `configuration.auth.pass`
 * makes React Hook Form build `{ auth: { pass } }`, which is the shape the
 * provider's own parser reads — a flat `{"auth.pass": …}` would post
 * successfully and fail server-side against a path that looks correct.
 */
export function configFieldPath(
  field: EmailProviderConfigField
): FieldPath<ProviderFormValues> {
  return `configuration.${field.name}`;
}

/**
 * The configuration half of the provider form, rendered from the descriptor.
 *
 * Every control comes from `kind`, which is a closed union, so the switch below
 * is exhaustive and a new kind is a compile error rather than a field that
 * renders as nothing.
 */
export function ProviderConfigFields({
  descriptor,
  control,
  disabled,
}: {
  descriptor: EmailProviderDescriptor;
  control: Control<ProviderFormValues>;
  disabled?: boolean;
}) {
  if (descriptor.configFields.length === 0) return null;

  return (
    <SettingsSection label={`${descriptor.label} Configuration`}>
      {descriptor.configFields.map(field => (
        <ProviderConfigField
          key={field.name}
          field={field}
          control={control}
          disabled={disabled}
        />
      ))}
    </SettingsSection>
  );
}

function ProviderConfigField({
  field,
  control,
  disabled,
}: {
  field: EmailProviderConfigField;
  control: Control<ProviderFormValues>;
  disabled?: boolean;
}) {
  const name = configFieldPath(field);

  if (field.secret === true) {
    return (
      <SecretField
        control={control}
        name={name}
        label={field.label}
        placeholder={field.placeholder}
        description={field.help}
        disabled={disabled}
      />
    );
  }

  return (
    <FormField
      control={control}
      name={name}
      render={({ field: controller }) => (
        <FormItem className="m-0">
          <SettingsRow label={field.label} description={field.help}>
            <FormControl>
              {(() => {
                switch (field.kind) {
                  case "boolean":
                    return (
                      <Switch
                        checked={controller.value === true}
                        onCheckedChange={controller.onChange}
                        disabled={disabled}
                      />
                    );

                  case "number":
                    return (
                      <Input
                        {...controller}
                        type="number"
                        inputMode="decimal"
                        // A native number input applies an implicit step of 1,
                        // and the browser then blocks submission for any value
                        // that does not land on it -- so a provider declaring
                        // a 0.5 rate or timeout could not be saved, even
                        // though the descriptor and the generated schema both
                        // accept it. The descriptor has no step to declare, so
                        // the control must not invent one.
                        step="any"
                        min={field.constraints?.min}
                        max={field.constraints?.max}
                        placeholder={field.placeholder}
                        disabled={disabled}
                        value={
                          typeof controller.value === "number"
                            ? controller.value
                            : ""
                        }
                        // An emptied number input reports NaN. Passed on as an
                        // empty string it reads as "missing" to the schema,
                        // rather than being coerced into the number zero.
                        onChange={event =>
                          controller.onChange(
                            Number.isNaN(event.target.valueAsNumber)
                              ? ""
                              : event.target.valueAsNumber
                          )
                        }
                      />
                    );

                  case "select":
                    return (
                      <Select
                        value={
                          typeof controller.value === "string"
                            ? controller.value
                            : ""
                        }
                        onValueChange={controller.onChange}
                        disabled={disabled}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              field.placeholder ?? "Select an option"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options ?? []).map(option => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    );

                  case "text":
                  case "password":
                    // A `password` kind that is NOT marked secret still hides
                    // its characters, but it is not a stored credential: it is
                    // never masked on read, so it stays an ordinary input
                    // rather than a SecretField.
                    return (
                      <Input
                        {...controller}
                        type={field.kind === "password" ? "password" : "text"}
                        placeholder={field.placeholder}
                        maxLength={field.constraints?.maxLength}
                        autoComplete="off"
                        disabled={disabled}
                        value={
                          typeof controller.value === "string"
                            ? controller.value
                            : ""
                        }
                      />
                    );
                }
              })()}
            </FormControl>
            <FormMessage className="mt-1.5" />
          </SettingsRow>
        </FormItem>
      )}
    />
  );
}

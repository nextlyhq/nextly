"use client";

import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import React from "react";
import type { UseFormReturn } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";

import {
  NO_DEFAULT,
  type UserFieldFormValues,
} from "./schemas/userFieldSchema";

/** Renders the appropriate default value input based on selected field type */
export function DefaultValueField({
  form,
  disabled,
}: {
  form: UseFormReturn<UserFieldFormValues>;
  disabled?: boolean;
}) {
  const fieldType = form.watch("type");
  const options = form.watch("options");

  if (fieldType === "checkbox") {
    return (
      <FormField
        control={form.control}
        name="defaultValue"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Default Value{" "}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </FormLabel>
            <Select
              value={field.value || NO_DEFAULT}
              onValueChange={val =>
                field.onChange(val === NO_DEFAULT ? "" : val)
              }
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="No default" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={NO_DEFAULT}>No default</SelectItem>
                <SelectItem value="true">Checked (true)</SelectItem>
                <SelectItem value="false">Unchecked (false)</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  if ((fieldType === "select" || fieldType === "radio") && options.length > 0) {
    const validOptions = options.filter(o => o.value.trim());
    return (
      <FormField
        control={form.control}
        name="defaultValue"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Default Value{" "}
              <span className="text-muted-foreground font-normal">
                (Optional)
              </span>
            </FormLabel>
            <Select
              value={field.value || NO_DEFAULT}
              onValueChange={val =>
                field.onChange(val === NO_DEFAULT ? "" : val)
              }
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="No default" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value={NO_DEFAULT}>No default</SelectItem>
                {validOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label || o.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  return (
    <FormField
      control={form.control}
      name="defaultValue"
      render={({ field }) => (
        <FormItem>
          <FormLabel>
            Default Value{" "}
            <span className="text-muted-foreground font-normal">
              (Optional)
            </span>
          </FormLabel>
          <FormControl>
            <Input
              type={
                fieldType === "number"
                  ? "number"
                  : fieldType === "date"
                    ? "date"
                    : "text"
              }
              placeholder={fieldType === "date" ? "" : "Enter default value"}
              disabled={disabled}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

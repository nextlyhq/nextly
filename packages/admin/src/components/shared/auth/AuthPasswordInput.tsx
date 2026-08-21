"use client";

import { Input } from "@nextlyhq/ui";
import { useState, type ReactNode } from "react";
import { useFormContext, type FieldValues, type Path } from "react-hook-form";

import { PasswordVisibilityToggle } from "@admin/components/shared/auth/PasswordVisibilityToggle";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";

export interface AuthPasswordInputProps<T extends FieldValues> {
  /** The form field this writes to. */
  name: Path<T>;
  label: string;
  placeholder: string;
  /** Overrides `FormItem`'s default spacing where a screen family needs it. */
  itemClassName?: string;
  /**
   * Rendered between the input and its validation message. One family puts the
   * strength meter here; the other renders it outside the field entirely.
   */
  children?: ReactNode;
}

/**
 * One password box: its label, the input, and the reveal button positioned
 * inside it.
 *
 * `PasswordVisibilityToggle` documents that the field around it owns the
 * `relative` box and leaves room with `pr-10`. That contract was satisfied by
 * four hand-written copies, which is three more than can be kept in agreement —
 * so the pairing lives here, and the toggle now has exactly one caller shape to
 * be positioned by.
 *
 * Reveal state is per-box and belongs to the box: two fields on the same screen
 * reveal independently, and neither the screen nor the group above it has any
 * reason to know which is currently showing.
 *
 * Everything that differs between the screen families — the field name, the
 * label, where the strength meter goes, the item spacing — arrives as a prop,
 * so this stays the same control everywhere it appears.
 */
export function AuthPasswordInput<T extends FieldValues>({
  name,
  label,
  placeholder,
  itemClassName,
  children,
}: AuthPasswordInputProps<T>) {
  const { control } = useFormContext<T>();
  const [visible, setVisible] = useState(false);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={itemClassName}>
          <FormLabel className="text-sm font-medium text-foreground">
            {label}
          </FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                required
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                placeholder={placeholder}
                {...field}
                className="pr-10 h-11 rounded-md border-input"
              />
            </FormControl>
            <PasswordVisibilityToggle
              visible={visible}
              onToggle={() => setVisible(!visible)}
            />
          </div>
          {children}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

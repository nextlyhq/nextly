"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useFormContext } from "react-hook-form";
import { z } from "zod";

import { PasswordStrengthIndicator } from "@admin/components/shared";
import { AuthPasswordInput } from "@admin/components/shared/auth/AuthPasswordInput";
import { passwordSchema } from "@admin/lib/validation";

/**
 * The form shape behind {@link AuthNewPasswordFields}.
 *
 * Three screens declared this object identically, down to the message on the
 * mismatch refinement. It is exported with the fields because the two cannot
 * disagree without the component reading a name the form does not have — a
 * mismatch nothing would catch until someone typed into it.
 */
export const newPasswordFormSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type NewPasswordFormValues = z.infer<typeof newPasswordFormSchema>;

/**
 * The form the three screens drive {@link AuthNewPasswordFields} with.
 *
 * It exists because `mode: "onBlur"` is a decision about when someone is told
 * they got it wrong, and it was written out at every call site — where it could
 * be changed on one screen and not the others. Pairing it with the schema means
 * the fields, the rules and the moment of feedback arrive together.
 */
export function useNewPasswordForm() {
  return useForm<NewPasswordFormValues>({
    resolver: zodResolver(newPasswordFormSchema),
    mode: "onBlur",
    defaultValues: { newPassword: "", confirmPassword: "" },
  });
}

export interface AuthNewPasswordFieldsProps {
  /**
   * The first field's label. "New Password" on the screens that replace an
   * existing password; "Password" where the account has never had one.
   */
  passwordLabel?: string;
}

/**
 * The `newPassword` + `confirmPassword` pair, for the screens where someone
 * chooses a password for an account they already hold: accepting an invite,
 * resetting a password, and setting a first password at forced sign-in.
 *
 * What it owns is the arrangement, not the boxes — those are
 * {@link AuthPasswordInput}. The arrangement is the whole reason this is not
 * the same component as `AuthSignupFields`: here the strength meter goes inside
 * the confirm field above its message, and the items carry tighter spacing.
 * There the meter follows both fields as a sibling. One component with a
 * placement flag would move the meter on whichever screens lost the argument.
 *
 * The form comes from context, so render this inside a `FormProvider` driven by
 * {@link newPasswordFormSchema}.
 */
export function AuthNewPasswordFields({
  passwordLabel = "New Password",
}: AuthNewPasswordFieldsProps) {
  const { watch } = useFormContext<NewPasswordFormValues>();
  const newPasswordValue = watch("newPassword");

  return (
    <>
      <AuthPasswordInput<NewPasswordFormValues>
        name="newPassword"
        label={passwordLabel}
        placeholder="Create a strong password…"
        itemClassName="space-y-1"
      />

      <AuthPasswordInput<NewPasswordFormValues>
        name="confirmPassword"
        label="Confirm Password"
        placeholder="Confirm your password…"
        itemClassName="space-y-1"
      >
        <PasswordStrengthIndicator password={newPasswordValue} />
      </AuthPasswordInput>
    </>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@nextlyhq/ui";
import { useForm, useFormContext } from "react-hook-form";
import { z } from "zod";

import { PasswordStrengthIndicator } from "@admin/components/shared";
import { AuthPasswordInput } from "@admin/components/shared/auth/AuthPasswordInput";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { passwordSchema } from "@admin/lib/validation";

/**
 * The form shape behind {@link AuthSignupFields}.
 *
 * Note the server caps `fullName` at 100 characters and this does not. That is
 * deliberate rather than an oversight to fix here: the two screens post to
 * different endpoints, only one of which enforces a cap, and a client rule the
 * server does not share would reject input the API accepts. A name past the
 * cap is refused by the server with a reason the screen now shows.
 */
export const signupFormSchema = z
  .object({
    // Trim FIRST: zod runs a chain in the order it is written, so a length
    // check placed before the trim measures the untrimmed string — two spaces
    // would clear both minimums and then trim away to an empty name, and a
    // padded single character would clear the two-character rule on padding.
    fullName: z
      .string()
      .trim()
      .min(1, "Full name is required")
      .min(2, "Full name must be at least 2 characters"),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Please enter a valid email address")
      .trim(),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type SignupFormValues = z.infer<typeof signupFormSchema>;

/**
 * The form both account-creation screens drive {@link AuthSignupFields} with.
 * Same reasoning as `useNewPasswordForm`: `mode: "onBlur"` decides when a
 * person is told they got it wrong, and two copies of that can disagree.
 */
export function useSignupForm() {
  return useForm<SignupFormValues>({
    resolver: zodResolver(signupFormSchema),
    mode: "onBlur",
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });
}

/**
 * The body of the two screens that create an account from nothing: first-run
 * setup and sign-up. Full name, email address, a password pair, and the
 * strength meter under them.
 *
 * The two screens were identical here, character for character, and differed
 * only in what they do afterwards — setup posts to `/auth/setup` and hard-
 * navigates so the session cookies and every cache are re-read, sign-up posts
 * to `/auth/register` and routes to the login screen. Those decisions stay with
 * the pages; only the fields moved.
 *
 * This is deliberately NOT {@link AuthNewPasswordFields}. These fields are
 * named `password`/`confirmPassword` rather than `newPassword`, sit inside
 * their own grids, and put the strength meter after both fields instead of
 * inside the second one. Sharing one component between the two shapes would
 * change what one of them renders.
 *
 * The submit button is deliberately left to the callers: theirs have drifted
 * apart and reconciling them is a visible change, not a refactor.
 *
 * Reveal state lives here; the form comes from context, so render this inside a
 * `FormProvider` driven by {@link signupFormSchema}.
 */
export function AuthSignupFields() {
  const { control, watch } = useFormContext<SignupFormValues>();

  const password = watch("password");

  return (
    <>
      <div className="grid grid-cols-1 gap-6">
        <FormField
          control={control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium text-foreground">
                Full Name
              </FormLabel>
              <FormControl>
                <Input
                  required
                  type="text"
                  autoComplete="name"
                  placeholder="Enter your full name…"
                  {...field}
                  className="h-11 rounded-md border-input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium text-foreground">
                Email Address
              </FormLabel>
              <FormControl>
                <Input
                  required
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  placeholder="Enter your email address…"
                  {...field}
                  className="h-11 rounded-md border-input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <AuthPasswordInput<SignupFormValues>
          name="password"
          label="Password"
          placeholder="Create a strong password…"
        />

        <AuthPasswordInput<SignupFormValues>
          name="confirmPassword"
          label="Confirm Password"
          placeholder="Confirm your password…"
        />
      </div>

      <PasswordStrengthIndicator password={password} />
    </>
  );
}

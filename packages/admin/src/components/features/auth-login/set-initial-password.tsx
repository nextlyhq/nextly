"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { ArrowRight, Eye, EyeOff, Loader2 } from "@admin/components/icons";
import { PasswordStrengthIndicator } from "@admin/components/shared";
import { toast } from "@admin/components/ui";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { passwordSchema } from "@admin/lib/validation";

const formSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export interface SetInitialPasswordProps {
  /** The single-purpose token the login response handed back. */
  pendingToken: string;
  /** Called once the password is set and a session has been issued. */
  onDone: () => void;
}

/**
 * Forced first-sign-in password change (ASVS 6.4.1). Shown when login returns
 * `password_change_required`: the account still holds an admin-set password, so
 * no session exists yet. Setting a new password exchanges the pending token for
 * a real session; on success the caller navigates into the app.
 */
export function SetInitialPassword({
  pendingToken,
  onDone,
}: SetInitialPasswordProps) {
  const { api } = useApi();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: { newPassword: "", confirmPassword: "" },
  });

  const newPasswordValue = form.watch("newPassword");

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      const csrfToken = await getCsrfToken();
      await api.public.post("/auth/set-initial-password", {
        pendingToken,
        newPassword: values.newPassword,
        csrfToken,
      });
      onDone();
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | undefined;
      const response = err?.response as Record<string, unknown> | undefined;
      const data = response?.data as Record<string, unknown> | undefined;
      const apiError = data?.error;
      const errorMessage =
        (typeof apiError === "string" ? apiError : undefined) ||
        (typeof (apiError as { message?: unknown } | undefined)?.message ===
        "string"
          ? (apiError as { message: string }).message
          : undefined) ||
        (typeof data?.message === "string" ? data.message : undefined) ||
        "Something went wrong. Please try again.";
      toast.error("Could not set your password", {
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight text-foreground mb-1">
          Set a new password
        </h2>
        <p className="text-sm text-muted-foreground">
          Your account was set up with a temporary password. Choose your own to
          continue.
        </p>
      </div>

      <FormProvider {...form}>
        <form
          onSubmit={e => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-sm font-medium text-foreground">
                  New Password
                </FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      required
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Create a strong password…"
                      {...field}
                      className="pr-10 h-11 rounded-none border-input"
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                    className="absolute cursor-pointer right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-sm font-medium text-foreground">
                  Confirm Password
                </FormLabel>
                <div className="relative">
                  <FormControl>
                    <Input
                      required
                      type={showConfirmPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Confirm your password…"
                      {...field}
                      className="pr-10 h-11 rounded-none border-input"
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={
                      showConfirmPassword ? "Hide password" : "Show password"
                    }
                    className="absolute cursor-pointer right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>

                <PasswordStrengthIndicator password={newPasswordValue} />

                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            size="md"
            type="submit"
            disabled={isLoading}
            className="w-full h-11 rounded-none shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100 mt-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <>
                Set Password &amp; Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </FormProvider>
    </div>
  );
}

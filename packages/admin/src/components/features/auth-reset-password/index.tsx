"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { ArrowLeft, ArrowRight, Loader2 } from "@admin/components/icons";
import { PasswordStrengthIndicator } from "@admin/components/shared";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
import { AuthStatusCard } from "@admin/components/shared/auth/AuthStatusCard";
import { PasswordVisibilityToggle } from "@admin/components/shared/auth/PasswordVisibilityToggle";
import { toast } from "@admin/components/ui";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { passwordSchema } from "@admin/lib/validation";
import { resetPassword } from "@admin/services/authApi";

const formSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

interface ResetPasswordProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export function ResetPassword({ searchParams }: ResetPasswordProps) {
  const token =
    typeof searchParams?.token === "string" ? searchParams.token : null;

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  const newPasswordValue = form.watch("newPassword");

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!token) return;

    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();
      await resetPassword(token, values.newPassword, csrfToken);
      setIsSuccess(true);
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | undefined;
      const response = err?.response as Record<string, unknown> | undefined;
      const data = response?.data as Record<string, unknown> | undefined;
      const errorMessage =
        (data?.error as string) ||
        (err?.message as string) ||
        "Something went wrong. Please try again.";

      toast.error("Password reset failed", {
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  }

  // No token in URL show error state
  if (!token) {
    return (
      <AuthStatusCard
        title="Invalid Link"
        description="This password reset link is missing a token. Please request a new password reset link."
      >
        <Link
          href={ROUTES.FORGOT_PASSWORD}
          className="inline-flex items-center text-primary cursor-pointer font-medium transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Request New Link
        </Link>
      </AuthStatusCard>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <AuthStatusCard
        title="Password Reset"
        description="Your password has been reset successfully. You can now sign in with your new password."
      >
        <Link
          href={ROUTES.LOGIN}
          className="inline-flex items-center text-primary cursor-pointer font-medium transition-colors"
        >
          Go to Sign In
          <ArrowRight className="h-4 w-4 ml-2" />
        </Link>
      </AuthStatusCard>
    );
  }

  // Form state
  return (
    <AuthFormCard
      title="Reset Password"
      description="Enter your new password below"
    >
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
                      className="pr-10 h-11 rounded-md border-input"
                    />
                  </FormControl>
                  <PasswordVisibilityToggle
                    visible={showPassword}
                    onToggle={() => setShowPassword(!showPassword)}
                  />
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
                      className="pr-10 h-11 rounded-md border-input"
                    />
                  </FormControl>
                  <PasswordVisibilityToggle
                    visible={showConfirmPassword}
                    onToggle={() =>
                      setShowConfirmPassword(!showConfirmPassword)
                    }
                  />
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
            className="w-full h-11 rounded-md shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100 mt-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <>
                Reset Password
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </FormProvider>

      <div className="mt-8 text-left">
        <p className="text-muted-foreground">
          Remember your password?{" "}
          <Link
            href={ROUTES.LOGIN}
            className="text-primary cursor-pointer font-medium transition-colors"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthFormCard>
  );
}

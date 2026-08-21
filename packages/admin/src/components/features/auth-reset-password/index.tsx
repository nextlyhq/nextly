"use client";

import { Button } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider } from "react-hook-form";

import { ArrowLeft, ArrowRight, Loader2 } from "@admin/components/icons";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
import {
  AuthNewPasswordFields,
  type NewPasswordFormValues,
  useNewPasswordForm,
} from "@admin/components/shared/auth/AuthNewPasswordFields";
import { AuthStatusCard } from "@admin/components/shared/auth/AuthStatusCard";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import { resetPassword } from "@admin/services/authApi";

interface ResetPasswordProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export function ResetPassword({ searchParams }: ResetPasswordProps) {
  const token =
    typeof searchParams?.token === "string" ? searchParams.token : null;

  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useNewPasswordForm();

  async function onSubmit(values: NewPasswordFormValues) {
    if (!token) return;

    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();
      await resetPassword(token, values.newPassword, csrfToken);
      setIsSuccess(true);
    } catch (error: unknown) {
      toast.error("Password reset failed", {
        description: apiErrorMessage(
          error,
          "Something went wrong. Please try again."
        ),
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
          <AuthNewPasswordFields />

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

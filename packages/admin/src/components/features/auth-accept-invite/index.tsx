"use client";

import { Button } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider } from "react-hook-form";

import { ArrowRight, Loader2 } from "@admin/components/icons";
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
import { acceptInvite } from "@admin/services/authApi";

interface AcceptInviteProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export function AcceptInvite({ searchParams }: AcceptInviteProps) {
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
      await acceptInvite(token, values.newPassword, csrfToken);
      setIsSuccess(true);
    } catch (error: unknown) {
      toast.error("Could not set your password", {
        description: apiErrorMessage(
          error,
          "Something went wrong. Please try again."
        ),
      });
    } finally {
      setIsLoading(false);
    }
  }

  // No token in URL — the link is incomplete.
  if (!token) {
    return (
      <AuthStatusCard
        title="Invalid Link"
        description="This invite link is missing its token. Ask whoever invited you to send the link again."
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

  // Success state
  if (isSuccess) {
    return (
      <AuthStatusCard
        title="Account Ready"
        description="Your password is set and your account is active. You can now sign in."
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
      title="Set Your Password"
      description="Choose a password to finish setting up your account"
    >
      <FormProvider {...form}>
        <form
          onSubmit={e => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          <AuthNewPasswordFields passwordLabel="Password" />

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
                Set Password &amp; Continue
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </FormProvider>

      <div className="mt-8 text-left">
        <p className="text-muted-foreground">
          Already have access?{" "}
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

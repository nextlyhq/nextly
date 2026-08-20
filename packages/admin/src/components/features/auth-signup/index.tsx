"use client";

import { Button } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider } from "react-hook-form";

import { ArrowRight, Loader2 } from "@admin/components/icons";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
import {
  AuthSignupFields,
  type SignupFormValues,
  useSignupForm,
} from "@admin/components/shared/auth/AuthSignupFields";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useAppName } from "@admin/context/providers/BrandingProvider";
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ActionResponse } from "@admin/lib/api/response-types";
import { navigateTo } from "@admin/lib/navigation";

export function Signup() {
  const { api } = useApi();
  const appName = useAppName();

  const [isLoading, setIsLoading] = useState(false);

  const form = useSignupForm();

  async function onSubmit(values: SignupFormValues) {
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();
      // Capture the result so the toast can use the server-authored
      // copy (or the silent-success message when conflict-reveal is
      // off).
      const result = await api.public.post<ActionResponse>("/auth/register", {
        name: values.fullName,
        email: values.email,
        password: values.password,
        csrfToken,
      });

      // Prefer the server message; fall back to the friendly string
      // so the toast still works if the server omits the field.
      toast.success(result?.message ?? "Account created successfully!", {
        description: "You can now sign in with your credentials.",
      });
      navigateTo(ROUTES.LOGIN);
    } catch (error) {
      toast.error("Registration failed", {
        description: apiErrorMessage(
          error,
          "Something went wrong. Please try again."
        ),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthFormCard
      title="Create Account"
      description={`Join ${appName} and start managing your content`}
    >
      <FormProvider {...form}>
        <form
          onSubmit={e => {
            void form.handleSubmit(onSubmit)(e);
          }}
          className="space-y-6"
        >
          <AuthSignupFields />

          <Button
            size="md"
            type="submit"
            disabled={isLoading}
            className="w-full h-11 rounded-md shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <>
                Create Account
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </FormProvider>

      <div className="mt-8 text-left">
        <p className="text-muted-foreground">
          Already have an account?{" "}
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

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
import { ROUTES } from "@admin/constants/routes";
import { useAppName } from "@admin/context/providers/BrandingProvider";
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ActionResponse } from "@admin/lib/api/response-types";

export function Setup() {
  const { api } = useApi();
  const appName = useAppName();

  const [isLoading, setIsLoading] = useState(false);

  const form = useSignupForm();

  async function onSubmit(values: SignupFormValues) {
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();

      // Create the admin account (auto-login: server sets access +
      // refresh cookies). Capture the result so the toast can surface
      // the server-authored message.
      const result = await api.public.post<ActionResponse>("/auth/setup", {
        name: values.fullName,
        email: values.email,
        password: values.password,
        csrfToken,
      });

      // Prefer the server message; fall back to the welcome string
      // if the server omits it (defensive shim per spec §9.7).
      toast.success(result?.message ?? "Welcome to " + appName + "!", {
        description: "Your admin account has been created.",
      });

      // Use a full page redirect instead of client-side navigation.
      // This clears all in-memory caches (setup status, session, React Query)
      // and ensures the browser properly processes the session cookies.
      window.location.href = ROUTES.DASHBOARD;
    } catch (error) {
      toast.error("Setup failed", {
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
      title={`Welcome to ${appName}`}
      description="Create your first admin account to get started"
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
            className="w-full h-11 rounded-md shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100 mt-2"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin ml-2" />
            ) : (
              <>
                Create Admin Account
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>
        </form>
      </FormProvider>
    </AuthFormCard>
  );
}

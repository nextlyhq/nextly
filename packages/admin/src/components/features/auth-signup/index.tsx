"use client";

import { Button } from "@nextlyhq/ui";
import type { JSX } from "react";
import { useState } from "react";
import { FormProvider } from "react-hook-form";

import { SignupLoading } from "@admin/components/features/auth-signup-skeleton";
import { ArrowLeft, ArrowRight, Loader2 } from "@admin/components/icons";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
import { AuthRefusalNotice } from "@admin/components/shared/auth/AuthRefusalNotice";
import {
  AuthSignupFields,
  type SignupFormValues,
  useSignupForm,
} from "@admin/components/shared/auth/AuthSignupFields";
import { AuthStatusCard } from "@admin/components/shared/auth/AuthStatusCard";
import { toast } from "@admin/components/ui";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { useAppName } from "@admin/context/providers/BrandingProvider";
import { useApi } from "@admin/hooks/useApi";
import { useAuthRefusal } from "@admin/hooks/useAuthRefusal";
import { useRegistrationOpen } from "@admin/hooks/useSetupStatus";
import { getCsrfToken } from "@admin/lib/api/csrf";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
import type { ActionResponse } from "@admin/lib/api/response-types";
import { navigateTo } from "@admin/lib/navigation";

/**
 * The register page: its form where the app takes sign-ups
 * (`auth.allowRegistration`, off by default), and where it takes none, a
 * card that says so and leads back to sign-in, rather than a form the server
 * refuses once it has been filled in. Until setup-status has answered, the
 * page's loading frame.
 */
export function Signup(): JSX.Element {
  const registrationOpen = useRegistrationOpen();
  if (registrationOpen === undefined) return <SignupLoading />;
  return registrationOpen ? <SignupForm /> : <RegistrationClosed />;
}

/** What the register page says where the app takes no sign-ups. */
function RegistrationClosed(): JSX.Element {
  const appName = useAppName();
  return (
    <AuthStatusCard
      title="Registration Is Closed"
      description={`${appName} doesn't take sign-ups. Ask an administrator for an account.`}
    >
      <Link
        href={ROUTES.LOGIN}
        className="inline-flex items-center text-primary cursor-pointer font-medium transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Sign In
      </Link>
    </AuthStatusCard>
  );
}

function SignupForm(): JSX.Element {
  const { api } = useApi();
  const appName = useAppName();

  const [isLoading, setIsLoading] = useState(false);
  // A refused submission is shown in the form, where it stays while the
  // person acts on it; a toast is kept for every other failure.
  const authRefusal = useAuthRefusal();

  const form = useSignupForm();

  async function onSubmit(values: SignupFormValues) {
    setIsLoading(true);
    authRefusal.clear();

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
      if (authRefusal.take(error)) return;
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
      <AuthRefusalNotice refusal={authRefusal.refusal} />
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

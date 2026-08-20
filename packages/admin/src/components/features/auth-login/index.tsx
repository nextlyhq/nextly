"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { ArrowRight, Loader2, Mail } from "@admin/components/icons";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
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
import { useAppName } from "@admin/context/providers/BrandingProvider";
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import type { ActionResponse } from "@admin/lib/api/response-types";

import { AuthUiExtras, AuthChallenge, useAuthUi } from "./auth-ui-extras";
import { SetInitialPassword } from "./set-initial-password";

const formSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .trim(),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
});

export function Login() {
  const { api } = useApi();
  const appName = useAppName();

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  // Auth-page UI contributed by plugins (provider buttons, slots, 2FA views) — D57.
  const authUi = useAuthUi();
  // Set when a login returns a multi-step challenge (D71); shows the challenge view.
  const [challenge, setChallenge] = useState<{
    challengeType: string;
    pendingToken: string;
  } | null>(null);
  // Set when login returns password_change_required (ASVS 6.4.1): the account
  // holds an admin-set password and must replace it before a session is issued.
  const [mustChangePassword, setMustChangePassword] = useState<{
    pendingToken: string;
  } | null>(null);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();

      // POST to custom auth login endpoint. Capture the result so the
      // toast can surface the server-authored message.
      const result = await api.public.post<
        ActionResponse & {
          status?: string;
          challengeType?: string;
          pendingToken?: string;
        }
      >("/auth/login", {
        email: values.email,
        password: values.password,
        csrfToken,
      });

      // Multi-step auth (D71): the server paused login pending a challenge
      // (e.g. 2FA). Render the challenge view instead of completing the login.
      if (
        result?.status === "challenge" &&
        result.challengeType &&
        result.pendingToken
      ) {
        setChallenge({
          challengeType: result.challengeType,
          pendingToken: result.pendingToken,
        });
        setIsLoading(false);
        return;
      }

      // Forced first-sign-in password change (ASVS 6.4.1): no session was
      // issued. Show the set-password view; setting it issues the session.
      if (
        result?.status === "password_change_required" &&
        result.pendingToken
      ) {
        setMustChangePassword({ pendingToken: result.pendingToken });
        setIsLoading(false);
        return;
      }

      // Prefer `result.message` from the server; fall back to a
      // hard-coded string if the server omits it (defensive shim per
      // spec §9.7).
      toast.success(result?.message ?? "Login successful!", {
        description: `Welcome back to ${appName}`,
      });

      // Use full page redirect (not client-side navigateTo) after login.
      // Client-side navigation triggers Radix UI re-renders which cause
      // useInsertionEffect errors, which trigger React Fast Refresh in dev,
      // which remounts PublicRoute, creating an infinite loop.
      window.location.href = ROUTES.DASHBOARD;
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | undefined;
      const response = err?.response as Record<string, unknown> | undefined;
      const data = response?.data as Record<string, unknown> | undefined;
      // Custom auth returns structured errors: { error: { code, message } }
      const errorCode =
        (data?.code as string) ||
        ((data?.error as Record<string, unknown>)?.code as string) ||
        "";
      const errorMessage =
        (data?.message as string) ||
        ((data?.error as Record<string, unknown>)?.message as string) ||
        (err?.message as string) ||
        "";

      if (
        errorCode === "EMAIL_NOT_VERIFIED" ||
        errorMessage === "EmailNotVerified"
      ) {
        setEmailNotVerified(true);
        toast.error("Email not verified", {
          description:
            "Please verify your email address before signing in. Check your inbox for a verification link.",
        });
      } else if (errorCode === "ACCOUNT_LOCKED") {
        setEmailNotVerified(false);
        toast.error("Account locked", {
          description: "Too many failed attempts. Please try again later.",
        });
      } else {
        setEmailNotVerified(false);
        toast.error("Login failed", {
          description: errorMessage || "Invalid email or password.",
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleResendVerification() {
    const email = form.getValues("email");
    if (!email) {
      toast.error("Please enter your email address first.");
      return;
    }
    setResendingVerification(true);
    try {
      const csrfToken = await getCsrfToken();
      // Surface the server-authored message instead of duplicating
      // copy on the client.
      const result = await api.public.post<ActionResponse>(
        "/auth/verify-email/resend",
        { email, csrfToken }
      );
      toast.success(result?.message ?? "Verification email sent", {
        description: "Please check your inbox for the verification link.",
      });
    } catch {
      toast.error("Failed to resend verification email. Please try again.");
    } finally {
      setResendingVerification(false);
    }
  }

  return (
    <AuthFormCard
      title="Welcome Back"
      description={`Sign in to your ${appName} account`}
    >
      {mustChangePassword ? (
        <SetInitialPassword
          pendingToken={mustChangePassword.pendingToken}
          onDone={() => {
            window.location.href = ROUTES.DASHBOARD;
          }}
        />
      ) : challenge ? (
        <AuthChallenge
          authUi={authUi}
          challengeType={challenge.challengeType}
          pendingToken={challenge.pendingToken}
          onResolved={() => {
            window.location.href = ROUTES.DASHBOARD;
          }}
        />
      ) : (
        <>
          <FormProvider {...form}>
            <form
              onSubmit={e => {
                void form.handleSubmit(onSubmit)(e);
              }}
              className="space-y-6"
            >
              {emailNotVerified && (
                <div className="flex items-start gap-3 rounded-lg border border-warning bg-warning/10 p-4 mb-6">
                  <Mail className="h-5 w-5 text-warning mt-0.5 shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-foreground">
                      Email not verified
                    </p>
                    <p className="text-muted-foreground mt-1">
                      Please check your inbox and click the verification link
                      before signing in.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void handleResendVerification();
                      }}
                      disabled={resendingVerification}
                      className="mt-2 text-sm font-medium text-foreground underline underline-offset-2 hover:text-foreground/80 disabled:opacity-50"
                    >
                      {resendingVerification
                        ? "Sending..."
                        : "Resend verification email"}
                    </button>
                  </div>
                </div>
              )}

              <FormField
                control={form.control}
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

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <div className="relative">
                      <FormControl>
                        <Input
                          required
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          placeholder="Enter your password…"
                          {...field}
                          className="pr-10 h-11 rounded-md border-input"
                        />
                      </FormControl>
                      <PasswordVisibilityToggle
                        visible={showPassword}
                        onToggle={() => setShowPassword(!showPassword)}
                      />
                    </div>
                    <div className="flex justify-end">
                      <Link
                        href={ROUTES.FORGOT_PASSWORD}
                        className="text-sm text-primary cursor-pointer transition-colors font-medium mt-1"
                      >
                        Forgot password?
                      </Link>
                    </div>
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
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          </FormProvider>
          {(authUi.providers.length > 0 ||
            authUi.slots.beforeForm.length > 0 ||
            authUi.slots.afterForm.length > 0 ||
            authUi.slots.branding.length > 0) && (
            <div className="mt-6">
              <AuthUiExtras authUi={authUi} />
            </div>
          )}
          <div className="mt-8 text-left">
            <p className="text-muted-foreground">
              Don&apos;t have an account?{" "}
              <Link
                href={ROUTES.REGISTER}
                className="text-primary cursor-pointer font-medium transition-colors"
              >
                Sign up
              </Link>
            </p>
          </div>
        </>
      )}
    </AuthFormCard>
  );
}

"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "@revnixhq/ui";
import { useState, useEffect } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import {
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  Mail,
} from "@admin/components/icons";
import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
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
import { useBranding } from "@admin/context/providers/BrandingProvider";
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import type { ActionResponse } from "@admin/lib/api/response-types";
import { cn } from "@admin/lib/utils";

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
  const branding = useBranding();
  const appName = branding.logoText ?? "Nextly";

  const [showPassword, setShowPassword] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailNotVerified, setEmailNotVerified] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
      password: "",
    },
  });

  useEffect(() => {
    setIsVisible(true);
  }, []);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();

      // POST to custom auth login endpoint (replaces Auth.js callback).
      // Phase 4 (Task 21): the login handler now emits a canonical
      // `respondAction("Logged in.", { user, accessToken, ... })` body;
      // capture the result so the toast can surface the server-authored
      // message rather than hard-coding copy on the client.
      const result = await api.public.post<ActionResponse>("/auth/login", {
        email: values.email,
        password: values.password,
        csrfToken,
      });

      // Phase 4 (Task 21): prefer `result.message` from the server; fall
      // back to a friendly hard-coded string if the server omits it for
      // any reason (defensive shim per spec §9.7).
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
      // Phase 4 (Task 21): verify-email/resend handler emits
      // `respondAction("Verification email sent.")`; surface that
      // server-authored message instead of duplicating the copy here.
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
    <div className="w-full max-w-[480px] mx-auto">
      <Card
        className={cn(
          "transition-all duration-300 ease-in-out border-primary/5 dark:border-primary/5 shadow-none p-2 sm:p-4 md:p-6",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}
      >
        <CardHeader className="space-y-1 pb-10 pt-8" noBorder>
          {/* Logo */}
          <div className="flex items-center justify-start mb-10 transition-opacity duration-300">
            <div className="inline-flex items-center justify-center w-12 h-12 overflow-hidden">
              <ThemeAwareLogo
                alt={appName}
                className="w-full h-full object-contain"
              />
            </div>
          </div>
          <div>
            <CardTitle className="text-xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
              Welcome Back
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Sign in to your {appName} account
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pb-10">
          <FormProvider {...form}>
            <form
              onSubmit={e => {
                void form.handleSubmit(onSubmit)(e);
              }}
              className="space-y-6"
            >
              {emailNotVerified && (
                <div className="flex items-start gap-3 rounded-none  border border-primary/5 border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/50 mb-6">
                  <Mail className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-800 dark:text-amber-200">
                      Email not verified
                    </p>
                    <p className="text-amber-700 dark:text-amber-300 mt-1">
                      Please check your inbox and click the verification link
                      before signing in.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        void handleResendVerification();
                      }}
                      disabled={resendingVerification}
                      className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-200 underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 disabled:opacity-50"
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
                        className="h-11 rounded-none border-primary/5 dark:border-primary/5"
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
                          className="pr-10 h-11 rounded-none border-primary/5 dark:border-primary/5"
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                        className="absolute cursor-pointer right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showPassword ? (
                          <EyeOff className="h-5 w-5" />
                        ) : (
                          <Eye className="h-5 w-5" />
                        )}
                      </button>
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
                className="w-full h-11 rounded-none shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100 mt-2"
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
        </CardContent>
      </Card>
    </div>
  );
}

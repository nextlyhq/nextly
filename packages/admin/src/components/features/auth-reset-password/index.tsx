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
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
} from "@admin/components/icons";
import { PasswordStrengthIndicator } from "@admin/components/shared";
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
import { getCsrfToken } from "@admin/lib/api/csrf";
import { cn } from "@admin/lib/utils";
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
  const branding = useBranding();
  const appName = branding.logoText ?? "Nextly";
  const token =
    typeof searchParams?.token === "string" ? searchParams.token : null;

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
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

  useEffect(() => {
    setIsVisible(true);
  }, []);

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
      <div className="w-full max-w-[480px] mx-auto">
        <Card className="transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-10 opacity-100">
          <CardHeader className="space-y-1 p-0 mb-8" noBorder>
            <CardTitle className="text-xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
              Invalid Link
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              This password reset link is missing a token. Please request a new
              password reset link.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            <div className="mt-2 text-left">
              <Link
                href={ROUTES.FORGOT_PASSWORD}
                className="inline-flex items-center text-primary cursor-pointer hover-unified font-medium transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Request New Link
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (isSuccess) {
    return (
      <div className="w-full max-w-[480px] mx-auto">
        <Card className="transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-10 opacity-100">
          <CardHeader className="space-y-1 p-0 mb-8" noBorder>
            <CardTitle className="text-xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
              Password Reset
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Your password has been reset successfully. You can now sign in
              with your new password.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            <div className="mt-2 text-left">
              <Link
                href={ROUTES.LOGIN}
                className="inline-flex items-center text-primary cursor-pointer hover-unified font-medium transition-colors"
              >
                Go to Sign In
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Form state
  return (
    <div className="w-full max-w-[480px] mx-auto">
      <Card
        className={cn(
          "transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-2 sm:p-4 md:p-6",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}
      >
        <CardHeader className="space-y-1 pb-10 pt-8" noBorder>
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
              Reset Password
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Enter your new password below
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
                          className="pr-10 h-11 rounded-none border-slate-200 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 dark:border-slate-800"
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
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
                          className="pr-10 h-11 rounded-none border-slate-200 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 dark:border-slate-800"
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() =>
                          setShowConfirmPassword(!showConfirmPassword)
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
                size="lg"
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-none shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100 mt-2"
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
                className="text-primary cursor-pointer hover-unified font-medium transition-colors"
              >
                Sign in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

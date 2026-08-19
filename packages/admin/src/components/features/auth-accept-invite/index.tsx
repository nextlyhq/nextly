"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { ArrowRight, Eye, EyeOff, Loader2 } from "@admin/components/icons";
import { PasswordStrengthIndicator } from "@admin/components/shared";
import { AuthFormCard } from "@admin/components/shared/auth/AuthFormCard";
import { AuthStatusCard } from "@admin/components/shared/auth/AuthStatusCard";
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
import { acceptInvite } from "@admin/services/authApi";

const formSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine(data => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

interface AcceptInviteProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export function AcceptInvite({ searchParams }: AcceptInviteProps) {
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
      await acceptInvite(token, values.newPassword, csrfToken);
      setIsSuccess(true);
    } catch (error: unknown) {
      const err = error as Record<string, unknown> | undefined;
      const response = err?.response as Record<string, unknown> | undefined;
      const data = response?.data as Record<string, unknown> | undefined;
      // `data.error` may be a string or an object (e.g. CSRF failures return
      // `{ code, message }`); pull the message so the toast never renders
      // "[object Object]".
      const apiError = data?.error;
      const apiErrorMessage =
        typeof apiError === "string"
          ? apiError
          : typeof (apiError as { message?: unknown } | undefined)?.message ===
              "string"
            ? (apiError as { message: string }).message
            : undefined;
      const errorMessage =
        apiErrorMessage ||
        (typeof err?.message === "string" ? err.message : undefined) ||
        "Something went wrong. Please try again.";

      toast.error("Could not set your password", {
        description: errorMessage,
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
        <div className="mt-2 text-left">
          <Link
            href={ROUTES.LOGIN}
            className="inline-flex items-center text-primary cursor-pointer font-medium transition-colors"
          >
            Go to Sign In
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </div>
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
        <div className="mt-2 text-left">
          <Link
            href={ROUTES.LOGIN}
            className="inline-flex items-center text-primary cursor-pointer font-medium transition-colors"
          >
            Go to Sign In
            <ArrowRight className="h-4 w-4 ml-2" />
          </Link>
        </div>
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
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem className="space-y-1">
                <FormLabel className="text-sm font-medium text-foreground">
                  Password
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
                      className="pr-10 h-11 rounded-md border-input"
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

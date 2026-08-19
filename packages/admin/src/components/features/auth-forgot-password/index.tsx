"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { ArrowLeft, ArrowRight, Loader2 } from "@admin/components/icons";
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
import { requestPasswordReset } from "@admin/services/authApi";

const formSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .trim(),
});

export function ForgotPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();
      await requestPasswordReset(values.email, csrfToken);
      setIsSubmitted(true);
    } catch {
      toast.error("Something went wrong", {
        description: "Please try again later.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  if (isSubmitted) {
    return (
      <AuthStatusCard
        title="Check Your Email"
        description="If an account with that email exists, we've sent a password reset link. Please check your inbox and spam folder."
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

  return (
    <AuthFormCard
      title="Forgot Password"
      description="Enter your email and we'll send you a reset link"
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
                Send Reset Link
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

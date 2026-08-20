"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Input } from "@nextlyhq/ui";
import { useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";

import { ArrowRight, Loader2 } from "@admin/components/icons";
import { PasswordStrengthIndicator } from "@admin/components/shared";
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
import { ROUTES } from "@admin/constants/routes";
import { useAppName } from "@admin/context/providers/BrandingProvider";
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import type { ActionResponse } from "@admin/lib/api/response-types";
import { passwordSchema } from "@admin/lib/validation";

const formSchema = z
  .object({
    fullName: z
      .string()
      .min(1, "Full name is required")
      .min(2, "Full name must be at least 2 characters")
      .trim(),
    email: z
      .string()
      .min(1, "Email is required")
      .email("Please enter a valid email address")
      .trim(),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export function Setup() {
  const { api } = useApi();
  const appName = useAppName();

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const password = form.watch("password");

  async function onSubmit(values: z.infer<typeof formSchema>) {
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
      const serverError = error as {
        response?: { data?: { error?: string; message?: string } };
        message?: string;
      };
      const errorMessage =
        serverError.response?.data?.error ||
        serverError.response?.data?.message ||
        serverError.message ||
        "Something went wrong. Please try again.";

      toast.error("Setup failed", {
        description: errorMessage,
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
          <div className="grid grid-cols-1 gap-6">
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium text-foreground">
                    Full Name
                  </FormLabel>
                  <FormControl>
                    <Input
                      required
                      type="text"
                      autoComplete="name"
                      placeholder="Enter your full name…"
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
          </div>

          <div className="grid grid-cols-1 gap-6">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
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
                    <PasswordVisibilityToggle
                      visible={showPassword}
                      onToggle={() => setShowPassword(!showPassword)}
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
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
                    <PasswordVisibilityToggle
                      visible={showConfirmPassword}
                      onToggle={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                    />
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <PasswordStrengthIndicator password={password} />

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

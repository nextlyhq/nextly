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

import { ArrowRight, Eye, EyeOff, Loader2 } from "@admin/components/icons";
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
import { useApi } from "@admin/hooks/useApi";
import { getCsrfToken } from "@admin/lib/api/csrf";
import type { ActionResponse } from "@admin/lib/api/response-types";
import { navigateTo } from "@admin/lib/navigation";
import { cn } from "@admin/lib/utils";
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

export function Signup() {
  const { api } = useApi();
  const branding = useBranding();
  const appName = branding.logoText ?? "Nextly";

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
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

  useEffect(() => {
    setIsVisible(true);
  }, []);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      const csrfToken = await getCsrfToken();
      // Phase 4 (Task 21): the register handler emits
      // `respondAction("Account created.", { user })` (or the silent
      // success message when conflict-reveal is off). Capture the
      // result so the toast can use the server-authored copy.
      const result = await api.public.post<ActionResponse>("/auth/register", {
        name: values.fullName,
        email: values.email,
        password: values.password,
        csrfToken,
      });

      // Phase 4 (Task 21): prefer the server message; fall back to the
      // existing friendly string so the toast still works if the server
      // omits the field.
      toast.success(result?.message ?? "Account created successfully!", {
        description: "You can now sign in with your credentials.",
      });
      navigateTo(ROUTES.LOGIN);
    } catch (error) {
      const serverError = error as {
        response?: { data?: { message?: string; error?: string } };
        message?: string;
      };
      const errorMessage =
        serverError.response?.data?.message ||
        serverError.response?.data?.error ||
        serverError.message ||
        "Something went wrong. Please try again.";

      toast.error("Registration failed", {
        description: errorMessage,
      });
    } finally {
      setIsLoading(false);
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
              Create Account
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Join {appName} and start managing your content
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
                        className="h-11 rounded-none border-primary/5 dark:border-primary/5"
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
                          className="pr-10 h-11 rounded-none border-primary/5 dark:border-primary/5"
                        />
                      </FormControl>
                      <button
                        type="button"
                        onClick={() =>
                          setShowConfirmPassword(!showConfirmPassword)
                        }
                        tabIndex={-1}
                        className="absolute cursor-pointer right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="h-5 w-5" />
                        ) : (
                          <Eye className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                    <PasswordStrengthIndicator password={password} />
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                size="md"
                type="submit"
                disabled={isLoading}
                className="w-full h-11 rounded-none shadow-none bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98] transition-all duration-100"
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
        </CardContent>
      </Card>
    </div>
  );
}

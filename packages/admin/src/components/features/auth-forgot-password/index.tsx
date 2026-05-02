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

import { ArrowLeft, ArrowRight, Loader2 } from "@admin/components/icons";
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
import { requestPasswordReset } from "@admin/services/authApi";

const formSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .trim(),
});

export function ForgotPassword() {
  const branding = useBranding();
  const appName = branding.logoText ?? "Nextly";

  const [isVisible, setIsVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onBlur",
    defaultValues: {
      email: "",
    },
  });

  useEffect(() => {
    setIsVisible(true);
  }, []);

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
      <div className="w-full max-w-[480px] mx-auto">
        <Card className="transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-10 opacity-100">
          <CardHeader className="space-y-1 p-0 mb-8" noBorder>
            <CardTitle className="text-xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
              Check Your Email
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              If an account with that email exists, we&apos;ve sent a password
              reset link. Please check your inbox and spam folder.
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0">
            <div className="mt-2 text-left">
              <Link
                href={ROUTES.LOGIN}
                className="inline-flex items-center text-primary cursor-pointer hover-unified font-medium transition-colors"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Sign In
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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
              Forgot Password
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Enter your email and we&apos;ll send you a reset link
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
                        className="h-11 rounded-none border-slate-200 focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-0 dark:border-slate-800"
                      />
                    </FormControl>
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

"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@revnixhq/ui";
import { useEffect, useRef, useState } from "react";

import { ArrowLeft, ArrowRight, Loader2 } from "@admin/components/icons";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { verifyEmail } from "@admin/services/authApi";

type VerifyState = "loading" | "success" | "error" | "no-token";

interface VerifyEmailProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

export function VerifyEmail({ searchParams }: VerifyEmailProps) {
  const token =
    typeof searchParams?.token === "string" ? searchParams.token : null;

  const [state, setState] = useState<VerifyState>(
    token ? "loading" : "no-token"
  );
  const [errorMessage, setErrorMessage] = useState("");
  const hasVerified = useRef(false);

  useEffect(() => {
    if (!token || hasVerified.current) return;
    hasVerified.current = true;

    async function verify() {
      if (!token) return;
      try {
        await verifyEmail(token);
        setState("success");
      } catch (error: unknown) {
        const err = error as Record<string, unknown> | undefined;
        const response = err?.response as Record<string, unknown> | undefined;
        const data = response?.data as Record<string, unknown> | undefined;
        const message =
          (data?.error as string) ||
          (err?.message as string) ||
          "This verification link is invalid or has expired.";
        setErrorMessage(message);
        setState("error");
      }
    }

    void verify();
  }, [token]);

  // No token in URL
  if (state === "no-token") {
    return (
      <div className="w-full max-w-[480px] mx-auto">
        <Card className="transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-10 opacity-100">
          <CardHeader className="space-y-1 p-0 mb-8" noBorder>
            <CardTitle className="text-3xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
              Invalid Link
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              This verification link is missing a token. If you need to verify
              your email, please check your inbox for the original verification
              email.
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

  // Loading state
  if (state === "loading") {
    return (
      <div className="w-full max-w-[480px] mx-auto">
        <Card className="transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-10 opacity-100">
          <CardHeader className="space-y-1 p-0 mb-8" noBorder>
            <CardTitle className="text-3xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
              Verifying Your Email
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Please wait while we verify your email address...
            </CardDescription>
          </CardHeader>

          <CardContent className="p-0 flex justify-start">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state
  if (state === "success") {
    return (
      <div className="w-full max-w-[480px] mx-auto">
        <Card className="transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-10 opacity-100">
          <CardHeader className="space-y-1 p-0 mb-8" noBorder>
            <CardTitle className="text-3xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
              Email Verified
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Your email has been verified successfully. You can now sign in to
              your account.
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

  // Error state
  return (
    <div className="w-full max-w-[480px] mx-auto">
      <Card className="transition-all duration-300 ease-in-out border-slate-200 dark:border-slate-800 shadow-none p-10 opacity-100">
        <CardHeader className="space-y-1 p-0 mb-8" noBorder>
          <CardTitle className="text-3xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
            Verification Failed
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            {errorMessage ||
              "This verification link is invalid or has expired."}
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

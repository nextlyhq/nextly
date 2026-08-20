"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowLeft, ArrowRight, Loader2 } from "@admin/components/icons";
import { AuthStatusCard } from "@admin/components/shared/auth/AuthStatusCard";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { apiErrorMessage } from "@admin/lib/api/parseApiError";
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
        setErrorMessage(
          apiErrorMessage(
            error,
            "This verification link is invalid or has expired."
          )
        );
        setState("error");
      }
    }

    void verify();
  }, [token]);

  // No token in URL
  if (state === "no-token") {
    return (
      <AuthStatusCard
        title="Invalid Link"
        description="This verification link is missing a token. If you need to verify your email, please check your inbox for the original verification email."
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

  // Loading state
  if (state === "loading") {
    return (
      <AuthStatusCard
        title="Verifying Your Email"
        description="Please wait while we verify your email address..."
      >
        <div className="flex justify-start">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </AuthStatusCard>
    );
  }

  // Success state
  if (state === "success") {
    return (
      <AuthStatusCard
        title="Email Verified"
        description="Your email has been verified successfully. You can now sign in to your account."
      >
        <Link
          href={ROUTES.LOGIN}
          className="inline-flex items-center text-primary cursor-pointer font-medium transition-colors"
        >
          Go to Sign In
          <ArrowRight className="h-4 w-4 ml-2" />
        </Link>
      </AuthStatusCard>
    );
  }

  // Error state
  return (
    <AuthStatusCard title="Verification Failed" description={errorMessage}>
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

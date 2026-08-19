"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@nextlyhq/ui";
import { useEffect, useState, type ReactNode } from "react";

import { ThemeAwareLogo } from "@admin/components/shared/ThemeAwareLogo";
import { useAppName } from "@admin/context/providers/BrandingProvider";
import { cn } from "@admin/lib/utils";

export interface AuthFormCardProps {
  /** The heading, rendered as the card's title. */
  title: ReactNode;
  /** One line under the heading saying what this screen is for. */
  description: ReactNode;
  /** The form. */
  children: ReactNode;
}

/**
 * The card every signed-out screen with a form is drawn in: sign in, sign up,
 * first-run setup, forgot password, reset password, accept invite.
 *
 * The mount fade lives here rather than in each screen because it is the CARD
 * appearing — six copies of the same `isVisible` state could only drift, and a
 * screen that forgot the effect would render at `opacity-0` forever.
 *
 * The logo asks `useAppName` what the product is called rather than spelling
 * the fallback here. Three of these screens interpolate the same name into
 * their own title or description, so a fallback written in this file would sit
 * one line above a different answer written in theirs.
 */
export function AuthFormCard({
  title,
  description,
  children,
}: AuthFormCardProps) {
  const appName = useAppName();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div className="w-full max-w-[480px] mx-auto">
      <Card
        className={cn(
          "transition-all duration-300 ease-in-out border-border-strong shadow-none p-2 sm:p-4 md:p-6",
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
              {title}
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              {description}
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="pb-10">{children}</CardContent>
      </Card>
    </div>
  );
}

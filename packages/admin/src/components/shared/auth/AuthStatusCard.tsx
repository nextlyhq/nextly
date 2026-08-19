"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@nextlyhq/ui";
import { type ReactNode } from "react";

export interface AuthStatusCardProps {
  /** What happened, as a heading: "Email Verified", "Invalid Link". */
  title: ReactNode;
  /** The explanation under it. */
  description: ReactNode;
  /** Where the reader goes next — usually one link, sometimes a spinner. */
  children?: ReactNode;
}

/**
 * The card a signed-out screen shows when there is no form to fill in: a link
 * that was invalid or expired, a verification in progress, a password that was
 * reset, an invite already accepted.
 *
 * Deliberately NOT a variant of `AuthFormCard`. It carries no logo, no mount
 * fade and different padding, and the two are told apart by what they are for
 * rather than by a flag — nine call sites would otherwise share a boolean whose
 * true and false branches have nothing in common.
 */
export function AuthStatusCard({
  title,
  description,
  children,
}: AuthStatusCardProps) {
  return (
    <div className="w-full max-w-[480px] mx-auto">
      <Card className="transition-all duration-300 ease-in-out border-border-strong shadow-none p-10 opacity-100">
        <CardHeader className="space-y-1 p-0 mb-8" noBorder>
          <CardTitle className="text-xl font-bold tracking-tight text-foreground mb-3 text-wrap-balance">
            {title}
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground">
            {description}
          </CardDescription>
        </CardHeader>

        {children ? (
          <CardContent className="p-0">{children}</CardContent>
        ) : null}
      </Card>
    </div>
  );
}

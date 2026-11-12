"use client";

import { useMemo, type JSX } from "react";

import { cn } from "@admin/lib/utils";
import {
  calculatePasswordStrength,
  type PasswordStrength,
} from "@admin/lib/validation";

export interface PasswordStrengthIndicatorProps {
  password: string;
  className?: string;
  helpText?: string;
}

export function PasswordStrengthIndicator({
  password,
  className,
  helpText = "Use 8+ characters with uppercase, lowercase, numbers, and symbols",
}: PasswordStrengthIndicatorProps): JSX.Element | null {
  const strength: PasswordStrength = useMemo(
    () => calculatePasswordStrength(password),
    [password]
  );

  if (!password) return null;

  return (
    <div className={cn("mt-2 space-y-2", className)}>
      <p className="text-xs text-muted-foreground text-left">{helpText}</p>

      {/* Full-strength status borders across the strength tiers so the boundary is perceivable. */}
      <div
        className={cn(
          "p-3 rounded-md  border border-border transition-colors duration-100",
          {
            "bg-danger-surface border-danger-border text-danger-text":
              strength.score <= 2,
            "bg-warning-surface border-warning-border text-warning-text":
              strength.score > 2 && strength.score <= 4,
            "bg-success-surface border-success-border text-success-text":
              strength.score > 4,
          }
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wider">
                Strength: {strength.label}
              </span>
              <span className="text-xs font-mono opacity-60">
                {strength.score}/6
              </span>
            </div>
            <div className="flex gap-1 h-1">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div
                  key={i}
                  className={cn("flex-1", {
                    "bg-danger-solid":
                      strength.score <= 2 && i <= strength.score,
                    "bg-warning-solid":
                      strength.score > 2 &&
                      strength.score <= 4 &&
                      i <= strength.score,
                    "bg-success-solid":
                      strength.score > 4 && i <= strength.score,
                    "bg-muted": i > strength.score,
                  })}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

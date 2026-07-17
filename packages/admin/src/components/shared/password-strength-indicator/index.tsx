"use client";

import { useMemo } from "react";

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
}: PasswordStrengthIndicatorProps) {
  const strength: PasswordStrength = useMemo(
    () => calculatePasswordStrength(password),
    [password]
  );

  if (!password) return null;

  return (
    <div className={cn("mt-2 space-y-2", className)}>
      <p className="text-xs text-muted-foreground text-left">{helpText}</p>

      <div
        className={cn(
          "p-3 rounded-none  border border-border transition-colors duration-100",
          {
            "bg-destructive-500/5 border-destructive text-destructive-900 dark:text-destructive-200":
              strength.score <= 2,
            "bg-warning-500/5 border-warning text-warning-900 dark:text-warning-200":
              strength.score > 2 && strength.score <= 4,
            "bg-success-500/5 border-success text-success-900 dark:text-success-200":
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
              <span className="text-[10px] font-mono opacity-60">
                {strength.score}/6
              </span>
            </div>
            <div className="flex gap-1 h-1">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div
                  key={i}
                  className={cn("flex-1", {
                    "bg-destructive-500":
                      strength.score <= 2 && i <= strength.score,
                    "bg-warning-500":
                      strength.score > 2 &&
                      strength.score <= 4 &&
                      i <= strength.score,
                    "bg-success-500": strength.score > 4 && i <= strength.score,
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

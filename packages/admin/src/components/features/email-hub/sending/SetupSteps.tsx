"use client";

import { Badge, Label, RadioGroup, RadioGroupItem } from "@nextlyhq/ui";
import { type JSX, useId } from "react";

import { Terminal } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type { EmailProviderDescriptor } from "@admin/services/emailProviderApi";

import { LOG_PROVIDER_TYPE } from "./setup-copy";

/** The setup's step, numbered as the person reads it. */
export type SetupStep = 1 | 2 | 3;

/**
 * The setup's steps, in order, for the admin's shared stepper. Position `n`
 * is step `n + 1`.
 */
export const SETUP_STEPS: ReadonlyArray<{ label: string }> = [
  { label: "Choose" },
  { label: "Connect" },
  { label: "Send a test" },
];

/**
 * The first step: each provider type as a card with one line on what it is.
 * Log is marked as for development, since it delivers nothing.
 */
export function ChooseProvider({
  descriptors,
  value,
  onChange,
}: {
  descriptors: readonly EmailProviderDescriptor[];
  value: string | null;
  onChange: (type: string) => void;
}): JSX.Element {
  const groupId = useId();
  return (
    <RadioGroup
      aria-label="Provider"
      value={value ?? ""}
      onValueChange={onChange}
      className="grid gap-3 md:grid-cols-2"
    >
      {descriptors.map(descriptor => {
        const id = `${groupId}-${descriptor.type}`;
        const isLog = descriptor.type === LOG_PROVIDER_TYPE;
        return (
          <Label
            key={descriptor.type}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border p-4 font-normal",
              value === descriptor.type
                ? "border-foreground ring-1 ring-foreground"
                : "border-border"
            )}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="font-medium">{descriptor.label}</div>
              {descriptor.description && (
                <p className="text-sm text-muted-foreground">
                  {descriptor.description}
                </p>
              )}
              {isLog && (
                <Badge variant="warning">
                  <Terminal className="h-3 w-3" />
                  For development · delivers nothing
                </Badge>
              )}
            </div>
            <RadioGroupItem id={id} value={descriptor.type} />
          </Label>
        );
      })}
    </RadioGroup>
  );
}

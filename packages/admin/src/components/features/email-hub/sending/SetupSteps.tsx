"use client";

import { Badge, Label, RadioGroup, RadioGroupItem } from "@nextlyhq/ui";
import { type JSX, useId } from "react";

import { Check, Terminal } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type { EmailProviderDescriptor } from "@admin/services/emailProviderApi";

import { LOG_PROVIDER_TYPE } from "./setup-copy";

export type SetupStep = 1 | 2 | 3;

const STEPS: ReadonlyArray<{ step: SetupStep; label: string }> = [
  { step: 1, label: "Choose" },
  { step: 2, label: "Connect" },
  { step: 3, label: "Send a test" },
];

/** Where the setup is: each step done, current or still to come. */
export function SetupStepper({ current }: { current: SetupStep }): JSX.Element {
  return (
    <ol aria-label="Steps" className="flex items-center gap-2 text-sm sm:gap-4">
      {STEPS.map(({ step, label }, index) => {
        const done = step < current;
        const active = step === current;
        return (
          <li
            key={step}
            className="flex min-w-0 flex-1 items-center gap-2"
            aria-current={active ? "step" : undefined}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                done || active
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground"
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : step}
            </span>
            <span
              className={cn(
                "truncate",
                active ? "font-medium" : "text-muted-foreground"
              )}
            >
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {index < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="hidden h-px flex-1 bg-border sm:block"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

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

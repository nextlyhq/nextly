"use client";

import { Card, CardContent } from "@nextlyhq/ui";
import type React from "react";

import { Mail } from "@admin/components/icons";
import { cn } from "@admin/lib/utils";
import type { EmailProviderDescriptor } from "@admin/services/emailProviderApi";

import { ResendLogo } from "../Resend";
import { SendlayerLogo } from "../Sendlayer";
import { SMTPLogo } from "../SMTP";

/**
 * Logos for the providers this admin ships artwork for.
 *
 * Descriptors carry no icon and should not: an icon is a component or an asset,
 * while a descriptor is JSON crossing to the browser, and a descriptor able to
 * transmit a colour or an image would reopen every hardcoded-asset hole through
 * the server. A contributed provider renders with its own label and the generic
 * mail glyph, which is honest and costs nothing.
 */
/**
 * A `Map`, not an object literal.
 *
 * A provider type is an arbitrary string, so a plugin may legitimately register
 * one called `constructor` or `toString`. Indexing a plain object with that
 * returns an inherited function rather than `undefined`, and React would then
 * try to render it as a component instead of falling back to the mail glyph.
 * A `Map` has no inherited keys to collide with.
 */
const PROVIDER_LOGOS = new Map<
  string,
  React.ComponentType<{ className?: string; "aria-label"?: string }>
>([
  ["smtp", SMTPLogo],
  ["resend", ResendLogo],
  ["sendlayer", SendlayerLogo],
]);

export function ProviderTypePicker({
  descriptors,
  value,
  disabled,
  onChange,
}: {
  descriptors: EmailProviderDescriptor[];
  value: string;
  disabled?: boolean;
  onChange: (type: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {descriptors.map(descriptor => {
        const isSelected = value === descriptor.type;
        const Logo = PROVIDER_LOGOS.get(descriptor.type) ?? Mail;
        const select = () => {
          if (!isSelected && !disabled) onChange(descriptor.type);
        };

        return (
          <Card
            key={descriptor.type}
            variant="interactive"
            // Full-strength foreground on hover so the border state change is
            // perceivable; the ring carries the selected state for anyone who
            // cannot distinguish the border colours.
            className={cn(
              "relative h-20 w-[120px] flex items-center justify-center overflow-hidden transition-colors",
              disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              isSelected
                ? "border-foreground bg-primary/[0.04] ring-1 ring-foreground shadow-sm"
                : "border-input hover:border-foreground opacity-80 hover:opacity-100"
            )}
            onClick={select}
            role="button"
            tabIndex={disabled ? -1 : 0}
            onKeyDown={event => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                select();
              }
            }}
            aria-pressed={isSelected}
            aria-disabled={disabled}
            aria-label={descriptor.label}
            title={descriptor.description}
          >
            <CardContent className="p-3 flex flex-col items-center justify-center gap-1">
              <div className="w-full max-w-[90px] max-h-[36px] flex items-center justify-center">
                <Logo
                  className="max-w-full max-h-full text-foreground"
                  aria-label={`${descriptor.label} logo`}
                />
              </div>
              {/* Named for anything without artwork, so a contributed provider
                  is identifiable rather than three identical envelopes. */}
              {!PROVIDER_LOGOS.has(descriptor.type) && (
                <span className="text-xs text-muted-foreground text-center leading-tight">
                  {descriptor.label}
                </span>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

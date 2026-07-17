"use client";

/**
 * Form Settings Tab
 *
 * Per-form behavior on the canonical settings shape: every control here is
 * consumed somewhere (the submit handler or the confirmation flow) — a
 * setting that does nothing does not get a toggle. Spam controls are
 * per-form OVERRIDES of the plugin's global config: blank means inherit,
 * and the inherited value is shown rather than hidden.
 *
 * @module admin/components/builder/FormSettingsTab
 */

import {
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/ui";
import type React from "react";

import { useFormBuilder } from "../../context/FormBuilderContext";

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 py-2">
      <div className="space-y-1 max-w-xl">
        <Label
          htmlFor={htmlFor}
          className="text-[13px] font-semibold text-foreground tracking-tight"
        >
          {label}
        </Label>
        {description && (
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="shrink-0 flex items-center justify-end min-w-25">
        {children}
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border pb-3">
      <h3 className="text-[16px] font-bold text-foreground tracking-tight">
        {children}
      </h3>
    </div>
  );
}

/**
 * Tri-state override select: inherit from the plugin config (showing the
 * effective value), or force on/off for this form.
 */
function InheritToggle({
  id,
  value,
  inherited,
  onChange,
}: {
  id: string;
  value: boolean | undefined;
  inherited: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  const inheritedLabel =
    inherited === undefined
      ? "Inherit"
      : `Inherit (${inherited ? "on" : "off"})`;
  return (
    <Select
      value={value === undefined ? "inherit" : value ? "on" : "off"}
      onValueChange={selected =>
        onChange(selected === "inherit" ? undefined : selected === "on")
      }
    >
      <SelectTrigger
        id={id}
        className="w-40 bg-transparent border-input dark:bg-muted/50"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">{inheritedLabel}</SelectItem>
        <SelectItem value="on">On</SelectItem>
        <SelectItem value="off">Off</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SpamDefaults {
  honeypot?: boolean;
  recaptchaEnabled?: boolean;
}

interface FormSettingsTabProps {
  /** Plugin-level spam defaults (from builder-config); null while loading. */
  spamDefaults: SpamDefaults | null;
}

export function FormSettingsTab({ spamDefaults }: FormSettingsTabProps) {
  const { settings, updateSettings } = useFormBuilder();

  return (
    <div className="w-full max-w-3xl flex flex-col gap-10">
      {/* Submission */}
      <section>
        <SectionHeading>Submission</SectionHeading>
        <div className="flex flex-col gap-1 pt-2">
          <SettingRow
            label="Submit button text"
            description="Label on the form's primary action button"
            htmlFor="settings-submit-text"
          >
            <Input
              id="settings-submit-text"
              type="text"
              className="w-56"
              value={settings.submitButtonText ?? ""}
              onChange={e =>
                updateSettings({ submitButtonText: e.target.value })
              }
            />
          </SettingRow>

          <SettingRow
            label="Allow multiple submissions"
            description="When off, the same visitor (by IP) can submit this form only once"
            htmlFor="settings-multiple"
          >
            <Switch
              id="settings-multiple"
              checked={settings.allowMultipleSubmissions ?? true}
              onCheckedChange={checked =>
                updateSettings({ allowMultipleSubmissions: checked })
              }
            />
          </SettingRow>
        </div>
      </section>

      {/* After submission */}
      <section>
        <SectionHeading>After submission</SectionHeading>
        <div className="flex flex-col gap-4 pt-4">
          <RadioGroup
            value={settings.confirmationType ?? "message"}
            onValueChange={value =>
              updateSettings({
                confirmationType: value as "message" | "redirect",
              })
            }
            className="flex flex-col gap-3"
          >
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="message"
                id="settings-confirm-message"
                className="mt-0.5"
              />
              <div className="w-full space-y-2">
                <Label htmlFor="settings-confirm-message">Show a message</Label>
                {(settings.confirmationType ?? "message") === "message" && (
                  <Textarea
                    aria-label="Success message"
                    value={settings.successMessage ?? ""}
                    onChange={e =>
                      updateSettings({ successMessage: e.target.value })
                    }
                    rows={3}
                    placeholder="Thank you for your submission!"
                  />
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <RadioGroupItem
                value="redirect"
                id="settings-confirm-redirect"
                className="mt-0.5"
              />
              <div className="w-full space-y-2">
                <Label htmlFor="settings-confirm-redirect">
                  Redirect to a URL
                </Label>
                {settings.confirmationType === "redirect" && (
                  <Input
                    aria-label="Redirect URL"
                    type="url"
                    value={settings.redirectUrl ?? ""}
                    onChange={e =>
                      updateSettings({
                        redirectUrl: e.target.value || undefined,
                      })
                    }
                    placeholder="https://example.com/thanks"
                  />
                )}
              </div>
            </div>
          </RadioGroup>
        </div>
      </section>

      {/* Spam protection */}
      <section>
        <SectionHeading>Spam protection</SectionHeading>
        <div className="flex flex-col gap-1 pt-2">
          <SettingRow
            label="Honeypot"
            description="Invisible trap field for bots. Inherits the plugin default unless overridden here."
            htmlFor="settings-honeypot"
          >
            <InheritToggle
              id="settings-honeypot"
              value={settings.honeypotEnabled}
              inherited={spamDefaults?.honeypot}
              onChange={honeypotEnabled => updateSettings({ honeypotEnabled })}
            />
          </SettingRow>

          <SettingRow
            label="reCAPTCHA"
            description="Challenge-based bot check. Inherits the plugin default unless overridden here."
            htmlFor="settings-captcha"
          >
            <InheritToggle
              id="settings-captcha"
              value={settings.captchaEnabled}
              inherited={spamDefaults?.recaptchaEnabled}
              onChange={captchaEnabled => updateSettings({ captchaEnabled })}
            />
          </SettingRow>

          {settings.captchaEnabled === true && (
            <SettingRow
              label="reCAPTCHA site key"
              description="The client-facing site key for this form"
              htmlFor="settings-captcha-key"
            >
              <Input
                id="settings-captcha-key"
                type="text"
                className="w-72 font-mono"
                value={settings.captchaSiteKey ?? ""}
                onChange={e =>
                  updateSettings({
                    captchaSiteKey: e.target.value || undefined,
                  })
                }
              />
            </SettingRow>
          )}
        </div>
      </section>
    </div>
  );
}

export default FormSettingsTab;

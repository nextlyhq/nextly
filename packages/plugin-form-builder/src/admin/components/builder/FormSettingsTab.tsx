"use client";

import {
  Input,
  Textarea,
  Tabs,
  TabsList,
  TabsTrigger,
  Switch,
} from "@revnixhq/ui";
import React from "react";

import { useFormBuilder } from "../../context/FormBuilderContext";

// ============================================================================
// Helper Components
// ============================================================================

/**
 * SettingRow - A layout component for a single setting with label and description on the left,
 * and the control/input on the right.
 */
function SettingRow({
  label,
  description,
  children,
  className = "",
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-6 py-2 ${className}`}
    >
      <div className="space-y-1 max-w-xl">
        <h4 className="text-[13px] font-semibold text-foreground tracking-tight">
          {label}
        </h4>
        {description && (
          <p className="text-[12px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        )}
      </div>
      <div className="flex-shrink-0 flex items-center justify-end min-w-[100px]">
        {children}
      </div>
    </div>
  );
}

/**
 * FormSettingsTab - Form settings configuration panel
 *
 * Refined for Antigravity standard:
 * - Two-column layout for better space utilization.
 * - Title Case headings with improved hierarchy.
 * - Robust state management for action tabs.
 */
export function FormSettingsTab() {
  const { settings, updateSettings } = useFormBuilder();

  // Handle tab switch for After Submission
  // We check for undefined specifically so empty strings "" are treated as "redirect"
  const currentActionTab =
    settings.redirectUrl !== undefined ? "redirect" : "message";

  return (
    <div className="w-full flex flex-row gap-8">
      {/* Left Column: Submission & After Submission */}
      <div className="w-full flex flex-col gap-8">
        {/* Submission Settings */}
        <section className="mb-12">
          <div className="border-b border-border pb-3">
            <h3 className="text-[16px] font-bold text-foreground tracking-tight">
              Submission Settings
            </h3>
          </div>

          <div className="flex flex-col gap-1">
            <SettingRow
              label="Submit Button Text"
              description="Label on the primary action button"
            >
              <Input
                type="text"
                value={settings.submitButtonText as string | undefined}
                onChange={e =>
                  updateSettings({ submitButtonText: e.target.value })
                }
                placeholder="Submit"
                className="bg-transparent h-8 w-40 text-right pr-2 focus-visible:ring-1 border-border/40 text-[13px]"
              />
            </SettingRow>

            <SettingRow
              label="Show Reset Button"
              description="Lets users clear all fields at once"
            >
              <Switch
                checked={settings.showResetButton as boolean}
                onCheckedChange={(checked: boolean) =>
                  updateSettings({ showResetButton: checked })
                }
              />
            </SettingRow>

            {settings.showResetButton && (
              <SettingRow
                label="Reset Button Text"
                description="Label on the secondary action button"
                className="animate-in fade-in slide-in-from-top-2 duration-300"
              >
                <Input
                  type="text"
                  value={settings.resetButtonText as string | undefined}
                  onChange={e =>
                    updateSettings({ resetButtonText: e.target.value })
                  }
                  placeholder="Reset"
                  className="bg-transparent h-8 w-40 text-right pr-2 focus-visible:ring-1 border-border/40 text-[13px]"
                />
              </SettingRow>
            )}
          </div>
        </section>

        {/* After Submission */}
        <section className="mb-12">
          <div className="border-b border-border pb-3">
            <h3 className="text-[16px] font-bold text-foreground tracking-tight">
              After Submission
            </h3>
          </div>

          <div className="flex flex-col gap-4">
            <SettingRow
              label="Action"
              description="What happens after the form is submitted"
            >
              <Tabs
                value={currentActionTab}
                onValueChange={v => {
                  if (v === "message") {
                    updateSettings({ redirectUrl: undefined });
                  } else if (v === "redirect") {
                    updateSettings({ redirectUrl: "" });
                  }
                }}
              >
                <TabsList className="bg-muted p-1 h-8">
                  <TabsTrigger
                    value="message"
                    className="px-4 py-1 text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    Message
                  </TabsTrigger>
                  <TabsTrigger
                    value="redirect"
                    className="px-4 py-1 text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    Redirect
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </SettingRow>

            {currentActionTab === "message" ? (
              <div className="pt-2 animate-in fade-in duration-300">
                <div className="space-y-1.5 mb-4">
                  <h4 className="text-[13px] font-semibold text-foreground tracking-tight">
                    Confirmation Message
                  </h4>
                  <p className="text-[12px] text-muted-foreground leading-relaxed">
                    Message shown to user after successful submission
                  </p>
                </div>
                <Textarea
                  id="confirmationMessage"
                  value={settings.confirmationMessage as string | undefined}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    updateSettings({ confirmationMessage: e.target.value })
                  }
                  placeholder="Thank you for your submission!"
                  rows={4}
                  className="bg-transparent text-[13px] leading-relaxed w-full border-border/60 focus-visible:ring-1"
                />
              </div>
            ) : (
              <div className="pt-2 animate-in fade-in duration-300">
                <SettingRow
                  label="Redirect URL"
                  description="User will be redirected to this URL after submission"
                >
                  <Input
                    type="url"
                    value={(settings.redirectUrl as string) || ""}
                    onChange={e =>
                      updateSettings({ redirectUrl: e.target.value })
                    }
                    placeholder="https://example.com/thank-you"
                    className="bg-transparent h-8 w-56 text-right pr-2 focus-visible:ring-1 border-border/40 text-[13px]"
                  />
                </SettingRow>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Right Column: Spam Protection & Data Storage */}
      <div className="w-full flex flex-col gap-8">
        {/* Spam Protection */}
        <section>
          <div className="border-b border-border pb-3">
            <h3 className="text-[16px] font-bold text-foreground tracking-tight">
              Spam Protection
            </h3>
          </div>

          <div className="flex flex-col gap-1">
            <SettingRow
              label="Honeypot Field"
              description="Hidden field that silently catches bots"
            >
              <Switch
                checked={settings.honeypotEnabled as boolean}
                onCheckedChange={(checkedValue: boolean) =>
                  updateSettings({ honeypotEnabled: checkedValue })
                }
              />
            </SettingRow>

            <SettingRow
              label="CAPTCHA Challenge"
              description="Human verification before submitting"
            >
              <Switch
                checked={settings.captchaEnabled as boolean}
                onCheckedChange={(checkedValue: boolean) =>
                  updateSettings({ captchaEnabled: checkedValue })
                }
              />
            </SettingRow>
          </div>
        </section>

        {/* Data Storage */}
        <section>
          <div className="border-b border-border pb-3">
            <h3 className="text-[16px] font-bold text-foreground tracking-tight">
              Data Storage
            </h3>
          </div>

          <div className="flex flex-col gap-1">
            <SettingRow
              label="Store Submissions"
              description="Save responses to the database"
            >
              <Switch
                checked={settings.storeSubmissions as boolean}
                onCheckedChange={(checkedValue: boolean) =>
                  updateSettings({ storeSubmissions: checkedValue })
                }
              />
            </SettingRow>

            <SettingRow
              label="Submission Limit"
              description="Max number of entries to store"
            >
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  value={(settings.submissionLimit as number) || ""}
                  onChange={e =>
                    updateSettings({
                      submissionLimit: e.target.value
                        ? parseInt(e.target.value, 10)
                        : undefined,
                    })
                  }
                  placeholder="Unlimited"
                  min={1}
                  className="bg-transparent h-8 w-28 text-right pr-2 focus-visible:ring-1 border-border/40 text-[13px]"
                />
                <span className="text-[12px] text-muted-foreground font-medium">
                  Entries
                </span>
              </div>
            </SettingRow>
          </div>
        </section>
      </div>
    </div>
  );
}

export default FormSettingsTab;

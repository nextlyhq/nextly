"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button, Card, CardContent, Input, Switch } from "@revnixhq/ui";
import { useCallback, useEffect, useMemo } from "react";
import {
  useForm,
  type Control,
  type FieldValues,
  type Resolver,
} from "react-hook-form";

import { AlertTriangle, Loader2, Mail } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@admin/components/ui/form";
import { Link } from "@admin/components/ui/link";
import { ROUTES } from "@admin/constants/routes";
import { cn } from "@admin/lib/utils";
import type {
  EmailProviderRecord,
  EmailProviderType,
} from "@admin/services/emailProviderApi";

import { ResendLogo } from "../Resend";
import { SendlayerLogo } from "../Sendlayer";
import { SMTPLogo } from "../SMTP";

import { ApiKeyConfigFields } from "./ResendProviderFields";
import {
  buildProviderSchema,
  DEFAULT_VALUES,
  providerToFormValues,
  type ProviderFormValues,
} from "./schemas/emailProviderSchema";
import { SmtpConfigFields } from "./SmtpProviderFields";

// ============================================================
// EmailProviderForm Component
// ============================================================

export interface EmailProviderFormProps {
  mode: "create" | "edit";
  provider?: EmailProviderRecord;
  isPending: boolean;
  onSubmit: (values: ProviderFormValues) => void;
}

export function EmailProviderForm({
  mode,
  provider,
  isPending,
  onSubmit,
}: EmailProviderFormProps) {
  const isEdit = mode === "edit";

  const providers = [
    {
      type: "smtp" as const,
      name: "SMTP",
      icon: SMTPLogo,
      description: "Send via your own SMTP server",
    },
    {
      type: "resend" as const,
      name: "Resend",
      icon: ResendLogo,
      description: "Modern email API for developers",
    },
    {
      type: "sendlayer" as const,
      name: "SendLayer",
      icon: SendlayerLogo,
      description: "Reliable email delivery service",
    },
  ];

  const initialType = provider?.type;
  const schema = useMemo(
    () => buildProviderSchema(mode, initialType),
    [mode, initialType]
  );

  const form = useForm<ProviderFormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<ProviderFormValues>,
    defaultValues: provider ? providerToFormValues(provider) : DEFAULT_VALUES,
  });

  const selectedType = form.watch("type");

  // Populate form when provider data loads in edit mode
  useEffect(() => {
    if (provider && isEdit) {
      form.reset(providerToFormValues(provider));
    }
  }, [provider, isEdit, form]);

  // Reset type-specific fields when switching provider type
  const handleTypeChange = useCallback(
    (value: string) => {
      const newType = value as EmailProviderType;
      const current = form.getValues();

      if (newType === "smtp") {
        form.reset({
          ...current,
          type: "smtp",
          smtpHost: "",
          smtpPort: 587,
          smtpSecure: false,
          smtpUsername: "",
          smtpPassword: "",
          apiKey: "",
        });
      } else {
        form.reset({
          ...current,
          type: newType,
          smtpHost: "",
          smtpPort: 587,
          smtpSecure: false,
          smtpUsername: "",
          smtpPassword: "",
          apiKey: "",
        });
      }
    },
    [form]
  );

  return (
    <div className="space-y-6">
      {/* Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Page Header */}
            <div className="border-b border-border bg-muted/20 px-6 py-5">
              <div className="flex items-center gap-3">
                <div
                  className="shrink-0 flex items-center justify-center w-9 h-9 rounded-[6px] border border-primary/25 bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-foreground/80"
                  style={{
                    borderRadius: "6px",
                    border: "1px solid hsl(var(--primary) / 0.25)",
                  }}
                >
                  <Mail className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {isEdit ? "Edit Email Provider" : "New Email Provider"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {isEdit
                      ? "Update the email provider configuration"
                      : "Configure a new email delivery provider"}
                  </p>
                </div>
              </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-[1fr_300px] gap-16">
              {/* Left Column - Form Fields */}
              <div className="p-6 space-y-6">
                {/* Field Identity Section */}
                <div className="space-y-4">
                  <h3 className="text-base font-medium text-foreground">
                    Field Identity
                  </h3>

                  {/* Provider Name */}
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Provider Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. Production SMTP, Resend Primary"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          A friendly name to identify this email provider
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Provider Type Selection (Icon-based Cards) */}
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Provider Type</FormLabel>
                        <div className="flex md:flex-row gap-4 cursor-none">
                          {providers.map(provider => {
                            const isSelected = field.value === provider.type;
                            return (
                              <div
                                key={provider.type}
                                className="flex flex-col space-y-3 w-[120px]"
                              >
                                <Card
                                  variant="interactive"
                                  className={cn(
                                    "relative h-24 flex items-center justify-center overflow-hidden cursor-pointer",
                                    isSelected
                                      ? "border-primary bg-primary/[0.04] ring-1 ring-primary shadow-sm"
                                      : "border-border hover:border-muted-foreground/30 hover:bg-muted/10 opacity-80 hover:opacity-100"
                                  )}
                                  onClick={() => {
                                    if (!isSelected) {
                                      field.onChange(provider.type);
                                      handleTypeChange(provider.type);
                                    }
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={e => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      field.onChange(provider.type);
                                      handleTypeChange(provider.type);
                                    }
                                  }}
                                  aria-pressed={isSelected}
                                >
                                  <CardContent className="p-4 flex items-center justify-center">
                                    <div className="w-full h-full max-w-[90px] max-h-[40px] flex items-center justify-center">
                                      <provider.icon
                                        className="max-w-full max-h-full"
                                        aria-label={`${provider.name} logo`}
                                      />
                                    </div>
                                  </CardContent>
                                </Card>
                              </div>
                            );
                          })}
                        </div>
                        <FormDescription>
                          Select the provider type to match your configuration.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Dynamic Config Fields Based on Type */}
                {selectedType === "smtp" && (
                  <SmtpConfigFields
                    control={form.control as unknown as Control<FieldValues>}
                  />
                )}
                {selectedType === "resend" && (
                  <ApiKeyConfigFields
                    control={form.control as unknown as Control<FieldValues>}
                    providerLabel="Resend"
                  />
                )}
                {selectedType === "sendlayer" && (
                  <ApiKeyConfigFields
                    control={form.control as unknown as Control<FieldValues>}
                    providerLabel="SendLayer"
                  />
                )}

                {/* Sender Information Section */}
                <div className="space-y-4">
                  <h3 className="text-base font-medium text-foreground">
                    Sender Information
                  </h3>

                  <FormField
                    control={form.control}
                    name="fromEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>From Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder={
                              selectedType === "resend"
                                ? "onboarding@resend.dev"
                                : "noreply@example.com"
                            }
                            {...field}
                          />
                        </FormControl>
                        {selectedType === "resend" ||
                        selectedType === "sendlayer" ? (
                          <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                            <span>
                              {selectedType === "resend" ? (
                                <>
                                  Must be an email from a{" "}
                                  <strong>verified domain</strong> in your
                                  Resend account. For testing without a verified
                                  domain, use{" "}
                                  <code className="font-mono bg-amber-100 dark:bg-amber-900/30 px-0.5 rounded">
                                    onboarding@resend.dev
                                  </code>{" "}
                                  (sends only to your Resend account email).
                                </>
                              ) : (
                                <>
                                  Must be an email from a{" "}
                                  <strong>verified domain</strong> in your
                                  SendLayer account.
                                </>
                              )}
                            </span>
                          </div>
                        ) : (
                          <FormDescription>
                            Default sender email address
                          </FormDescription>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="fromName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          From Name{" "}
                          <span className="text-muted-foreground font-normal">
                            (Optional)
                          </span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="My App" {...field} />
                        </FormControl>
                        <FormDescription>
                          Display name shown in the email &quot;From&quot; field
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {/* Right Column - Settings & Actions */}
              <div className="border-l border-border bg-muted/20 p-6 space-y-6">
                {/* GLOBAL ACTIONS & SETTINGS */}
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-primary uppercase tracking-wider bg-primary/10 border border-primary rounded-md px-3 py-2 transition-colors cursor-default">
                    GLOBAL ACTIONS & SETTINGS
                  </h3>
                </div>

                {/* SETTINGS & ACTIONS */}
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    SETTINGS & ACTIONS
                  </h3>

                  {/* Set as Default Provider */}
                  <FormField
                    control={form.control}
                    name="isDefault"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between">
                        <FormLabel className="text-sm font-normal">
                          Set as Default Provider
                        </FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* Test Connection Button */}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    disabled
                  >
                    Test Connection
                  </Button>

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <Link
                      href={ROUTES.SETTINGS_EMAIL_PROVIDERS}
                      className="flex-1"
                    >
                      <Button
                        type="button"
                        variant="outline"
                        disabled={isPending}
                        className="w-full"
                      >
                        Cancel
                      </Button>
                    </Link>
                    <Button
                      type="submit"
                      disabled={isPending}
                      className="flex-1"
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {isEdit ? "Updating..." : "Creating..."}
                        </>
                      ) : isEdit ? (
                        "Update Provider"
                      ) : (
                        "Create Provider"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}

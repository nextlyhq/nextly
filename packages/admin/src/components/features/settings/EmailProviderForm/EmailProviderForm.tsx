"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, Input, Switch } from "@revnixhq/ui";
import { useCallback, useEffect, useMemo } from "react";
import {
  useForm,
  type Control,
  type FieldValues,
  type Resolver,
} from "react-hook-form";

import { AlertTriangle } from "@admin/components/icons";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import { cn } from "@admin/lib/utils";
import type {
  EmailProviderRecord,
  EmailProviderType,
} from "@admin/services/emailProviderApi";

import { ResendLogo } from "../Resend";
import { SendlayerLogo } from "../Sendlayer";
import { SettingsRow } from "../SettingsRow";
import { SettingsSection } from "../SettingsSection";
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
// Form id used by external buttons (e.g. SettingsLayout.actions)
// to submit this form via the `form` attribute.
// ============================================================

export const EMAIL_PROVIDER_FORM_ID = "email-provider-form";

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
    },
    [form]
  );

  return (
    <Form {...form}>
      <form
        id={EMAIL_PROVIDER_FORM_ID}
        onSubmit={e => {
          void form.handleSubmit(onSubmit)(e);
        }}
        className="space-y-6"
        aria-busy={isPending}
      >
        {/* ── Section: Provider Identity ─────────────────────────── */}
        <SettingsSection label="Provider Identity">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="Provider Name"
                  description="A friendly name to identify this email provider."
                >
                  <FormControl>
                    <Input
                      placeholder="e.g. Production SMTP, Resend Primary"
                      autoFocus={!isEdit}
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="Provider Type"
                  description="Select the provider type to match your configuration."
                >
                  <div className="flex flex-wrap gap-3">
                    {providers.map(p => {
                      const isSelected = field.value === p.type;
                      return (
                        <Card
                          key={p.type}
                          variant="interactive"
                          className={cn(
                            "relative h-20 w-[120px] flex items-center justify-center overflow-hidden cursor-pointer transition-colors",
                            isSelected
                              ? "border-foreground bg-primary/[0.04] ring-1 ring-foreground shadow-sm"
                              : "border-input hover:border-foreground/40 opacity-80 hover:opacity-100"
                          )}
                          onClick={() => {
                            if (!isSelected) {
                              field.onChange(p.type);
                              handleTypeChange(p.type);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              field.onChange(p.type);
                              handleTypeChange(p.type);
                            }
                          }}
                          aria-pressed={isSelected}
                          aria-label={p.name}
                        >
                          <CardContent className="p-3 flex items-center justify-center">
                            <div className="w-full h-full max-w-[90px] max-h-[36px] flex items-center justify-center">
                              <p.icon
                                className="max-w-full max-h-full"
                                aria-label={`${p.name} logo`}
                              />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>

        {/* ── Section: Provider-specific configuration ───────────── */}
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

        {/* ── Section: Sender Information ────────────────────────── */}
        <SettingsSection label="Sender Information">
          <FormField
            control={form.control}
            name="fromEmail"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="From Email"
                  description={
                    selectedType === "resend" ? (
                      <span className="flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
                        <span>
                          Must be an email from a{" "}
                          <strong>verified domain</strong> in your Resend
                          account. For testing without a verified domain, use{" "}
                          <code className="font-mono">
                            onboarding@resend.dev
                          </code>{" "}
                          (sends only to your Resend account email).
                        </span>
                      </span>
                    ) : selectedType === "sendlayer" ? (
                      <span className="flex items-start gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-500" />
                        <span>
                          Must be an email from a{" "}
                          <strong>verified domain</strong> in your SendLayer
                          account.
                        </span>
                      </span>
                    ) : (
                      "Default sender email address."
                    )
                  }
                >
                  <FormControl>
                    <Input
                      type="email"
                      placeholder={
                        selectedType === "resend"
                          ? "onboarding@resend.dev"
                          : "noreply@example.com"
                      }
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="fromName"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="From Name"
                  description='Display name shown in the email "From" field. Optional.'
                >
                  <FormControl>
                    <Input
                      placeholder="My App"
                      disabled={isPending}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>

        {/* ── Section: Defaults ──────────────────────────────────── */}
        <SettingsSection label="Defaults">
          <FormField
            control={form.control}
            name="isDefault"
            render={({ field }) => (
              <FormItem className="m-0">
                <SettingsRow
                  label="Set as Default Provider"
                  description="When enabled, this provider will be used to send all transactional emails unless a specific provider is requested."
                >
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                    />
                  </FormControl>
                  <FormMessage className="mt-1.5" />
                </SettingsRow>
              </FormItem>
            )}
          />
        </SettingsSection>
      </form>
    </Form>
  );
}

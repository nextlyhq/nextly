"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import type React from "react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  SettingsLayout,
  SettingsSection,
  SettingsRow,
} from "@admin/components/features/settings";
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@admin/components/ui/form";
import {
  useGeneralSettings,
  useUpdateGeneralSettings,
} from "@admin/hooks/queries/useGeneralSettings";

import { GeneralSettingsSkeleton } from "./components/GeneralSettingsSkeleton";

// ============================================================
// Options
// ============================================================

const TIMEZONE_OPTIONS = [
  // --- Americas ---
  { value: "America/New_York", label: "Eastern Time (US & Canada)" },
  { value: "America/Chicago", label: "Central Time (US & Canada)" },
  { value: "America/Denver", label: "Mountain Time (US & Canada)" },
  { value: "America/Los_Angeles", label: "Pacific Time (US & Canada)" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "America/Toronto", label: "Eastern Time (Canada)" },
  { value: "America/Vancouver", label: "Pacific Time (Canada)" },
  { value: "America/Mexico_City", label: "Mexico City" },
  { value: "America/Sao_Paulo", label: "Brasilia" },
  { value: "America/Buenos_Aires", label: "Buenos Aires" },
  { value: "America/Santiago", label: "Santiago" },
  { value: "America/Lima", label: "Lima" },
  { value: "America/Bogota", label: "Bogota" },

  // --- Europe ---
  { value: "Europe/London", label: "London, Dublin" },
  { value: "Europe/Paris", label: "Paris" },
  { value: "Europe/Berlin", label: "Berlin" },
  { value: "Europe/Amsterdam", label: "Amsterdam" },
  { value: "Europe/Rome", label: "Rome" },
  { value: "Europe/Madrid", label: "Madrid" },
  { value: "Europe/Stockholm", label: "Stockholm" },
  { value: "Europe/Warsaw", label: "Warsaw" },
  { value: "Europe/Istanbul", label: "Istanbul" },
  { value: "Europe/Moscow", label: "Moscow" },
  { value: "Europe/Kiev", label: "Kiev" },

  // --- Middle East & Africa ---
  { value: "Asia/Dubai", label: "Dubai, Abu Dhabi" },
  { value: "Asia/Qatar", label: "Qatar" },

  // --- Asia ---
  { value: "Asia/Karachi", label: "Karachi, Islamabad (Pakistan)" },
  { value: "Asia/Kolkata", label: "Mumbai, Kolkata, New Delhi" },
  { value: "Asia/Kathmandu", label: "Kathmandu" },
  { value: "Asia/Dhaka", label: "Dhaka" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Shanghai", label: "Beijing, Shanghai" },
  { value: "Asia/Seoul", label: "Seoul" },
  { value: "Asia/Tokyo", label: "Tokyo" },

  // --- Australia & Pacific ---
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Australia/Melbourne", label: "Melbourne" },
  { value: "Australia/Brisbane", label: "Brisbane" },
  { value: "Australia/Perth", label: "Perth" },
  { value: "Australia/Adelaide", label: "Adelaide" },
  { value: "Pacific/Auckland", label: "Auckland" },
  { value: "Pacific/Fiji", label: "Fiji" },
];

const DATE_FORMAT_OPTIONS = [
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (01/31/2025)" },
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (31/01/2025)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2025-01-31)" },
  { value: "DD.MM.YYYY", label: "DD.MM.YYYY (31.01.2025)" },
  { value: "MMM DD, YYYY", label: "MMM DD, YYYY (Jan 31, 2025)" },
];

const TIME_FORMAT_OPTIONS = [
  { value: "12h", label: "12-hour (1:30 PM)" },
  { value: "24h", label: "24-hour (13:30)" },
];

// ============================================================
// Schema
// ============================================================

const formSchema = z.object({
  applicationName: z.string().max(255).optional(),
  siteUrl: z
    .string()
    .refine(
      val => !val || /^https?:\/\/.+/.test(val),
      "Site URL must start with http:// or https://"
    )
    .optional(),
  adminEmail: z
    .string()
    .refine(
      val => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      "Please enter a valid email address"
    )
    .optional(),
  timezone: z.string().optional(),
  dateFormat: z.string().optional(),
  timeFormat: z.string().optional(),
  logoUrl: z
    .string()
    .refine(
      val => !val || /^https?:\/\/.+/.test(val),
      "Logo URL must start with http:// or https://"
    )
    .optional(),
});

type FormValues = z.infer<typeof formSchema>;

// ============================================================
// Page
// ============================================================

const SettingsGeneralPage: React.FC = () => {
  const { data: settings, isLoading } = useGeneralSettings();
  const { mutate: updateSettings, isPending } = useUpdateGeneralSettings();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      applicationName: settings?.applicationName ?? "",
      siteUrl: settings?.siteUrl ?? "",
      adminEmail: settings?.adminEmail ?? "",
      timezone: settings?.timezone ?? "",
      dateFormat: settings?.dateFormat ?? "",
      timeFormat: settings?.timeFormat ?? "",
      logoUrl: settings?.logoUrl ?? "",
    },
  });

  // When settings data arrives or changes, update the form immediately.
  useEffect(() => {
    if (settings) {
      form.reset({
        applicationName: settings.applicationName ?? "",
        siteUrl: settings.siteUrl ?? "",
        adminEmail: settings.adminEmail ?? "",
        timezone: settings.timezone ?? "",
        dateFormat: settings.dateFormat ?? "",
        timeFormat: settings.timeFormat ?? "",
        logoUrl: settings.logoUrl ?? "",
      });
    }
  }, [settings, form]);

  function onSubmit(values: FormValues) {
    const timezoneToSave = values.timezone?.trim() ? values.timezone : null;

    const dateFormatToSave = values.dateFormat?.trim()
      ? values.dateFormat
      : null;
    const timeFormatToSave = values.timeFormat?.trim()
      ? values.timeFormat
      : null;

    updateSettings(
      {
        applicationName: values.applicationName || null,
        siteUrl: values.siteUrl || null,
        adminEmail: values.adminEmail || null,
        timezone: timezoneToSave,
        dateFormat: dateFormatToSave,
        timeFormat: timeFormatToSave,
        logoUrl: values.logoUrl || null,
      },
      {
        onSuccess: () => {
          // Reset the form to make it "clean" again after a successful save.
          form.reset(values);
          toast.success("Settings saved", {
            description: "General settings have been updated.",
          });
        },
        onError: err => {
          toast.error("Failed to save settings", {
            description: err.message,
          });
        },
      }
    );
  }

  return (
    <PageContainer>
      <Form {...form}>
        <form
          onSubmit={e => {
            void form.handleSubmit(onSubmit)(e);
          }}
        >
          <SettingsLayout
            actions={
              <Button type="submit" disabled={isPending || isLoading}>
                {isPending ? "Saving…" : "Save Changes"}
              </Button>
            }
          >
            {isLoading ? (
              <GeneralSettingsSkeleton />
            ) : (
              <div className="space-y-5">
                {/* ── Section: Locale & Formatting ── */}
                <SettingsSection label="Locale & Formatting">
                  <FormField
                    control={form.control}
                    name="timezone"
                    render={({ field }) => (
                      <FormItem className="m-0">
                        <SettingsRow
                          label="Timezone"
                          description="Time zone used across the admin and email notifications."
                        >
                          <FormControl>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                              disabled={isLoading}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a timezone" />
                              </SelectTrigger>
                              <SelectContent>
                                {TIMEZONE_OPTIONS.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage className="mt-1.5" />
                        </SettingsRow>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="dateFormat"
                    render={({ field }) => (
                      <FormItem className="m-0">
                        <SettingsRow
                          label="Date Format"
                          description="How dates appear in lists and detail pages."
                        >
                          <FormControl>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                              disabled={isLoading}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a date format" />
                              </SelectTrigger>
                              <SelectContent>
                                {DATE_FORMAT_OPTIONS.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage className="mt-1.5" />
                        </SettingsRow>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="timeFormat"
                    render={({ field }) => (
                      <FormItem className="m-0">
                        <SettingsRow
                          label="Time Format"
                          description="12-hour vs 24-hour clock."
                        >
                          <FormControl>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                              disabled={isLoading}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a time format" />
                              </SelectTrigger>
                              <SelectContent>
                                {TIME_FORMAT_OPTIONS.map(opt => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FormMessage className="mt-1.5" />
                        </SettingsRow>
                      </FormItem>
                    )}
                  />
                </SettingsSection>
              </div>
            )}
          </SettingsLayout>
        </form>
      </Form>
    </PageContainer>
  );
};

export default SettingsGeneralPage;

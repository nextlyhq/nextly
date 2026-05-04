"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import { Save, Sun, Moon, Monitor } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
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
import { useTheme } from "@admin/context/providers/ThemeProvider";
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
  theme: z.enum(["light", "dark", "system"]).optional(),
});

type FormValues = z.infer<typeof formSchema>;

// ============================================================
// Page
// ============================================================

const THEME_OPTIONS = [
  {
    value: "light" as const,
    label: "Light",
    icon: Sun,
    description: "Always use light appearance",
  },
  {
    value: "dark" as const,
    label: "Dark",
    icon: Moon,
    description: "Always use dark appearance",
  },
  {
    value: "system" as const,
    label: "System",
    icon: Monitor,
    description: "Follows your device settings",
  },
];

/**
 * Apply a resolved theme ("light" | "dark") to all `.adminapp` containers
 * and to the document root, mirroring what `ThemeSync` does in
 * `ThemeProvider`. We touch both so the preview is visible regardless of
 * which surface the active styles target.
 */
function applyPreviewTheme(theme: "light" | "dark" | "system") {
  if (typeof document === "undefined") return;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const isDark = resolved === "dark";
  const containers = document.querySelectorAll(".adminapp");
  containers.forEach(container => {
    container.classList.toggle("dark", isDark);
  });
}

const SettingsGeneralPage: React.FC = () => {
  const { data: settings, isLoading } = useGeneralSettings();
  const { mutate: updateSettings, isPending } = useUpdateGeneralSettings();
  const { theme: savedTheme, setTheme: persistTheme } = useTheme();
  const initialThemeRef = useRef<string | undefined>(undefined);
  // Tracks whether the user has changed the theme tile away from the saved
  // value. Read by the unmount cleanup hook (form.formState.isDirty cannot
  // be reliably read inside an effect cleanup because it relies on
  // subscription proxies that update during render).
  const themeDirtyRef = useRef(false);

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
      theme: undefined,
    },
  });

  // When settings data arrives or changes, update the form immediately.
  // Note: theme is intentionally excluded here — it is owned by next-themes,
  // not the API payload. We initialize it in a separate effect below.
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
        theme: form.getValues("theme"),
      });
    }
  }, [settings, form]);

  // Initialize the form's theme value once next-themes has resolved the
  // saved theme. next-themes resolves async on mount so `savedTheme` may be
  // `undefined` initially.
  useEffect(() => {
    if (savedTheme && initialThemeRef.current === undefined) {
      initialThemeRef.current = savedTheme;
      form.setValue("theme", savedTheme as "light" | "dark" | "system", {
        shouldDirty: false,
      });
    }
  }, [savedTheme, form]);

  const previewTheme = (form.watch("theme") ?? savedTheme ?? "system") as
    | "light"
    | "dark"
    | "system";

  const setPreviewTheme = (next: "light" | "dark" | "system") => {
    form.setValue("theme", next, { shouldDirty: true });
    themeDirtyRef.current = next !== initialThemeRef.current;
  };

  // Apply the preview to all `.adminapp` containers whenever previewTheme
  // changes. This is the "live preview" — it does NOT touch localStorage.
  useEffect(() => {
    applyPreviewTheme(previewTheme);
  }, [previewTheme]);

  // On unmount, if the user has previewed a different theme without saving,
  // restore the saved theme's class so navigating away from /admin/settings
  // visually reverts.
  useEffect(() => {
    return () => {
      if (initialThemeRef.current === undefined) return;
      if (!themeDirtyRef.current) return;
      applyPreviewTheme(initialThemeRef.current as "light" | "dark" | "system");
    };
  }, []);

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
          // Persist the theme to localStorage via next-themes only after the
          // API call succeeds.
          if (values.theme) {
            persistTheme(values.theme);
            initialThemeRef.current = values.theme;
          }
          themeDirtyRef.current = false;
          // Reset the form to make it "clean" again so the unmount cleanup
          // does not trigger a snap-back.
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
              <Button
                type="submit"
                disabled={isPending || isLoading}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
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

                {/* ── Section: Appearance ── */}
                <SettingsSection label="Appearance">
                  <SettingsRow
                    label="Theme"
                    description="Choose how the admin panel looks. System follows your device's dark/light mode."
                  >
                    <div className="grid grid-cols-3 gap-3">
                      {THEME_OPTIONS.map(
                        ({ value, label, icon: Icon, description }) => {
                          const isActive = previewTheme === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setPreviewTheme(value)}
                              className={[
                                "group relative flex flex-col items-center gap-2.5 rounded-md border p-4 text-center transition-all duration-200 cursor-pointer",
                                isActive
                                  ? "border-foreground bg-primary/5"
                                  : "border-input bg-background hover:border-foreground/40 text-muted-foreground hover:text-foreground",
                              ].join(" ")}
                            >
                              <Icon className="h-5 w-5" />
                              <div>
                                <p
                                  className={
                                    isActive
                                      ? "text-sm font-semibold text-foreground"
                                      : "text-sm font-semibold"
                                  }
                                >
                                  {label}
                                </p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
                                  {description}
                                </p>
                              </div>
                            </button>
                          );
                        }
                      )}
                    </div>
                  </SettingsRow>
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

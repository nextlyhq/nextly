import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@revnixhq/ui";
import {
  Clock,
  Calendar,
  MapPin,
  Save,
  Sun,
  Moon,
  Monitor,
  Palette,
} from "lucide-react";
import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { SettingsLayout } from "@admin/components/features/settings/SettingsLayout";
import { PageContainer } from "@admin/components/layout/page-container";
import { toast } from "@admin/components/ui";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  useFormField,
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
});

type FormValues = z.infer<typeof formSchema>;

// ============================================================
// Sub-components
// ============================================================

/** A single settings row: label+description on the left, control on the right */
function SettingsRow({
  label,
  description,
  icon,
  children,
}: {
  label: string;
  description: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { formItemId } = useFormField();

  return (
    <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-4 md:gap-8 py-5 px-4 -mx-4 items-start transition-all duration-200 rounded-xl focus-within:bg-primary/5 focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary">
      <div className="flex items-start gap-3">
        {icon && (
          <div className="mt-0.5 shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-primary-50 text-primary-500 dark:bg-primary-500/10 dark:text-primary-400">
            {icon}
          </div>
        )}
        <label
          htmlFor={formItemId}
          className="cursor-pointer group flex flex-col"
        >
          <p className="text-sm font-semibold text-foreground group-hover-unified">
            {label}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
            {description}
          </p>
        </label>
      </div>
      <div className="w-full">{children}</div>
    </div>
  );
}

/** Card wrapper for a group of settings */
function SettingsCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-4 px-6 py-5 border-b border-border/60 bg-muted/20">
        <div className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-primary-50 text-primary-500 dark:bg-primary-500/10 dark:text-primary-400">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      {/* Card body rows */}
      <div className="divide-y divide-border/60 px-6">{children}</div>
    </div>
  );
}

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

const SettingsGeneralPage: React.FC = () => {
  const { data: settings, isLoading } = useGeneralSettings();
  const { mutate: updateSettings, isPending } = useUpdateGeneralSettings();
  const { theme, setTheme } = useTheme();
  // Ensure we show 'system' if no theme preference is explicitly set yet
  const activeTheme =
    theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system";

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

  // When settings data arrives or changes, update the form immediately
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
        <form onSubmit={form.handleSubmit(onSubmit)}>
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
                {/* ── Section 1: Application Identity ── */}
                {/* <SettingsCard
                title="Application Identity"
                description="Configure how your application presents itself to users."
                icon={<AppWindow className="h-5 w-5" />}
              >
                <FormField
                  control={form.control}
                  name="applicationName"
                  render={({ field }) => (
                    <FormItem className="m-0">
                      <SettingsRow
                        label="Application Name"
                        description="Shown in the browser tab and throughout the admin panel."
                        icon={<AppWindow className="h-4 w-4" />}
                      >
                        <FormControl>
                          <Input
                            placeholder="Enter application name"
                            disabled={isLoading}
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
                  name="siteUrl"
                  render={({ field }) => (
                    <FormItem className="m-0">
                      <SettingsRow
                        label="Site URL"
                        description="The primary URL where your site is hosted. Used in email links and notifications."
                        icon={<Globe className="h-4 w-4" />}
                      >
                        <FormControl>
                          <Input
                            placeholder="https://example.com"
                            disabled={isLoading}
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
                  name="adminEmail"
                  render={({ field }) => (
                    <FormItem className="m-0">
                      <SettingsRow
                        label="Admin Email"
                        description="The primary email address for administrative notifications."
                        icon={<Mail className="h-4 w-4" />}
                      >
                        <FormControl>
                          <Input
                            placeholder="admin@example.com"
                            disabled={isLoading}
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
                  name="logoUrl"
                  render={({ field }) => (
                    <FormItem className="m-0">
                      <SettingsRow
                        label="Logo URL"
                        description={
                          <>
                            URL of the logo image shown in the admin sidebar and
                            authentication pages. Overrides the logo set in{" "}
                            <code className="text-xs font-mono bg-muted px-1 py-0.5 rounded">
                              nextly.config.ts
                            </code>
                            .
                          </>
                        }
                        icon={<Image className="h-4 w-4" />}
                      >
                        <FormControl>
                          <Input
                            placeholder="https://example.com/logo.svg"
                            disabled={isLoading}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage className="mt-1.5" />
                      </SettingsRow>
                    </FormItem>
                  )}
                />
              </SettingsCard> */}

                {/* ── Section 2: Locale & Formatting ── */}
                <SettingsCard
                  title="Locale & Formatting"
                  description="Control time zone, date, and time format preferences for your site."
                  icon={<Clock className="h-5 w-5" />}
                >
                  {/* <div className="py-4 px-4 -mx-4 flex justify-end"> */}
                  {/* <Button
                    type="button"
                    variant="outline"
                    onClick={resetLocaleFormatting}
                    disabled={isLoading || isPending}
                    className="flex items-center gap-2"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reset Locale Defaults
                  </Button>
                </div> */}

                  <FormField
                    control={form.control}
                    name="timezone"
                    render={({ field }) => (
                      <FormItem className="m-0">
                        <SettingsRow
                          label="Timezone"
                          description="The default timezone used across your site for dates and times."
                          icon={<MapPin className="h-4 w-4" />}
                        >
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? ""}
                            disabled={isLoading}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select timezone" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {TIMEZONE_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                          description="How dates are displayed throughout the admin and in exported data."
                          icon={<Calendar className="h-4 w-4" />}
                        >
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? ""}
                            disabled={isLoading}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select date format" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {DATE_FORMAT_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
                          description="Choose between 12-hour (AM/PM) and 24-hour time display."
                          icon={<Clock className="h-4 w-4" />}
                        >
                          <Select
                            onValueChange={field.onChange}
                            value={field.value ?? ""}
                            disabled={isLoading}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select time format" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {TIME_FORMAT_OPTIONS.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage className="mt-1.5" />
                        </SettingsRow>
                      </FormItem>
                    )}
                  />
                </SettingsCard>

                {/* ── Section 3: Appearance ── */}
                <SettingsCard
                  title="Appearance"
                  description="Choose how the admin panel looks and feels."
                  icon={<Palette className="h-5 w-5" />}
                >
                  <div className="py-5">
                    <div className="flex items-start gap-3 mb-5">
                      <div className="mt-0.5 shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-primary-50 text-primary-500 dark:bg-primary-500/10 dark:text-primary-400">
                        <Monitor className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          Theme
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
                          Choose how the admin panel looks. System follows your
                          device&apos;s dark/light mode preference.
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {THEME_OPTIONS.map(
                        ({ value, label, icon: Icon, description }) => {
                          const isActive = activeTheme === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setTheme(value)}
                              className={[
                                "group relative flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center transition-all duration-200 cursor-pointer",
                                isActive
                                  ? "border-primary bg-primary/5 text-primary dark:bg-primary/10"
                                  : "border-border bg-background hover:border-primary/40 hover-unified text-muted-foreground hover:text-foreground",
                              ].join(" ")}
                            >
                              <div
                                className={[
                                  "flex items-center justify-center w-10 h-10 rounded-lg transition-colors",
                                  isActive
                                    ? "bg-primary/10 text-primary dark:bg-primary/20"
                                    : "bg-muted text-muted-foreground group-hover-unified",
                                ].join(" ")}
                              >
                                <Icon className="h-5 w-5" />
                              </div>
                              <div>
                                <p
                                  className={[
                                    "text-sm font-semibold leading-tight",
                                    isActive
                                      ? "text-primary"
                                      : "text-foreground",
                                  ].join(" ")}
                                >
                                  {label}
                                </p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground leading-tight">
                                  {description}
                                </p>
                              </div>
                              {isActive && (
                                <span className="absolute top-2.5 right-2.5 flex h-2.5 w-2.5 items-center justify-center">
                                  <span className="h-2 w-2 rounded-full bg-primary" />
                                </span>
                              )}
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>
                </SettingsCard>
              </div>
            )}
          </SettingsLayout>
        </form>
      </Form>
    </PageContainer>
  );
};

export default SettingsGeneralPage;

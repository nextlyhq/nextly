import { z } from "zod";

import type {
  EmailProviderRecord,
  EmailProviderType,
} from "@admin/services/emailProviderApi";

// ============================================================
// Form Values Type (flat shape — all fields present)
// ============================================================

export interface ProviderFormValues {
  name: string;
  type: EmailProviderType;
  fromEmail: string;
  fromName: string;
  isDefault: boolean;
  // SMTP fields
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  smtpPassword: string;
  // API key fields (Resend / SendLayer)
  apiKey: string;
}

// ============================================================
// Zod Schema (single flat schema with conditional refinement)
// ============================================================

export function buildProviderSchema(
  mode: "create" | "edit",
  originalType?: EmailProviderType
) {
  return z
    .object({
      name: z.string().min(1, "Provider name is required").max(255),
      type: z.enum(["smtp", "resend", "sendlayer"]),
      fromEmail: z.string().email("Please enter a valid email address"),
      fromName: z.string().max(255).optional().or(z.literal("")),
      isDefault: z.boolean(),
      smtpHost: z.string().optional().or(z.literal("")),
      smtpPort: z.number().int().min(1).max(65535).optional(),
      smtpSecure: z.boolean().optional(),
      smtpUsername: z.string().optional().or(z.literal("")),
      smtpPassword: z.string().optional().or(z.literal("")),
      apiKey: z.string().optional().or(z.literal("")),
    })
    .superRefine((data, ctx) => {
      const switchingType =
        mode === "edit" && !!originalType && data.type !== originalType;

      if (data.type === "smtp") {
        if (!data.smtpHost) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "SMTP host is required",
            path: ["smtpHost"],
          });
        }
        if (!data.smtpPort) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "SMTP port is required",
            path: ["smtpPort"],
          });
        }
        if (!data.smtpUsername) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "SMTP username is required",
            path: ["smtpUsername"],
          });
        }
        if ((mode === "create" || switchingType) && !data.smtpPassword) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "SMTP password is required",
            path: ["smtpPassword"],
          });
        }
      }

      if (
        (data.type === "resend" || data.type === "sendlayer") &&
        (mode === "create" || switchingType) &&
        !data.apiKey
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "API key is required",
          path: ["apiKey"],
        });
      }
    });
}

// ============================================================
// Form Defaults
// ============================================================

export const DEFAULT_VALUES: ProviderFormValues = {
  type: "smtp",
  name: "",
  fromEmail: "",
  fromName: "",
  isDefault: false,
  smtpHost: "",
  smtpPort: 587,
  smtpSecure: false,
  smtpUsername: "",
  smtpPassword: "",
  apiKey: "",
};

// ============================================================
// Helpers
// ============================================================

/**
 * Transform flat form values into the API payload shape.
 * Assembles the provider-specific `configuration` object.
 */
export function formValuesToPayload(values: ProviderFormValues) {
  const base = {
    name: values.name,
    type: values.type,
    fromEmail: values.fromEmail,
    fromName: values.fromName || null,
    isDefault: values.isDefault,
  };

  switch (values.type) {
    case "smtp":
      return {
        ...base,
        configuration: {
          host: values.smtpHost,
          port: values.smtpPort,
          secure: values.smtpSecure,
          auth: {
            user: values.smtpUsername,
            pass: values.smtpPassword,
          },
        },
      };
    case "resend":
      return {
        ...base,
        configuration: { apiKey: values.apiKey },
      };
    case "sendlayer":
      return {
        ...base,
        configuration: { apiKey: values.apiKey },
      };
  }
}

/**
 * Transform an API provider record into flat form values for editing.
 */
export function providerToFormValues(
  provider: EmailProviderRecord
): ProviderFormValues {
  const base = {
    name: provider.name,
    fromEmail: provider.fromEmail,
    fromName: provider.fromName ?? "",
    isDefault: provider.isDefault,
    // Initialize all fields with defaults — only the relevant ones get overridden
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: "",
    smtpPassword: "",
    apiKey: "",
  };

  const config = provider.configuration;

  switch (provider.type) {
    case "smtp": {
      const auth = (config.auth as Record<string, unknown>) ?? {};
      return {
        ...base,
        type: "smtp",
        smtpHost: (config.host as string) ?? "",
        smtpPort: (config.port as number) ?? 587,
        smtpSecure: (config.secure as boolean) ?? false,
        smtpUsername: (auth.user as string) ?? "",
        smtpPassword:
          typeof auth.pass === "string" && auth.pass.length > 0
            ? auth.pass
            : "",
      };
    }
    case "resend":
      return {
        ...base,
        type: "resend",
        apiKey:
          typeof config.apiKey === "string" && config.apiKey.length > 0
            ? (config.apiKey)
            : "",
      };
    case "sendlayer":
      return {
        ...base,
        type: "sendlayer",
        apiKey:
          typeof config.apiKey === "string" && config.apiKey.length > 0
            ? (config.apiKey)
            : "",
      };
    default:
      return { ...base, type: "smtp" };
  }
}

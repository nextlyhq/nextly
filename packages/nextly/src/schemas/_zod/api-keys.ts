import { z } from "zod";

/**
 * The three token types that determine how permissions are resolved at request time.
 * - "read-only"   — resolves to the creator's read-* permissions only
 * - "full-access" — resolves to the creator's full permission set
 * - "role-based"  — resolves to the permissions of the selected role
 */
export const ApiKeyTokenTypeSchema = z.enum(
  ["read-only", "full-access", "role-based"],
  { message: "Token type must be one of: read-only, full-access, role-based" }
);

/**
 * Token duration options. "unlimited" means the key never expires.
 */
export const ExpiresInSchema = z.enum(["7d", "30d", "90d", "unlimited"], {
  message: "Expires in must be one of: 7d, 30d, 90d, unlimited",
});

/**
 * Validates the request body for POST /api/api-keys.
 *
 * Refinement rules:
 * - `roleId` is required when `tokenType === "role-based"`
 * - `roleId` must be absent (undefined) when `tokenType` is not "role-based"
 */
export const CreateApiKeySchema = z
  .object({
    /** Human-readable label, e.g. "Frontend App Key". */
    name: z
      .string()
      .min(1, "Name is required")
      .max(255, "Name must be 255 characters or less"),
    /** Optional documentation string for the key. */
    description: z.string().optional(),
    /** Determines how permissions are resolved on each request. */
    tokenType: ApiKeyTokenTypeSchema,
    /**
     * ID of the role whose permissions this key will use.
     * Required when tokenType is "role-based"; must be absent otherwise.
     */
    roleId: z.string().min(1, "Role ID is required").optional(),
    /** How long the key is valid for. "unlimited" = no expiry. */
    expiresIn: ExpiresInSchema,
  })
  .superRefine((data, ctx) => {
    if (data.tokenType === "role-based" && !data.roleId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A role must be selected for role-based token type",
        path: ["roleId"],
      });
    }
    if (data.tokenType !== "role-based" && data.roleId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "roleId must not be provided for non-role-based token types",
        path: ["roleId"],
      });
    }
  });

/**
 * Validates the request body for PATCH /api/api-keys/:id.
 *
 * Only name and description may be updated. Token type, role, and duration
 * are immutable — revoke and recreate to change them.
 */
export const UpdateApiKeySchema = z.object({
  /** Updated human-readable label. Omit to leave unchanged. */
  name: z
    .string()
    .min(1, "Name cannot be empty")
    .max(255, "Name must be 255 characters or less")
    .optional(),
  /**
   * Updated documentation string.
   * - Omit (undefined) to leave unchanged.
   * - Pass null to explicitly clear the description.
   */
  description: z.string().nullable().optional(),
});

export type ApiKeyTokenTypeEnum = z.infer<typeof ApiKeyTokenTypeSchema>;
export type ExpiresInEnum = z.infer<typeof ExpiresInSchema>;
export type CreateApiKey = z.infer<typeof CreateApiKeySchema>;
export type UpdateApiKey = z.infer<typeof UpdateApiKeySchema>;

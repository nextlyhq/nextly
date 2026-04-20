import { z } from "zod";

export const PaginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(10),
  offset: z.number().int().min(0).optional(),
});

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(
  dataSchema: T
): z.ZodObject<{
  data: z.ZodArray<T>;
  pagination: z.ZodObject<Record<string, z.ZodTypeAny>>;
}> =>
  z.object({
    data: z.array(dataSchema),
    pagination: z.object({
      page: z.number().int().min(1),
      limit: z.number().int().min(1),
      total: z.number().int().min(0),
      totalPages: z.number().int().min(0),
      hasNext: z.boolean(),
      hasPrev: z.boolean(),
    }),
  });

export const SortOrderSchema = z.enum(["asc", "desc"]).default("asc");

export const SortSchema = z.object({
  field: z.string().min(1, "Sort field is required"),
  order: SortOrderSchema,
});

export const DateRangeSchema = z
  .object({
    from: z.date().optional(),
    to: z.date().optional(),
  })
  .refine(data => !data.from || !data.to || data.from <= data.to, {
    message: "From date must be before or equal to to date",
    path: ["from"],
  });

export const SearchSchema = z.object({
  query: z
    .string()
    .min(1, "Search query is required")
    .max(255, "Search query too long"),
  fields: z.array(z.string()).optional(),
});

export const SuccessResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  data: z.any().optional(),
});

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  code: z.string().optional(),
  details: z.any().optional(),
});

/**
 * @deprecated Use `ValidationError` and `ValidationErrorResponse` from `nextly/validation` instead.
 * This schema will be removed in a future version.
 *
 * Migration:
 * ```typescript
 * // Old
 * import { ValidationErrorSchema } from '@revnixhq/nextly/schemas/validation';
 *
 * // New
 * import { ValidationError, ValidationErrorResponse } from '@revnixhq/nextly/validation';
 * ```
 */
export const ValidationErrorSchema = z.object({
  success: z.literal(false),
  error: z.literal("Validation failed"),
  details: z.array(
    z.object({
      field: z.string(),
      message: z.string(),
      code: z.string().optional(),
    })
  ),
});

export const BulkOperationSchema = z.object({
  ids: z.array(z.string()).min(1, "At least one ID is required"),
  operation: z.enum(["delete", "update", "activate", "deactivate"]),
});

export const BulkOperationResponseSchema = z.object({
  success: z.boolean(),
  processed: z.number().int().min(0),
  failed: z.number().int().min(0),
  errors: z
    .array(
      z.object({
        id: z.string(),
        error: z.string(),
      })
    )
    .optional(),
});

export const FileUploadSchema = z.object({
  filename: z.string().min(1, "Filename is required"),
  mimetype: z.string().min(1, "MIME type is required"),
  size: z.number().int().min(1, "File size must be positive"),
  buffer: z.instanceof(Buffer).optional(),
});

export const ImageUploadSchema = FileUploadSchema.extend({
  mimetype: z.string().regex(/^image\//, "File must be an image"),
  size: z
    .number()
    .int()
    .max(5 * 1024 * 1024, "Image size must be less than 5MB"), // 5MB limit
});

export const EmailSchema = z
  .string()
  .email("Invalid email format")
  .transform(v => v.trim().toLowerCase());

// Per-rule validation produces a separate error message for every unmet
// requirement, so the UI can show users exactly which rules their password
// fails instead of a single combined message.
export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be less than 128 characters")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/\d/, "Password must contain at least one number")
  .regex(
    /[^A-Za-z0-9]/,
    "Password must contain at least one special character"
  );

export const UrlSchema = z.string().url("Invalid URL format");

export const PhoneSchema = z
  .string()
  .regex(/^\+?[\d\s\-\\(\\)]+$/, "Invalid phone number format")
  .min(10, "Phone number too short")
  .max(20, "Phone number too long");

export type Pagination = z.infer<typeof PaginationSchema>;

export type PaginatedResponse<T extends z.ZodTypeAny> = z.infer<
  ReturnType<typeof PaginatedResponseSchema<T>>
>;

export type SortOrder = z.infer<typeof SortOrderSchema>;
export type Sort = z.infer<typeof SortSchema>;
export type DateRange = z.infer<typeof DateRangeSchema>;
export type Search = z.infer<typeof SearchSchema>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
/**
 * @deprecated Use `ValidationError` from `nextly/validation` instead.
 * Renamed to `LegacyValidationError` to avoid conflicts.
 */
export type LegacyValidationError = z.infer<typeof ValidationErrorSchema>;
export type BulkOperation = z.infer<typeof BulkOperationSchema>;
export type BulkOperationResponse = z.infer<typeof BulkOperationResponseSchema>;
export type FileUpload = z.infer<typeof FileUploadSchema>;
export type ImageUpload = z.infer<typeof ImageUploadSchema>;

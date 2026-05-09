/**
 * Upload Field Type
 *
 * A field for selecting files from upload-enabled collections.
 * Supports single or multiple uploads, polymorphic relations to
 * multiple collections, and filtering by file properties.
 *
 * @module collections/fields/types/upload
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Upload Field Value Types
// ============================================================

/**
 * Reference to an uploaded file (single collection).
 *
 * When `relationTo` is a single string, the value is just the document ID.
 */
export type UploadSingleValue = string | null | undefined;

/**
 * Reference to an uploaded file (polymorphic/multiple collections).
 *
 * When `relationTo` is an array of collection slugs, the value includes
 * both the collection slug and document ID to identify which collection
 * the upload belongs to.
 *
 * @example
 * ```typescript
 * // Single polymorphic reference
 * const value: UploadPolymorphicValue = {
 *   relationTo: 'images',
 *   value: 'abc123',
 * };
 * ```
 */
export interface UploadPolymorphicValue {
  /**
   * The collection slug this upload belongs to.
   */
  relationTo: string;

  /**
   * The document ID of the uploaded file.
   */
  value: string;
}

/**
 * Possible value types for an upload field.
 *
 * The value type depends on the `relationTo` and `hasMany` configuration:
 *
 * - `relationTo: string` + `hasMany: false` → `string | null | undefined`
 * - `relationTo: string` + `hasMany: true` → `string[] | null | undefined`
 * - `relationTo: string[]` + `hasMany: false` → `UploadPolymorphicValue | null | undefined`
 * - `relationTo: string[]` + `hasMany: true` → `UploadPolymorphicValue[] | null | undefined`
 */
export type UploadFieldValue =
  | string
  | string[]
  | UploadPolymorphicValue
  | UploadPolymorphicValue[]
  | null
  | undefined;

// ============================================================
// Filter Options Types
// ============================================================

/**
 * String filter operators for upload filtering.
 */
export interface StringFilterOperator {
  /**
   * Match values that equal the specified string.
   */
  equals?: string;

  /**
   * Match values that do not equal the specified string.
   */
  not_equals?: string;

  /**
   * Match values that contain the specified substring.
   */
  contains?: string;

  /**
   * Match values that are in the specified array.
   */
  in?: string[];

  /**
   * Match values that are not in the specified array.
   */
  not_in?: string[];

  /**
   * Match values that exist (not null/undefined).
   */
  exists?: boolean;
}

/**
 * Number filter operators for upload filtering.
 */
export interface NumberFilterOperator {
  /**
   * Match values that equal the specified number.
   */
  equals?: number;

  /**
   * Match values that do not equal the specified number.
   */
  not_equals?: number;

  /**
   * Match values greater than the specified number.
   */
  greater_than?: number;

  /**
   * Match values greater than or equal to the specified number.
   */
  greater_than_equal?: number;

  /**
   * Match values less than the specified number.
   */
  less_than?: number;

  /**
   * Match values less than or equal to the specified number.
   */
  less_than_equal?: number;

  /**
   * Match values that exist (not null/undefined).
   */
  exists?: boolean;
}

/**
 * Where query for filtering available uploads.
 *
 * Allows filtering uploads by various file properties like
 * mimeType, filesize, filename, dimensions, etc.
 *
 * @example
 * ```typescript
 * // Filter to only show images
 * const imageFilter: UploadFilterQuery = {
 *   mimeType: { contains: 'image' },
 * };
 *
 * // Filter to show images under 5MB
 * const smallImageFilter: UploadFilterQuery = {
 *   mimeType: { contains: 'image' },
 *   filesize: { less_than: 5000000 },
 * };
 *
 * // Filter by specific mime types
 * const documentFilter: UploadFilterQuery = {
 *   mimeType: { in: ['application/pdf', 'application/msword'] },
 * };
 * ```
 */
export interface UploadFilterQuery {
  /**
   * Filter by MIME type (e.g., 'image/png', 'application/pdf').
   *
   * @example
   * ```typescript
   * mimeType: { contains: 'image' }  // All images
   * mimeType: { equals: 'image/png' }  // Only PNG
   * mimeType: { in: ['image/jpeg', 'image/png'] }  // JPEG or PNG
   * ```
   */
  mimeType?: StringFilterOperator;

  /**
   * Filter by file size in bytes.
   *
   * @example
   * ```typescript
   * filesize: { less_than: 5000000 }  // Under 5MB
   * filesize: { greater_than: 1000 }  // Over 1KB
   * ```
   */
  filesize?: NumberFilterOperator;

  /**
   * Filter by filename.
   *
   * @example
   * ```typescript
   * filename: { contains: 'thumbnail' }
   * filename: { not_equals: 'default.png' }
   * ```
   */
  filename?: StringFilterOperator;

  /**
   * Filter by image width in pixels.
   * Only applicable to image uploads.
   *
   * @example
   * ```typescript
   * width: { greater_than_equal: 1920 }  // HD or larger
   * ```
   */
  width?: NumberFilterOperator;

  /**
   * Filter by image height in pixels.
   * Only applicable to image uploads.
   *
   * @example
   * ```typescript
   * height: { greater_than_equal: 1080 }  // HD or larger
   * ```
   */
  height?: NumberFilterOperator;

  /**
   * Filter by alt text content.
   *
   * @example
   * ```typescript
   * alt: { exists: true }  // Only uploads with alt text
   * ```
   */
  alt?: StringFilterOperator;

  /**
   * Additional custom filters.
   * Allows filtering by custom fields added to the upload collection.
   */
  [key: string]: StringFilterOperator | NumberFilterOperator | undefined;
}

/**
 * Arguments passed to the filterOptions function.
 */
export interface UploadFilterOptionsArgs {
  /**
   * The collection slug being filtered.
   * When `relationTo` is an array, this indicates which collection
   * the filter is being applied to.
   */
  relationTo: string;

  /**
   * The current document data being edited.
   */
  data: Record<string, unknown>;

  /**
   * Data from sibling fields (fields at the same level in arrays/groups).
   */
  siblingData: Record<string, unknown>;

  /**
   * The ID of the current document being edited.
   * Undefined during create operations.
   */
  id?: string;

  /**
   * The current user making the request.
   */
  user?: RequestContext["user"];

  /**
   * The full request context.
   */
  req: RequestContext;
}

/**
 * Function to dynamically filter available uploads.
 *
 * Allows uploads to be filtered based on document data, user context,
 * or other dynamic conditions. Return values:
 * - `true` - No filtering, show all uploads
 * - `false` - Prevent all uploads from being shown
 * - `UploadFilterQuery` - Apply the specified filter
 *
 * @param args - Filter arguments with context
 * @returns Filter result or Promise resolving to filter result
 *
 * @example
 * ```typescript
 * // Role-based filtering
 * filterOptions: ({ user }) => {
 *   if (user?.role === 'admin') {
 *     return true; // Admins see all uploads
 *   }
 *   return { mimeType: { contains: 'image' } }; // Others only see images
 * }
 *
 * // Context-aware filtering
 * filterOptions: ({ data }) => {
 *   if (data.type === 'hero') {
 *     return { width: { greater_than_equal: 1920 } }; // Hero needs HD images
 *   }
 *   return true;
 * }
 * ```
 */
export type UploadFilterOptionsFunction = (
  args: UploadFilterOptionsArgs
) => boolean | UploadFilterQuery | Promise<boolean | UploadFilterQuery>;

/**
 * Filter options for upload fields.
 *
 * Can be either a static Where query or a dynamic function.
 */
export type UploadFilterOptions =
  | UploadFilterQuery
  | UploadFilterOptionsFunction;

// ============================================================
// Upload Field Admin Options
// ============================================================

/**
 * Admin panel options specific to upload fields.
 *
 * Extends the base admin options with upload-specific settings
 * for controlling the file picker behavior.
 */
export interface UploadFieldAdminOptions extends FieldAdminOptions {
  /**
   * Allow creating new uploads directly from the field.
   *
   * When `true`, displays an upload button that allows users to
   * upload new files without leaving the current form.
   *
   * @default true
   */
  allowCreate?: boolean;

  /**
   * Allow editing upload metadata from within the field.
   *
   * When `true`, displays an edit button that opens the upload
   * document for editing (e.g., alt text, title).
   *
   * @default true
   */
  allowEdit?: boolean;

  /**
   * Allow drag-and-drop reordering of selected uploads.
   *
   * Only applies when `hasMany: true`. Enables users to reorder
   * their uploads by dragging.
   *
   * @default true
   */
  isSortable?: boolean;

  /**
   * Display a preview thumbnail of the uploaded file.
   *
   * Overrides the related collection's `admin.displayPreview` setting.
   * Useful for showing image thumbnails in the form.
   *
   * @default true (inherited from collection)
   */
  displayPreview?: boolean;
}

// ============================================================
// Upload Field Configuration
// ============================================================

/**
 * Configuration interface for upload fields.
 *
 * Upload fields enable selection of files from collections that have
 * uploads enabled. They display thumbnails in the Admin Panel and
 * support single or multiple file selection.
 *
 * **Key Features:**
 * - Reference files from one or multiple upload collections
 * - Filter available uploads by mimeType, filesize, dimensions
 * - Support for single or multiple file selection
 * - Thumbnail previews in the Admin UI
 * - Create/edit uploads directly from the field
 *
 * **Use Cases:**
 * - Featured images for posts/pages
 * - Document attachments
 * - Media galleries
 * - Avatar/profile pictures
 * - Downloadable file links
 *
 * @example
 * ```typescript
 * // Basic single image upload
 * const featuredImage: UploadFieldConfig = {
 *   name: 'featuredImage',
 *   type: 'upload',
 *   label: 'Featured Image',
 *   relationTo: 'media',
 *   required: true,
 *   filterOptions: {
 *     mimeType: { contains: 'image' },
 *   },
 * };
 *
 * // Multiple document uploads
 * const attachments: UploadFieldConfig = {
 *   name: 'attachments',
 *   type: 'upload',
 *   label: 'Attachments',
 *   relationTo: 'documents',
 *   hasMany: true,
 *   maxRows: 10,
 *   filterOptions: {
 *     mimeType: { in: ['application/pdf', 'application/msword'] },
 *     filesize: { less_than: 10000000 }, // 10MB limit
 *   },
 *   admin: {
 *     description: 'Upload up to 10 PDF or Word documents',
 *     isSortable: true,
 *   },
 * };
 *
 * // Polymorphic upload (multiple collections)
 * const media: UploadFieldConfig = {
 *   name: 'media',
 *   type: 'upload',
 *   label: 'Media',
 *   relationTo: ['images', 'videos', 'documents'],
 *   hasMany: true,
 *   admin: {
 *     description: 'Attach images, videos, or documents',
 *   },
 * };
 *
 * // Upload with dynamic filtering
 * const heroImage: UploadFieldConfig = {
 *   name: 'heroImage',
 *   type: 'upload',
 *   label: 'Hero Image',
 *   relationTo: 'media',
 *   filterOptions: ({ data }) => {
 *     // Require HD images for hero sections
 *     return {
 *       mimeType: { contains: 'image' },
 *       width: { greater_than_equal: 1920 },
 *       height: { greater_than_equal: 1080 },
 *     };
 *   },
 * };
 *
 * // Avatar with size limit
 * const avatar: UploadFieldConfig = {
 *   name: 'avatar',
 *   type: 'upload',
 *   label: 'Profile Picture',
 *   relationTo: 'media',
 *   filterOptions: {
 *     mimeType: { in: ['image/jpeg', 'image/png', 'image/webp'] },
 *     filesize: { less_than: 2000000 }, // 2MB limit
 *   },
 *   admin: {
 *     displayPreview: true,
 *     allowCreate: true,
 *     allowEdit: false,
 *   },
 * };
 * ```
 */
export interface UploadFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'upload'.
   */
  type: "upload";

  /**
   * Collection(s) that this field can reference.
   *
   * Must be a collection slug or array of slugs for collections
   * that have uploads enabled (`upload: true` in collection config).
   *
   * **Single collection:**
   * ```typescript
   * relationTo: 'media'
   * ```
   *
   * **Multiple collections (polymorphic):**
   * ```typescript
   * relationTo: ['images', 'documents', 'videos']
   * ```
   *
   * When using multiple collections, the field value includes
   * a `relationTo` property to identify which collection the
   * upload belongs to.
   */
  relationTo: string | string[];

  /**
   * Allow multiple file uploads.
   *
   * When `true`, the field accepts an array of upload references
   * instead of a single reference.
   *
   * @default false
   */
  hasMany?: boolean;

  /**
   * Minimum number of uploads when `hasMany` is true.
   *
   * Validation will fail if fewer uploads are selected.
   */
  minRows?: number;

  /**
   * Maximum number of uploads when `hasMany` is true.
   *
   * Validation will fail if more uploads are selected.
   * The Admin UI will disable the add button when this limit is reached.
   */
  maxRows?: number;

  /**
   * Maximum depth for populating related documents.
   *
   * Limits how deeply related documents are populated when querying.
   * Useful for controlling response size and preventing circular refs.
   *
   * @default 1
   */
  maxDepth?: number;

  /**
   * Maximum file size in bytes for uploads.
   *
   * Files exceeding this size will be rejected before upload.
   *
   * @example
   * ```typescript
   * // 5MB limit
   * maxFileSize: 5 * 1024 * 1024
   * ```
   */
  maxFileSize?: number;

  /**
   * MIME type filter pattern for allowed uploads.
   *
   * @example
   * ```typescript
   * // Only images
   * mimeTypes: 'image/*'
   *
   * // Specific types
   * mimeTypes: 'image/png,image/jpeg,application/pdf'
   * ```
   */
  mimeTypes?: string;

  /**
   * Filter options for available uploads.
   *
   * Can be a static Where query or a dynamic function that returns
   * a filter based on context (document data, user, etc.).
   *
   * @example
   * ```typescript
   * // Static filter - only images
   * filterOptions: {
   *   mimeType: { contains: 'image' },
   * }
   *
   * // Dynamic filter - based on document type
   * filterOptions: ({ data }) => {
   *   if (data.type === 'document') {
   *     return { mimeType: { contains: 'application/pdf' } };
   *   }
   *   return { mimeType: { contains: 'image' } };
   * }
   * ```
   */
  filterOptions?: UploadFilterOptions;

  /**
   * Default value for the field.
   *
   * Can be a static value or a function that returns a value.
   *
   * @example
   * ```typescript
   * // Single upload default
   * defaultValue: 'default-image-id'
   *
   * // Multiple uploads default
   * defaultValue: ['image1-id', 'image2-id']
   *
   * // Polymorphic default
   * defaultValue: { relationTo: 'images', value: 'default-id' }
   * ```
   */
  defaultValue?:
  | string
  | string[]
  | UploadPolymorphicValue
  | UploadPolymorphicValue[]
  | ((
    data: Record<string, unknown>
  ) =>
    | string
    | string[]
    | UploadPolymorphicValue
    | UploadPolymorphicValue[]);

  /**
   * Admin UI configuration options.
   */
  admin?: UploadFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the upload field value and returns `true` for valid
   * or an error message string for invalid.
   *
   * **Note:** When using `filterOptions` with a custom `validate`
   * function, the filter constraints are not automatically validated.
   * You should include filter validation in your custom function if needed.
   *
   * @param value - The upload field value
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Require at least 3 images for gallery
   * validate: (value) => {
   *   if (Array.isArray(value) && value.length < 3) {
   *     return 'Gallery requires at least 3 images';
   *   }
   *   return true;
   * }
   *
   * // Conditional requirement
   * validate: (value, { data }) => {
   *   if (data.showFeaturedImage && !value) {
   *     return 'Featured image is required when enabled';
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: UploadFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}

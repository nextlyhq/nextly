import type { DataFieldConfig } from "../../collections/fields/types";

/**
 * Allowed field types for user custom fields.
 * Limited to scalar types for simplicity in v1.
 */
export type UserFieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "select"
  | "radio"
  | "checkbox"
  | "date";

/**
 * A field configuration restricted to user-allowed types.
 */
export type UserFieldConfig = Extract<DataFieldConfig, { type: UserFieldType }>;

/**
 * Admin panel options for user management.
 */
export interface UserAdminOptions {
  /**
   * Which custom fields to display as columns in the user list table.
   * Field names reference the `name` property of UserFieldConfig.
   * @example ['company', 'department', 'phoneNumber']
   */
  listFields?: string[];

  /**
   * Group label for custom fields section in create/edit forms.
   * @default 'Additional Information'
   */
  group?: string;
}

/**
 * User configuration for extending the built-in user model.
 */
export interface UserConfig {
  /**
   * Custom fields to add to the user model.
   * These are stored in a separate `user_ext` table with proper typed columns.
   * Only scalar field types are supported: text, textarea, number, email,
   * select, radio, checkbox, date.
   *
   * @example
   * fields: [
   *   text({ name: 'phoneNumber', label: 'Phone Number' }),
   *   text({ name: 'company', label: 'Company' }),
   *   select({ name: 'department', options: [...] }),
   * ]
   */
  fields?: UserFieldConfig[];

  /**
   * Admin panel configuration for user management.
   */
  admin?: UserAdminOptions;
}

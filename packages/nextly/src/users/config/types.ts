import type { DataFieldConfig } from "../../collections/fields/types";

/**
 * Allowed field types for user custom fields: the canonical flat scalars
 * plus two user-surface-only types. `url` and `phone` are deliberately NOT
 * canonical field types — a collection cannot declare them — so they can
 * never reach the schema pipeline. Both store as text; their meaning is
 * validation.
 */
export type UserFieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "url"
  | "phone"
  | "select"
  | "radio"
  | "checkbox"
  | "date";

/** The canonical scalar types shared with collections. */
type CanonicalUserFieldType = Exclude<UserFieldType, "url" | "phone">;

/** Shared shape of the user-surface-only field configs. */
interface UserSurfaceFieldBase {
  /** Column name on `user_ext` and key on the user object. */
  name: string;
  /** Human label shown in the admin. */
  label?: string;
  /** Whether a value is required. */
  required?: boolean;
  /** Default value applied at the application layer. */
  defaultValue?: string;
  /** Maximum string length; also sizes newly created varchar columns. */
  maxLength?: number;
  /** Minimum string length. */
  minLength?: number;
  /** Admin presentation options. */
  admin?: { placeholder?: string; description?: string };
}

/** A validated web address stored as text. */
export interface UserUrlFieldConfig extends UserSurfaceFieldBase {
  type: "url";
}

/** A phone number stored as text. */
export interface UserPhoneFieldConfig extends UserSurfaceFieldBase {
  type: "phone";
}

/**
 * A field whose type a plugin contributed and opted into the `users` surface.
 *
 * The type id is not knowable here — it belongs to whichever plugin is
 * installed — so the arm is open on both the token and the options the type
 * declares for itself. Runtime validation already accepts these; without an arm
 * for them the authoring type did not, so a code-defined plugin user field
 * failed the app's type check unless it was cast.
 */
export interface UserPluginFieldConfig extends UserSurfaceFieldBase {
  type: string & {};
  /**
   * Required, and that is what keeps this arm from swallowing the built-ins.
   *
   * `string & {}` accepts every literal, so without something structural to
   * tell the arms apart a malformed `{ type: "select" }` would satisfy this one
   * and lose the error its own shape would have raised. The container is where
   * a plugin type's options belong anyway.
   */
  pluginOptions: Record<string, unknown>;
  [option: string]: unknown;
}

/**
 * A field configuration restricted to user-allowed types.
 */
export type UserFieldConfig =
  | Extract<DataFieldConfig, { type: CanonicalUserFieldType }>
  | UserUrlFieldConfig
  | UserPhoneFieldConfig
  | UserPluginFieldConfig;

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

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
 * Marks a declaration as belonging to a plugin type rather than a built-in.
 *
 * `string & {}` accepts every literal, so an open arm in the union has nothing
 * structural to tell it apart from the built-in arms: a malformed
 * `{ type: "select" }` missing its `options` would satisfy the open arm and
 * lose the error its own shape raises. A symbol nothing else can name is what
 * keeps the two apart, and `pluginUserField()` is the only thing that sets it,
 * so reaching the open arm is deliberate rather than a shape falling through
 * to it.
 */
export const pluginUserFieldBrand: unique symbol = Symbol.for(
  "nextly.plugin-user-field"
);

/**
 * A field whose type a plugin contributed and opted into the `users` surface.
 *
 * The type id is not knowable here — it belongs to whichever plugin is
 * installed — so the arm is open on both the token and the options the type
 * declares for itself. Runtime validation already accepts these; without an arm
 * for them the authoring type did not, so a code-defined plugin user field
 * failed the app's type check unless it was cast.
 *
 * Written with `pluginUserField()` rather than as a bare object literal.
 */
export interface UserPluginFieldInput extends UserSurfaceFieldBase {
  type: string & {};
  /**
   * Options belonging to the field's own plugin type.
   *
   * Optional, because a type may take none, and one whose option names collide
   * with nothing the built-in shape declares may write them directly on the
   * field instead. Requiring an empty container to satisfy the type would make
   * this narrower than what the runtime accepts.
   */
  pluginOptions?: Record<string, unknown>;
  [option: string]: unknown;
}

/** The same declaration once `pluginUserField()` has marked it. */
export interface UserPluginFieldConfig extends UserPluginFieldInput {
  readonly [pluginUserFieldBrand]: true;
}

/**
 * Declare a user field whose type a plugin contributed.
 *
 * @example
 * ```ts
 * users: {
 *   fields: [
 *     { name: "company", type: "text" },
 *     pluginUserField({ name: "score", type: "star-rating" }),
 *   ],
 * }
 * ```
 */
export function pluginUserField(
  field: UserPluginFieldInput
): UserPluginFieldConfig {
  // Built rather than asserted, so the value really carries what its type says.
  // A symbol key is invisible to `JSON.stringify` and to `Object.keys`, so the
  // declaration serializes and enumerates exactly as it was written.
  return { ...field, [pluginUserFieldBrand]: true };
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

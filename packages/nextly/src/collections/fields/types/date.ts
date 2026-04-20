/**
 * Date Field Type
 *
 * A date/time picker field that stores date values.
 * Supports various picker appearances (day only, day and time, time only, month only).
 * Dates are stored in UTC format in the database.
 *
 * @module collections/fields/types/date
 * @since 1.0.0
 */

import type {
  BaseFieldConfig,
  FieldAdminOptions,
  RequestContext,
} from "./base";

// ============================================================
// Date Field Value Type
// ============================================================

/**
 * Possible value types for a date field.
 *
 * - `string` - ISO 8601 date string (stored in UTC)
 * - `Date` - JavaScript Date object (converted to ISO string for storage)
 * - `null` - Explicitly empty value
 * - `undefined` - Value not set
 */
export type DateFieldValue = string | Date | null | undefined;

// ============================================================
// Date Picker Appearance
// ============================================================

/**
 * Date picker appearance options.
 *
 * Controls what the user can select in the date picker.
 */
export type DatePickerAppearance =
  | "dayOnly"
  | "dayAndTime"
  | "timeOnly"
  | "monthOnly";

// ============================================================
// Date Field Admin Options
// ============================================================

/**
 * Date-specific options for the date picker.
 */
export interface DatePickerOptions {
  /**
   * Date picker appearance style.
   *
   * - `'dayOnly'` - Date selection only (default)
   * - `'dayAndTime'` - Date and time selection
   * - `'timeOnly'` - Time selection only
   * - `'monthOnly'` - Month and year selection only
   *
   * @default 'dayOnly'
   */
  pickerAppearance?: DatePickerAppearance;

  /**
   * Display format for the date in the field cell (list views).
   *
   * Uses Unicode date format standards.
   * @see https://date-fns.org/docs/format
   *
   * @example 'MMM d, yyyy', 'yyyy-MM-dd', 'dd/MM/yyyy'
   */
  displayFormat?: string;

  /**
   * Number of months to show in the date picker.
   *
   * Maximum of 2 months can be displayed simultaneously.
   *
   * @default 1
   * @max 2
   */
  monthsToShow?: 1 | 2;

  /**
   * Minimum selectable date.
   *
   * Users cannot select dates before this date.
   * Can be a Date object or ISO date string.
   *
   * @example new Date('2024-01-01'), '2024-01-01'
   */
  minDate?: Date | string;

  /**
   * Maximum selectable date.
   *
   * Users cannot select dates after this date.
   * Can be a Date object or ISO date string.
   *
   * @example new Date('2025-12-31'), '2025-12-31'
   */
  maxDate?: Date | string;

  /**
   * Minimum selectable time.
   *
   * Only applies when `pickerAppearance` includes time selection.
   * Can be a Date object or time string (HH:mm format).
   *
   * @example new Date('2024-01-01T09:00:00'), '09:00'
   */
  minTime?: Date | string;

  /**
   * Maximum selectable time.
   *
   * Only applies when `pickerAppearance` includes time selection.
   * Can be a Date object or time string (HH:mm format).
   *
   * @example new Date('2024-01-01T17:00:00'), '17:00'
   */
  maxTime?: Date | string;

  /**
   * Time interval in minutes for time selection.
   *
   * Controls the granularity of time selection in the picker.
   *
   * @default 30
   * @example 15, 30, 60
   */
  timeIntervals?: number;

  /**
   * Time display format.
   *
   * @default 'h:mm aa'
   * @example 'HH:mm', 'h:mm a', 'HH:mm:ss'
   */
  timeFormat?: string;
}

/**
 * Admin panel options specific to date fields.
 *
 * Extends the base admin options with date picker configuration.
 */
export interface DateFieldAdminOptions extends FieldAdminOptions {
  /**
   * Date picker configuration options.
   *
   * Controls the appearance and behavior of the date picker.
   */
  date?: DatePickerOptions;
}

// ============================================================
// Date Field Configuration
// ============================================================

/**
 * Configuration interface for date fields.
 *
 * Date fields store date and/or time values. Dates are stored in UTC
 * format in the database. The field supports various picker appearances
 * and validation options.
 *
 * **Use Cases:**
 * - Publication dates
 * - Event start/end times
 * - Birth dates
 * - Appointment scheduling
 * - Expiration dates
 *
 * @example
 * ```typescript
 * // Basic date field
 * const publishDateField: DateFieldConfig = {
 *   name: 'publishDate',
 *   type: 'date',
 *   label: 'Publish Date',
 *   required: true,
 * };
 *
 * // Date and time picker
 * const eventStartField: DateFieldConfig = {
 *   name: 'eventStart',
 *   type: 'date',
 *   label: 'Event Start',
 *   admin: {
 *     date: {
 *       pickerAppearance: 'dayAndTime',
 *       timeIntervals: 15,
 *       timeFormat: 'HH:mm',
 *     },
 *   },
 * };
 *
 * // Date with min/max constraints
 * const appointmentField: DateFieldConfig = {
 *   name: 'appointmentDate',
 *   type: 'date',
 *   label: 'Appointment Date',
 *   admin: {
 *     date: {
 *       pickerAppearance: 'dayAndTime',
 *       minDate: new Date(), // No past dates
 *       minTime: '09:00',
 *       maxTime: '17:00',
 *       timeIntervals: 30,
 *     },
 *     description: 'Select a date and time during business hours',
 *   },
 * };
 *
 * // Month-only picker (e.g., for credit card expiration)
 * const expirationField: DateFieldConfig = {
 *   name: 'expirationMonth',
 *   type: 'date',
 *   label: 'Expiration',
 *   admin: {
 *     date: {
 *       pickerAppearance: 'monthOnly',
 *       displayFormat: 'MM/yyyy',
 *     },
 *   },
 * };
 *
 * // Time-only picker
 * const openingTimeField: DateFieldConfig = {
 *   name: 'openingTime',
 *   type: 'date',
 *   label: 'Opening Time',
 *   admin: {
 *     date: {
 *       pickerAppearance: 'timeOnly',
 *       timeIntervals: 30,
 *       timeFormat: 'h:mm aa',
 *     },
 *   },
 * };
 *
 * // Date range validation
 * const birthDateField: DateFieldConfig = {
 *   name: 'birthDate',
 *   type: 'date',
 *   label: 'Date of Birth',
 *   required: true,
 *   admin: {
 *     date: {
 *       displayFormat: 'MMMM d, yyyy',
 *       maxDate: new Date(), // No future dates
 *     },
 *   },
 *   validate: (value) => {
 *     if (value) {
 *       const date = new Date(value);
 *       const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
 *       if (age < 18) {
 *         return 'You must be at least 18 years old';
 *       }
 *     }
 *     return true;
 *   },
 * };
 * ```
 *
 * @remarks
 * Timezone support is reserved for future implementation.
 * Currently, all dates are stored and displayed in UTC.
 */
export interface DateFieldConfig
  extends Omit<
    BaseFieldConfig,
    "type" | "validate" | "defaultValue" | "admin"
  > {
  /**
   * Field type identifier. Must be 'date'.
   */
  type: "date";

  /**
   * Default value for the field.
   *
   * Can be a static date or a function that returns a date.
   *
   * @example
   * ```typescript
   * // Static default (ISO string)
   * defaultValue: '2024-01-01'
   *
   * // Static default (Date object)
   * defaultValue: new Date('2024-01-01')
   *
   * // Dynamic default (current date)
   * defaultValue: () => new Date().toISOString()
   * ```
   */
  defaultValue?:
    | string
    | Date
    | ((data: Record<string, unknown>) => string | Date);

  /**
   * Admin UI configuration options.
   */
  admin?: DateFieldAdminOptions;

  /**
   * Custom validation function.
   *
   * Receives the typed date value and returns `true` for valid
   * or an error message string for invalid.
   *
   * @param value - The date field value (string, Date, null, or undefined)
   * @param args - Object containing document data and request context
   * @returns `true` if valid, or an error message string
   *
   * @example
   * ```typescript
   * // Ensure date is in the future
   * validate: (value) => {
   *   if (value) {
   *     const date = new Date(value);
   *     if (date <= new Date()) {
   *       return 'Date must be in the future';
   *     }
   *   }
   *   return true;
   * }
   *
   * // Ensure end date is after start date
   * validate: (value, { data }) => {
   *   if (value && data.startDate) {
   *     const endDate = new Date(value);
   *     const startDate = new Date(data.startDate as string);
   *     if (endDate <= startDate) {
   *       return 'End date must be after start date';
   *     }
   *   }
   *   return true;
   * }
   *
   * // Validate business hours
   * validate: (value) => {
   *   if (value) {
   *     const date = new Date(value);
   *     const hours = date.getUTCHours();
   *     if (hours < 9 || hours >= 17) {
   *       return 'Please select a time during business hours (9 AM - 5 PM)';
   *     }
   *   }
   *   return true;
   * }
   * ```
   */
  validate?: (
    value: DateFieldValue,
    args: { data: Record<string, unknown>; req: RequestContext }
  ) => string | true | Promise<string | true>;
}

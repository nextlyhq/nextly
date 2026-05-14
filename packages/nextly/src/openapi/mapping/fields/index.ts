/**
 * Field mapper registry — keyed by `FieldConfig.type`.
 *
 * Tasks T03–T09 each plug their mapper into this map. Keep entries
 * alphabetized by field-type key for diff hygiene.
 *
 * @module nextly/openapi/mapping/fields
 */

import type { FieldConfig } from "../../../collections/fields/types";

import { mapCheckboxField } from "./checkbox";
import { mapChipsField } from "./chips";
import { mapCodeField } from "./code";
import { mapDateField } from "./date";
import { mapEmailField } from "./email";
import { mapGroupField } from "./group";
import { mapJsonField } from "./json";
import { mapNumberField } from "./number";
import { mapPasswordField } from "./password";
import { mapRadioField } from "./radio";
import { mapRelationshipField } from "./relationship";
import { mapRepeaterField } from "./repeater";
import { mapSelectField } from "./select";
import { mapTextField } from "./text";
import { mapTextareaField } from "./textarea";
import type { FieldMapper } from "./types";
import { mapUploadField } from "./upload";

export const fieldMappers: Partial<Record<FieldConfig["type"], FieldMapper>> = {
  checkbox: mapCheckboxField as FieldMapper,
  chips: mapChipsField as FieldMapper,
  code: mapCodeField as FieldMapper,
  date: mapDateField as FieldMapper,
  email: mapEmailField as FieldMapper,
  group: mapGroupField as FieldMapper,
  json: mapJsonField as FieldMapper,
  number: mapNumberField as FieldMapper,
  password: mapPasswordField as FieldMapper,
  radio: mapRadioField as FieldMapper,
  relationship: mapRelationshipField as FieldMapper,
  repeater: mapRepeaterField as FieldMapper,
  select: mapSelectField as FieldMapper,
  text: mapTextField as FieldMapper,
  textarea: mapTextareaField as FieldMapper,
  upload: mapUploadField as FieldMapper,
};

export type { FieldMapper, FieldMapperResult, MappingContext } from "./types";

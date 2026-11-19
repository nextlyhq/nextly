/**
 * A component's own settings as a source of the data picker, listed first
 * while the component is edited on its own: the settings the prop may
 * follow, each with its default (the value on the setting's own block)
 * beside it, and a pick binding the block to the setting,
 * `{ $bind: "<setting id>", source: "setting" }`. Which settings fit is the
 * engine's `followableSettingsOf`, the rule the save judges a follower by.
 *
 * Above the list, how many pages use the component, as its view counts them,
 * and what a setting does for them.
 *
 * @module binding-setting-source
 */
import {
  findNode,
  followableSettingsOf,
  isPlainRecord,
  type Binding,
  type BlockDocument,
  type ExposedProperty,
} from "@nextlyhq/blocks-engine";
import * as React from "react";

import type { ComponentFieldsHost } from "../component-fields";
import { ComponentFieldsContext } from "../component-fields-panel";
import type { EditableProp } from "../inspector";

import type {
  BindingFieldChoice,
  BindingFieldSource,
} from "./binding-services";

/** What the picker heads the group and the chip names the source. */
const COMPONENT_SETTINGS_SOURCE = "This component's settings";

/** The component's settings, as a source the picker lists. */
export type SettingSource = Omit<BindingFieldSource, "binding"> & {
  readonly binding: { readonly source: "setting" };
};

/**
 * The field type a setting's value is read as, for the controls a bound prop
 * shows under its chip: a text setting's value is text, as a text field's.
 */
const READ_AS: Readonly<Record<ExposedProperty["type"], string>> = {
  text: "text",
  richText: "richText",
  link: "text",
  image: "upload",
  select: "select",
  visibility: "checkbox",
};

/** How much of a default the row shows; the row cuts it shorter still. */
const SHOWN_LENGTH = 120;

/**
 * The settings `prop` of block `nodeId` may follow, as a source, or
 * `undefined` where none may: outside a component, for a prop no setting
 * fits, and for a link's entry id (`entryId`), which an id fills, never a
 * setting's value.
 */
export function settingSource(
  document: BlockDocument,
  nodeId: string,
  prop: EditableProp,
  entryId: string | undefined
): SettingSource | undefined {
  if (prop.name === entryId) return undefined;
  const settings = followableSettingsOf(
    document,
    nodeId,
    prop.name,
    prop.schema
  );
  if (settings.length === 0) return undefined;
  return {
    binding: { source: "setting" },
    label: COMPONENT_SETTINGS_SOURCE,
    fields: settings.map(entry => settingChoice(document, entry)),
  };
}

/** One setting as a row: its name, and its default beside it. */
function settingChoice(
  document: BlockDocument,
  setting: ExposedProperty
): BindingFieldChoice {
  return {
    ...settingField(setting),
    // A setting is the component's own, shown wherever it is placed.
    public: true,
    ...shownDefault(defaultOf(document, setting)),
  };
}

/**
 * A setting as a field: its id, its label and the type its value is read as.
 * The one description the picker's row and a bound prop's chip and controls
 * share, so an image setting is read as a file by both.
 */
function settingField(
  setting: Pick<ExposedProperty, "id" | "label" | "type">
): { name: string; label: string; type: string } {
  return {
    name: setting.id,
    label: setting.label,
    type: READ_AS[setting.type],
  };
}

/** A stored setting, read only where its id, label and type are usable. */
function readableSetting(
  entry: unknown
): Pick<ExposedProperty, "id" | "label" | "type"> | undefined {
  if (!isPlainRecord(entry)) return undefined;
  const { id, label, type } = entry;
  if (typeof id !== "string" || typeof label !== "string") return undefined;
  return isSettingType(type) ? { id, label, type } : undefined;
}

/** Whether a stored value names a kind of setting this editor reads. */
function isSettingType(type: unknown): type is ExposedProperty["type"] {
  return typeof type === "string" && Object.hasOwn(READ_AS, type);
}

/** The setting's default: the value on its own block, at its path. */
function defaultOf(document: BlockDocument, setting: ExposedProperty): unknown {
  let value: unknown = findNode(document.nodes, setting.nodeId)?.props;
  for (const segment of setting.propPath.split(".")) {
    if (!isPlainRecord(value)) return undefined;
    value = Object.hasOwn(value, segment) ? value[segment] : undefined;
  }
  return value;
}

/**
 * A default as the row says it: its text, "(empty)" for none, and nothing
 * for a value that isn't text, such as a picture's reference.
 */
function shownDefault(
  value: unknown
): Pick<BindingFieldChoice, "preview" | "empty"> {
  if (value === undefined || value === null || value === "") {
    return { empty: true };
  }
  return typeof value === "string"
    ? { preview: value.slice(0, SHOWN_LENGTH) }
    : {};
}

/**
 * Where a setting binding reads, named for the chip, with the settings by
 * name; `undefined` for any other binding.
 */
export function settingBoundFrom(
  binding: Binding,
  document: BlockDocument
):
  | {
      readonly name: string;
      readonly fields: readonly { name: string; type: string; label: string }[];
      /** A setting is named by its whole id, never read as a path. */
      readonly whole: true;
    }
  | undefined {
  if (binding.source !== "setting") return undefined;
  const exposed: unknown = isPlainRecord(document) ? document.exposed : [];
  const fields = (Array.isArray(exposed) ? (exposed as unknown[]) : []).flatMap(
    entry => {
      const setting = readableSetting(entry);
      return setting === undefined ? [] : [settingField(setting)];
    }
  );
  return { name: COMPONENT_SETTINGS_SOURCE, fields, whole: true };
}

/** What a setting does for the pages using the component. */
const SETTINGS_HINT = "Each page that places it can set its own value.";

/**
 * How many pages use the component, as its view counts them, then the hint:
 * "Used on 4 pages. Each page that places it can set its own value." A count
 * not yet whole is said as a floor, and no count, the hint alone.
 */
function settingsReachLine(pages: ComponentFieldsHost["pages"]): string {
  // None counted yet, with the count not whole, says nothing of a floor.
  if (pages === undefined || (pages.count === 0 && !pages.complete)) {
    return SETTINGS_HINT;
  }
  if (pages.count === 0) return `Not used on any page yet. ${SETTINGS_HINT}`;
  const noun = pages.count === 1 ? "page" : "pages";
  const floor = pages.complete ? "" : "at least ";
  return `Used on ${floor}${pages.count} ${noun}. ${SETTINGS_HINT}`;
}

/** The line above the settings, from the component's view. */
export function SettingsReach(): React.JSX.Element {
  const fields = React.useContext(ComponentFieldsContext);
  return (
    <p className="nx-binding-picker__reach">
      {settingsReachLine(fields?.pages)}
    </p>
  );
}

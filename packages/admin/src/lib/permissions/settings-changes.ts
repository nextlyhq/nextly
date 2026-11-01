/**
 * Which changes to settings a reader may make, as the server allows them:
 * create, update and delete on settings, each its own permission (a role still
 * holding `manage-settings` holds all three). A settings page is seen on
 * `read-settings`; each control that changes something is offered only to a
 * reader holding the permission its change asks, so a read-only role sees the
 * page read-only rather than a Save, an add or a delete the server refuses.
 *
 * @module lib/permissions/settings-changes
 */
import {
  CREATE_SETTINGS,
  DELETE_SETTINGS,
  UPDATE_SETTINGS,
} from "./system-policy";

export interface SettingsChanges {
  readonly create: boolean;
  readonly update: boolean;
  readonly delete: boolean;
}

/** The settings changes `hasPermission` allows. */
export function settingsChangesAllowed(
  hasPermission: (permission: string) => boolean
): SettingsChanges {
  return {
    create: hasPermission(CREATE_SETTINGS),
    update: hasPermission(UPDATE_SETTINGS),
    delete: hasPermission(DELETE_SETTINGS),
  };
}

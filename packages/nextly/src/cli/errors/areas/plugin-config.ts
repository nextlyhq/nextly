/**
 * Codes for what a plugin declares in the configuration: its routes, schema contributions,
 * permissions, admin widgets, client configuration, document views and blocks.
 *
 * Each is refused while the configuration loads, so any command that loads it can end with one.
 * The refusals keep a generic public message ("Plugin configuration is invalid.") for the HTTP
 * surface and write the sentence an author acts on to `logMessage`, which names the plugin and the
 * declaration. These read that sentence, splitting it into what, why and next where it already
 * says all three, rather than rewording it. Plugin resolution raises one code for many causes,
 * told apart by `logContext.reason`, and each reason here has a code of its own.
 *
 * @module cli/errors/areas/plugin-config
 */

import type { CrossFileIssue } from "../../../domains/schema/ui-schema/cross-file";
import type { NextlyError } from "../../../errors/nextly-error";
import { CliError, type CliErrorParts } from "../cli-error";
import { defineCodes, type FromError } from "../define";
import {
  asSentence,
  contextNames,
  contextNumber,
  contextString,
} from "../messages";

/** A string the error's log context carries under `key`, or `fallback`. */
function field(error: NextlyError, key: string, fallback = ""): string {
  return contextString(error, key) ?? fallback;
}

/** A number the error's log context carries under `key`, as text. */
function count(error: NextlyError, key: string): string {
  const value = contextNumber(error, key);
  return value === undefined ? "" : String(value);
}

/** The strings the error's log context lists under `key`. */
function names(error: NextlyError, key: string): string[] {
  return contextNames(error, key);
}

/** The sentence the throw site wrote for whoever fixes it; the public message is generic. */
function detail(error: NextlyError): string {
  return (error.logMessage ?? error.publicMessage).trim();
}

/**
 * `text` closed with a stop, its first letter kept: a problem that begins with an option's name
 * (`rawBody is only meaningful …`) must not have that name capitalised.
 */
function closed(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** `message` either side of `marker`, or undefined when the marker is not in it. */
function cut(message: string, marker: string): [string, string] | undefined {
  const at = message.indexOf(marker);
  if (at === -1) return undefined;
  return [message.slice(0, at), message.slice(at + marker.length)];
}

/**
 * A message that says what happened and then, from `marker` on, what to do, as its two parts.
 * `marker` begins the next step and stays in it, unless it is only the separator `"; "`. The
 * whole message is what happened when the marker is missing.
 */
function whatThenNext(
  message: string,
  marker: string,
  fallbackNext: string
): { what: string; next: string } {
  const parts = cut(message, marker);
  if (parts === undefined) return { what: message, next: fallbackNext };
  const next =
    marker.trim() === ";"
      ? asSentence(parts[1])
      : `${marker.trimStart()}${parts[1]}`.trim();
  return { what: asSentence(parts[0]), next };
}

/** Owners as a reader names them: `app` is the configuration itself. */
function ownersOf(error: NextlyError): string {
  const owners = names(error, "owners").map(owner =>
    owner === "app" ? "`nextly.config.ts`" : `"${owner}"`
  );
  return owners.join(" and ");
}

/** A plugin resolution refusal with the given reason. */
function resolved(
  reason: string,
  describe: (error: NextlyError) => CliErrorParts
): FromError[] {
  return [{ code: "PLUGIN_RESOLUTION_ERROR", reason, describe }];
}

/**
 * A plugin's admin widget or client configuration that is not JSON: the first sentence names the
 * plugin and the keys, and the rest says why only JSON can be sent.
 */
function notJson(error: NextlyError, declared: string): CliErrorParts {
  const message = detail(error);
  const parts = cut(message, ". It is serialized");
  const keys = names(error, "keys");
  return {
    what: parts === undefined ? message : `${parts[0]}.`,
    why:
      parts === undefined
        ? "It is sent to the browser as JSON, so it may hold only strings, numbers, booleans, null, arrays and plain objects."
        : `It is serialized${parts[1]}`,
    next:
      keys.length > 0
        ? `Remove ${keys.map(key => `\`${key}\``).join(", ")} from ${declared}, or give ${keys.length === 1 ? "it" : "each"} a value of strings, numbers, booleans, null, arrays or plain objects.`
        : `Declare ${declared} as plain JSON: strings, numbers, booleans, null, arrays and plain objects.`,
  };
}

export const PLUGIN_CONFIG_CODES = defineCodes({
  PLUGIN_ROUTE_COLLISION: {
    cause: "Two plugin routes answer the same method and path.",
    from: [
      {
        code: "NEXTLY_ROUTE_COLLISION",
        describe: error => ({
          what: asSentence(detail(error)),
          why: "Both patterns match the same requests with as many fixed segments each, so nothing decides which of them answers.",
          next: "Change the path of one of the two routes, or configure only one of the two plugins in `nextly.config.ts`.",
        }),
      },
    ],
  },
  PLUGIN_ROUTE_PATH_INVALID: {
    cause: "A plugin declares a route whose path does not start with `/`.",
    from: [
      {
        code: "NEXTLY_ROUTE_INVALID_PATH",
        describe: error => ({
          what: asSentence(detail(error)),
          why: "A route's path is mounted under `/plugins/<plugin>`, so it must be absolute within that namespace.",
          next: `Start the route's path with "/", as in "/${field(error, "path")}".`,
        }),
      },
    ],
  },
  PLUGIN_ROUTE_ROOT_UNREACHABLE: {
    cause:
      "A plugin declares a root-mounted route at a path a request never reaches it on.",
    from: [
      {
        code: "NEXTLY_ROUTE_UNREACHABLE_ROOT",
        describe: error => {
          const parts = cut(detail(error), ", which cannot answer: ");
          return {
            what:
              parts === undefined
                ? asSentence(detail(error))
                : `${parts[0]}, which cannot answer.`,
            why:
              parts === undefined
                ? "Another handler answers that path before the root pass is consulted."
                : asSentence(parts[1]),
            next: 'Leave the route under the plugin\'s namespace (`mount: "plugin"`), or move it to a path whose first segment no built-in handler claims.',
          };
        },
      },
    ],
  },
  PLUGIN_ROUTE_MOUNT_INVALID: {
    cause:
      'A plugin declares a route whose `mount` is neither "plugin" nor "root".',
    from: [
      {
        code: "NEXTLY_ROUTE_INVALID_MOUNT",
        describe: error => {
          const parts = cut(detail(error), "; expected ");
          return {
            what: asSentence(parts?.[0] ?? detail(error)),
            why: `A route is registered under the mount it declares and looked up under "plugin" or "root", so it would never match.`,
            next: 'Set the route\'s `mount` to "plugin" or "root", or leave it out for "plugin".',
          };
        },
      },
    ],
  },
  PLUGIN_ROUTE_OPTIONS_INVALID: {
    cause:
      "A plugin declares a route option that cannot mean what it says, such as a raw body on a method without one.",
    from: resolved("invalid-route-options", error => {
      const route = cut(detail(error), ": ");
      return {
        what:
          route === undefined
            ? asSentence(detail(error))
            : `${route[0]} declares an option that cannot apply.`,
        why: closed(route?.[1] ?? field(error, "problem")),
        next: "Correct the option named in the route's declaration in the plugin.",
      };
    }),
  },

  PLUGIN_SLUG_COLLISION: {
    cause:
      "A plugin contributes an entity whose slug the configuration or another plugin already uses.",
    from: [
      {
        code: "NEXTLY_SCHEMA_SLUG_COLLISION",
        describe: error => ({
          what: asSentence(detail(error)),
          why: `A slug names one collection, single or field group, and "${field(error, "slug")}" is claimed twice; "code" is \`nextly.config.ts\`.`,
          next: `Rename the entity in \`nextly.config.ts\`, or rename the plugin's with \`.rename()\`, for example \`plugin.rename({ "${field(error, "slug")}": "new-slug" })\`.`,
        }),
      },
    ],
  },
  PLUGIN_EXTEND_TARGET_UNKNOWN: {
    cause:
      "A plugin extends an entity that neither the configuration, a plugin nor the Schema Builder declares.",
    from: [
      {
        code: "NEXTLY_SCHEMA_EXTEND_TARGET_UNKNOWN",
        describe: error => {
          const parts = cut(detail(error), " (");
          return {
            what: asSentence(parts?.[0] ?? detail(error)),
            why: `"${field(error, "target")}" is not a code-first or plugin collection, single or field group in the merged schema, and the Schema Builder has none by that slug.`,
            next: `Correct the target "${field(error, "target")}" in the plugin's \`contributes.extend\`, or create the entity it names.`,
          };
        },
      },
    ],
  },
  PLUGIN_EXTEND_FIELD_DUPLICATE: {
    cause:
      "A plugin extends an entity with a field whose name the entity already has.",
    from: [
      {
        code: "NEXTLY_SCHEMA_EXTEND_FIELD_DUPLICATE",
        describe: error => ({
          what: asSentence(detail(error)),
          why: `"${field(error, "target")}" already has a field named "${field(error, "field")}", of its own or added by another plugin; names are compared without regard to case.`,
          next: `Rename the field "${field(error, "field")}" in the plugin's \`contributes.extend\`, or rename the target's own field.`,
        }),
      },
    ],
  },
  RELATION_TARGET_UNKNOWN: {
    cause:
      "A relationship field in the configuration or a plugin names a collection that does not exist.",
    from: [
      {
        code: "NEXTLY_SCHEMA_RELATION_TARGET_MISSING",
        describe: error => ({
          what: asSentence(detail(error)),
          why: `No collection in \`nextly.config.ts\`, its plugins or the Schema Builder has the slug "${field(error, "target")}", and it is not \`users\` or \`media\`.`,
          next: `Set \`relationTo\` on "${field(error, "source")}.${field(error, "field")}" to an existing collection, or create the collection "${field(error, "target")}".`,
        }),
      },
    ],
  },
  PLUGIN_RENAME_TARGET_UNKNOWN: {
    cause:
      "A plugin's `.rename()` names an entity the plugin does not contribute.",
    from: [
      {
        code: "NEXTLY_SCHEMA_RENAME_UNKNOWN_TARGET",
        describe: error => ({
          what: asSentence(detail(error)),
          why: "`.rename()` renames only the collections, singles and field groups the plugin itself contributes.",
          next: `Remove "${field(error, "target")}" from the \`.rename()\` map in \`nextly.config.ts\`, or correct it to a slug the plugin contributes.`,
        }),
      },
    ],
  },
  PLUGIN_RELATION_DEPENDENCY_UNDECLARED: {
    cause:
      "A plugin relates to another plugin's entity without declaring that plugin in `dependsOn`.",
    from: [
      {
        code: "NEXTLY_SCHEMA_CROSS_PLUGIN_RELATION",
        describe: error => ({
          what: asSentence(detail(error)),
          why: `A plugin can relate to another plugin's entity only when it depends on that plugin, so "${field(error, "targetPlugin")}" is sure to be configured and set up first.`,
          next: `Add "${field(error, "targetPlugin")}" to the \`dependsOn\` of "${field(error, "sourcePlugin")}", with the range of its versions that it supports.`,
        }),
      },
    ],
  },
  BUILDER_SLUG_COLLISION: {
    cause:
      "An entity in `ui-schema.json` has the slug of a collection in `nextly.config.ts`.",
  },
  BUILDER_RELATION_TARGET_UNKNOWN: {
    cause:
      "A relationship field in `ui-schema.json` names a collection that neither file declares.",
  },

  PLUGIN_PERMISSION_DUPLICATE: {
    cause: "The same custom permission is declared twice.",
    from: [
      {
        code: "NEXTLY_PERMISSION_COLLISION",
        reason: "duplicate-permission",
        describe: error => ({
          what: `The custom permission "${field(error, "action")}-${field(error, "resource")}" is declared twice, by ${ownersOf(error)}.`,
          why: "A permission is one action on one resource, compared without regard to case, and the database holds one row for it.",
          next: "Remove one of the two declarations, or give one of them another action or resource.",
        }),
      },
    ],
  },
  PLUGIN_PERMISSION_SYSTEM_RESOURCE: {
    cause:
      "A custom permission is declared on a resource Nextly reserves for its own permissions.",
    from: [
      {
        code: "NEXTLY_PERMISSION_COLLISION",
        reason: "system-resource-reserved",
        describe: error => ({
          what: `The custom permission "${field(error, "action")}-${field(error, "resource")}", declared by ${ownersOf(error)}, is on a resource Nextly reserves.`,
          why: `"${field(error, "resource")}" is one of Nextly's own resources, whose permissions it seeds itself.`,
          next: "Declare the permission on a resource of the plugin's own.",
        }),
      },
    ],
  },
  PLUGIN_PERMISSION_CRUD_RESERVED: {
    cause:
      "A custom permission repeats one Nextly creates itself for a collection or single.",
    from: [
      {
        code: "NEXTLY_PERMISSION_COLLISION",
        reason: "crud-permission-reserved",
        describe: error => ({
          what: `The custom permission "${field(error, "action")}-${field(error, "resource")}", declared by ${ownersOf(error)}, repeats one Nextly creates.`,
          why: `Nextly creates "${field(error, "action")}" on "${field(error, "resource")}" itself, for the collection or single with that slug.`,
          next: "Remove the declaration, since the permission already exists, or name another action for what it guards.",
        }),
      },
    ],
  },

  PLUGIN_ADMIN_WIDGET_NOT_JSON: {
    cause:
      "A plugin's admin widget holds a value that cannot be sent to the browser as JSON.",
    from: [
      {
        code: "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID",
        when: error => Array.isArray(error.logContext?.keys),
        describe: error =>
          notJson(error, "the widget in `contributes.admin.widgets`"),
      },
    ],
  },
  PLUGIN_ADMIN_WIDGET_UNDRAWABLE: {
    cause:
      "A plugin's admin widget describes neither a component nor an archetype the admin can draw.",
    from: [
      {
        code: "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID",
        describe: error => {
          // "Plugin … that <reason>. A widget is drawn one of two ways …: ship a … whichever way
          // you choose. The type states this too, …": what, then why, with the how in between.
          const message = detail(error);
          const head = cut(message, ". A widget is drawn");
          const how =
            head === undefined ? undefined : cut(head[1], ": ship a ");
          const rest =
            how === undefined ? undefined : cut(how[1], " The type states");
          if (head === undefined || how === undefined || rest === undefined) {
            return {
              what: message,
              why: "A widget must ship a `component`, or declare an `archetype` other than `custom` with the `query` the host draws it from.",
              next: "Give the widget a `component`, or an `archetype` and its `query`, and an `id` of real text.",
            };
          }
          return {
            what: `${head[0]}.`,
            why: `A widget is drawn${how[0]}. The type states${rest[1]}`,
            next: `Ship a ${rest[0]}`,
          };
        },
      },
    ],
  },
  PLUGIN_CLIENT_CONFIG_NOT_JSON: {
    cause:
      "A plugin's `admin.clientConfig` holds a value that cannot be sent to the browser as JSON.",
    from: [
      {
        code: "NEXTLY_PLUGIN_CLIENT_CONFIG_INVALID",
        describe: error => notJson(error, "`contributes.admin.clientConfig`"),
      },
    ],
  },
  PLUGIN_DOCUMENT_VIEW_COLLISION: {
    cause: "Two plugin document views answer the same address.",
    from: [
      {
        code: "NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID",
        when: error => typeof error.logContext?.other === "string",
        describe: error => {
          const parts = cut(
            detail(error),
            ". One address can draw one screen: "
          );
          return {
            what: asSentence(parts?.[0] ?? detail(error)),
            why: "One address can draw one screen.",
            next: asSentence(parts?.[1] ?? "Rename one of the two paths"),
          };
        },
      },
    ],
  },
  PLUGIN_DOCUMENT_VIEW_FIELD_TYPE_UNOWNED: {
    cause:
      "A plugin scopes a document view to a field type the plugin does not contribute.",
    from: [
      {
        code: "NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID",
        when: error =>
          detail(error).includes(
            "a field type this plugin does not contribute"
          ),
        describe: error => {
          const parts = cut(detail(error), ". A view can be scoped");
          return {
            what: asSentence(parts?.[0] ?? detail(error)),
            why: asSentence(
              `A view can be scoped${parts?.[1] ?? " only to one of its own field types"}`
            ),
            next: "Scope the view to a field type the plugin contributes, or to a collection by its slug.",
          };
        },
      },
    ],
  },
  PLUGIN_DOCUMENT_VIEW_INVALID: {
    cause:
      "A plugin declares a document view with no component, a label that is not text, or a path the admin cannot route.",
    from: [
      {
        code: "NEXTLY_PLUGIN_DOCUMENT_VIEW_INVALID",
        describe: error => ({
          what: asSentence(detail(error)),
          why: "A document view needs a component to draw, a label of text if it has one, and a path of one address segment, of lowercase letters, digits and single dashes, that the document does not already use.",
          next: "Correct the view the message names in the plugin's `contributes.admin`.",
        }),
      },
    ],
  },
  BLOCK_SCHEMA_DERIVATION_FAILED: {
    cause:
      "The block document schema could not be derived, because something in the process extended `Object.prototype`.",
    from: [
      {
        code: "SCHEMA_DERIVATION_FAILED",
        describe: error => ({
          what: error.publicMessage,
          why:
            field(error, "cause") ||
            "The emitted schema lost the block node's fields.",
          next: "Find the code that adds properties to `Object.prototype`, often a dependency, and remove it; `--verbose` shows where the schema was derived.",
        }),
      },
    ],
  },

  PLUGIN_DEPENDENCY_MISSING: {
    cause:
      "A plugin depends on another plugin that the configuration does not list.",
    from: resolved("missing-dependency", error => ({
      what: detail(error),
      why: `"${field(error, "dependency")}" is in the \`dependsOn\` of "${field(error, "plugin")}", and not in \`plugins\` in \`nextly.config.ts\`.`,
      next: `Add "${field(error, "dependency")}" to \`plugins\` in \`nextly.config.ts\`, or install a release of "${field(error, "plugin")}" that does not need it.`,
    })),
  },
  PLUGIN_DEPENDENCY_CYCLE: {
    cause: "Plugins depend on one another in a cycle.",
    from: resolved("dependency-cycle", error => ({
      what: detail(error),
      why: "Each plugin is set up after the plugins it depends on, so in a cycle none of them can be set up first.",
      next: "Remove one `dependsOn` or `optionalDependsOn` entry from a plugin in the cycle.",
    })),
  },
  PLUGIN_NEXTLY_RANGE_INVALID: {
    cause: "A plugin's `nextly` field is not a valid range of Nextly versions.",
    from: resolved("invalid-nextly-range", error => ({
      what: detail(error),
      why: "`nextly` must be a semver range, such as `^1.2.0`, so it can be checked against the installed version.",
      next: `Correct the \`nextly\` range of "${field(error, "plugin")}", or install a release of it that declares a valid one.`,
    })),
  },
  PLUGIN_NEXTLY_INCOMPATIBLE: {
    cause:
      "A plugin requires a version of Nextly other than the one installed.",
    from: resolved("core-incompatible", error => ({
      what: detail(error),
      why: `The installed \`nextly\` is outside the plugin's \`nextly\` range, ${field(error, "range")}.`,
      next: `Install a release of "${field(error, "plugin")}" that supports Nextly ${field(error, "coreVersion")}, or a version of \`nextly\` in ${field(error, "range")}.`,
    })),
  },
  PLUGIN_DEPENDENCY_VERSION_INCOMPATIBLE: {
    cause:
      "A plugin depends on another plugin at a version other than the one configured.",
    from: resolved("version-incompatible", error => ({
      what: detail(error),
      why: `The configured "${field(error, "dependency")}" is outside the range the \`dependsOn\` of "${field(error, "plugin")}" accepts.`,
      next: `Install a version of "${field(error, "dependency")}" in ${field(error, "range")}, or a release of "${field(error, "plugin")}" that accepts ${field(error, "actual")}.`,
    })),
  },
  PLUGIN_OPTIONAL_DEPENDENCY_VERSION_INCOMPATIBLE: {
    cause:
      "A plugin optionally depends on another plugin, and the configured version is outside the range it accepts.",
    from: resolved("optional-version-incompatible", error => ({
      what: detail(error),
      why: `An optional dependency need not be configured, but once it is, its version must be in the plugin's \`optionalDependsOn\` range.`,
      next: `Install a version of "${field(error, "dependency")}" in ${field(error, "range")}, or a release of "${field(error, "plugin")}" that accepts ${field(error, "actual")}.`,
    })),
  },
  PLUGIN_MENU_COLLECTION_UNOWNED: {
    cause:
      "A plugin's menu item names a collection the plugin does not contribute.",
    from: resolved("menu-item-unowned-collection", error => ({
      ...whatThenNext(
        detail(error),
        " Name one of: ",
        "Name one of the plugin's own collections in the menu item."
      ),
      why: "A plugin's menu items link only to the collections the plugin itself contributes.",
    })),
  },
  PLUGIN_SETTINGS_PERMISSION_WITHOUT_SETTINGS: {
    cause:
      "A plugin declares `settingsPermission` but no settings schema for it to guard.",
    from: resolved("settings-permission-without-settings", error => ({
      what: detail(error),
      why: "`settingsPermission` guards the plugin's settings, and the plugin declares no `contributes.settings`.",
      next: "Add the settings schema under `contributes.settings`, or remove `settingsPermission`.",
    })),
  },
  PLUGIN_SETTINGS_PERMISSION_UNDECLARED: {
    cause:
      "A plugin's `settingsPermission` is not one of the permissions the plugin declares.",
    from: resolved("settings-permission-undeclared", error => ({
      what: detail(error),
      why: "`settingsPermission` must name a permission the plugin declares itself, so that a role can be given it.",
      next: `Declare "${field(error, "settingsPermission")}" among the plugin's own permissions, or set \`settingsPermission\` to one it already declares.`,
    })),
  },
  PLUGIN_LIMIT_RULE_INVALID: {
    cause: "A plugin declares a limit rule that cannot be enforced.",
    from: resolved("limit-rule-invalid", error => ({
      what: detail(error),
      why: "A limit rule is checked when the configuration loads, so a rule that cannot be enforced stops the start rather than letting every request past.",
      next: `Correct the limit rule "${field(error, "rule")}" so that it does what the message says it must.`,
    })),
  },
  PLUGIN_ADMIN_SLUG_COLLISION: {
    cause: "Two plugins' names resolve to the same admin slug.",
    from: resolved("duplicate-admin-slug", error => ({
      ...whatThenNext(detail(error), " Rename one", "Rename one of them."),
      why: "A plugin's admin slug is made from its name, and these two names make the same one.",
    })),
  },
  PLUGIN_EVENT_NAME_RESERVED: {
    cause: "A plugin declares an event under the prefix Nextly reserves.",
    from: resolved("plugin-event-name-reserved", error => ({
      what: detail(error),
      why: "Events under that prefix are Nextly's own, so a plugin's would be taken for one of them.",
      next: "Rename the event so that it starts with the plugin's admin slug and a dot.",
    })),
  },
  PLUGIN_EVENT_OUTSIDE_NAMESPACE: {
    cause:
      "A plugin declares an event whose name does not start with the plugin's prefix.",
    from: resolved("plugin-event-outside-namespace", error => ({
      what: detail(error),
      why: "A plugin's events are named under its admin slug, so no two plugins emit the same event.",
      next: `Rename the event "${field(error, "event")}" so that it starts with "${field(error, "expectedPrefix")}".`,
    })),
  },
  PLUGIN_CHALLENGE_ID_RESERVED: {
    cause:
      "A plugin declares a sign-in challenge under the id Nextly reserves for its forced password change.",
    from: resolved("plugin-challenge-id-reserved", error => ({
      what: detail(error),
      why: "A challenge is looked up by its id, so the plugin's would stand in for Nextly's own.",
      next: `Give the challenge "${field(error, "challengeId")}" another id.`,
    })),
  },
  PLUGIN_CHALLENGE_ID_DUPLICATE: {
    cause: "A sign-in challenge id is declared more than once.",
    from: resolved("plugin-challenge-id-duplicate", error => {
      const [first, second] = names(error, "plugins");
      return {
        what: detail(error),
        why: "A challenge is looked up by its id, so each id names one challenge.",
        next:
          first === second
            ? `Declare the challenge "${field(error, "challengeId")}" once in "${first}".`
            : `Rename the challenge "${field(error, "challengeId")}" in one of the two plugins.`,
      };
    }),
  },
  PLUGIN_HOOK_POINT_RESERVED: {
    cause: "A plugin declares a hook point under the prefix Nextly reserves.",
    from: resolved("hook-point-reserved", error => ({
      what: detail(error),
      why: "Hook points under that prefix are Nextly's own seams, so a plugin's would be taken for one of them.",
      next: `Rename the hook point "${field(error, "hookPoint")}" so that it starts with the plugin's admin slug and a dot.`,
    })),
  },
  PLUGIN_HOOK_POINT_OUTSIDE_NAMESPACE: {
    cause:
      "A plugin declares a hook point whose name does not start with the plugin's prefix.",
    from: resolved("hook-point-outside-prefix", error => ({
      what: detail(error),
      why: "A plugin's hook points are named under its admin slug, so no two plugins declare the same one.",
      next: `Rename the hook point "${field(error, "hookPoint")}" so that it starts with "${field(error, "expectedPrefix")}.".`,
    })),
  },
  PLUGIN_HOOK_POINT_COLLISION: {
    cause: "Two plugins declare the same hook point.",
    from: resolved("hook-point-collision", error => ({
      what: detail(error),
      why: "A hook point is looked up by its name, so each name is declared by one plugin.",
      next: `Rename the hook point "${field(error, "hookPoint")}" in one of the two plugins.`,
    })),
  },
  PLUGIN_HOOK_POINT_KIND_MISMATCH: {
    cause:
      "A hook point was executed as a kind other than the one its plugin declares.",
    from: resolved("hook-point-kind-mismatch", error => {
      const parts = cut(detail(error), ". ");
      return {
        what: parts === undefined ? detail(error) : `${parts[0]}.`,
        why:
          parts?.[1] ??
          "A hook point runs only as the kind its plugin declares.",
        next: `Execute "${field(error, "point")}" as a ${field(error, "declared")}, the kind its plugin declares.`,
      };
    }),
  },
  PLUGIN_PRINCIPAL_KIND_INVALID: {
    cause: "A plugin registers a kind of signed-in person that cannot be used.",
    from: resolved("principal-kind-invalid", error => {
      const parts = cut(detail(error), " cannot be used: ");
      return {
        what:
          parts === undefined ? detail(error) : `${parts[0]} cannot be used.`,
        why: closed(parts?.[1] ?? field(error, "problem")),
        next: "Correct the plugin's `contributes.principals` entry as the Why line says.",
      };
    }),
  },
  PLUGIN_PRINCIPAL_KIND_COLLISION: {
    cause: "Two plugins register the same kind of signed-in person.",
    from: resolved("principal-kind-collision", error => ({
      what: detail(error),
      why: "A kind of signed-in person is recognised by its full name, so each name is registered once.",
      next: `Rename the kind "${field(error, "principalKind")}" in one of the two plugins.`,
    })),
  },
  PLUGIN_AUDIT_KIND_OUTSIDE_NAMESPACE: {
    cause:
      "A plugin declares an audit kind whose name does not start with the plugin's prefix.",
    from: resolved("plugin-audit-kind-outside-prefix", error => ({
      what: detail(error),
      why: "A plugin's audit kinds are named under its admin slug, so no two plugins record the same kind.",
      next: `Rename the audit kind "${field(error, "auditKind")}" so that it starts with "${field(error, "expectedPrefix")}.".`,
    })),
  },
  PLUGIN_AUDIT_KIND_INVALID: {
    cause:
      "A plugin declares an audit kind with characters an audit kind cannot hold.",
    from: resolved("plugin-audit-kind-invalid", error => {
      const parts = cut(detail(error), "; ");
      return {
        what: parts === undefined ? detail(error) : `${parts[0]}.`,
        why: asSentence(
          parts?.[1] ??
            "A kind may use only lowercase letters, digits, dots, underscores and dashes"
        ),
        next: "Rename the audit kind using only those characters.",
      };
    }),
  },
  PLUGIN_AUDIT_KIND_TOO_LONG: {
    cause:
      "A plugin declares an audit kind longer than the audit trail can store.",
    from: resolved("plugin-audit-kind-too-long", error => ({
      what: detail(error),
      why: "The audit trail stores each entry's kind in a column of that width.",
      next: `Shorten the audit kind to ${count(error, "maxLength")} characters or fewer.`,
    })),
  },
  PLUGIN_AUDIT_KIND_DUPLICATE: {
    cause: "A plugin declares the same audit kind more than once.",
    from: resolved("plugin-audit-kind-declared-twice", error => ({
      ...whatThenNext(
        detail(error),
        "; ",
        "Declare it once with the full list of metadata keys."
      ),
      why: "An audit kind is declared once, with every metadata key it records.",
    })),
  },
  PLUGIN_CAPABILITY_NOT_CONSENTED: {
    cause:
      "A plugin declares a capability that needs the app's consent, and `nextly.config.ts` does not give it.",
    from: resolved("capability-not-listed", error => ({
      ...whatThenNext(
        detail(error),
        " Review the plugin, then ",
        "Review the plugin, then list it for the capability in `nextly.config.ts`."
      ),
      why: "A capability that reaches this far is granted only to the plugins the app lists for it by name.",
    })),
  },
  PLUGIN_CODE_REPLACED_BY_SETUP: {
    cause:
      "A `setup` transformer changed the code of a plugin that holds a capability the app consented to.",
    from: resolved("plugin-code-replaced-by-setup", error => {
      const head = cut(detail(error), " That capability grants ");
      const tail =
        head === undefined
          ? undefined
          : cut(head[1], " Leave the definitions ");
      return {
        what: head?.[0] ?? detail(error),
        why:
          tail === undefined
            ? "The app's consent covers the plugin it configured, with that plugin's own code."
            : `That capability grants ${tail[0]}`,
        next:
          tail === undefined
            ? "Leave the definitions of plugins that declare the capability as configured in setup transformers."
            : `Leave the definitions ${tail[1]}`,
      };
    }),
  },
  PLUGIN_CAPABILITY_ADDED_BY_SETUP: {
    cause:
      "A `setup` transformer gave a plugin a capability that needs the app's consent.",
    from: resolved("capability-added-by-setup", error => {
      const head = cut(detail(error), " That capability grants ");
      const tail = head === undefined ? undefined : cut(head[1], " Declare ");
      return {
        what: head?.[0] ?? detail(error),
        why:
          tail === undefined
            ? "The app's consent covers only a plugin that declares the capability in its own manifest."
            : `That capability grants ${tail[0]}`,
        next:
          tail === undefined
            ? "Declare the capability in the manifest of the plugin the app configures, rather than in a setup transformer."
            : `Declare ${tail[1]}`,
      };
    }),
  },
  PLUGIN_CAPABILITY_UNKNOWN: {
    cause: "A plugin declares a capability Nextly does not define.",
    from: resolved("unknown-capability", error => ({
      what: detail(error),
      why: "`capabilities` accepts only the capabilities Nextly defines: `net`, `db`, `secrets` and `auth`.",
      next: `Remove "${field(error, "capability")}" from the plugin's \`capabilities\`, or correct its spelling.`,
    })),
  },
  PLUGIN_SCHEMA_VERSION_INVALID: {
    cause: "A plugin's `schemaVersion` is not a positive integer.",
    from: resolved("invalid-schema-version", error => {
      const parts = cut(detail(error), "; ");
      return {
        what: parts === undefined ? detail(error) : `${parts[0]}.`,
        why: asSentence(parts?.[1] ?? "It must be a positive integer"),
        next: "Set the plugin's `schemaVersion` to a positive integer, such as `1`, or install a release of the plugin that does.",
      };
    }),
  },
  PLUGIN_MANIFEST_INVALID: {
    cause: "A plugin's definition has a field of the wrong shape.",
    from: resolved("invalid-manifest", error => {
      const parts = cut(detail(error), `at "${field(error, "path")}": `);
      return {
        what:
          parts === undefined
            ? detail(error)
            : `${parts[0]}at "${field(error, "path")}".`,
        why: asSentence(parts?.[1] ?? field(error, "issue")),
        next: `Correct \`${field(error, "path")}\` in the plugin's definition, or install a release of the plugin whose definition is valid.`,
      };
    }),
  },
  PLUGIN_OUTBOUND_HOST_INVALID: {
    cause:
      "A plugin declares an outbound host that is not a hostname with an optional port.",
    from: resolved("invalid-outbound-host", error => ({
      what: detail(error),
      why: "Each `capabilities.net.outbound` entry is a hostname, with an optional port, such as `api.example.com:443`; not a URL or an IP address.",
      next: `Replace "${field(error, "host")}" with the hostname alone, and its port if it needs one.`,
    })),
  },
  PLUGIN_SECRETS_WITHOUT_SETTINGS: {
    cause: "A plugin declares secret paths but no settings schema.",
    from: resolved("secrets-without-settings", error => ({
      what: detail(error),
      why: "A secret path names a setting to encrypt, so without `contributes.settings` it names nothing.",
      next: "Add the settings schema under `contributes.settings`, or remove `capabilities.secrets`.",
    })),
  },
  PLUGIN_SECRET_PATH_DUPLICATE: {
    cause: "A plugin declares the same secret path twice.",
    from: [
      {
        code: "PLUGIN_RESOLUTION_ERROR",
        reason: "invalid-secret-path",
        when: error => typeof error.logContext?.path === "string",
        describe: error => ({
          what: detail(error),
          why: "Each setting is encrypted once, so each path is listed once.",
          next: `Remove the second "${field(error, "path")}" from \`capabilities.secrets\`.`,
        }),
      },
    ],
  },
  PLUGIN_SECRET_PATH_EMPTY: {
    cause: "A plugin declares an empty secret path.",
    from: resolved("invalid-secret-path", error => ({
      what: detail(error),
      why: "Each entry in `capabilities.secrets` names a setting by its dotted path in `contributes.settings`.",
      next: "Remove the empty entry from `capabilities.secrets`, or write the path of the setting it is for.",
    })),
  },
  PLUGIN_SECRET_PATH_UNKNOWN: {
    cause:
      "A plugin declares a secret path its settings schema does not contain.",
    from: resolved("unknown-secret-path", error => ({
      what: detail(error),
      why: "A secret path the schema does not have would leave the credential it is for stored in plain text.",
      next: `Correct "${field(error, "path")}" to the path of a setting in \`contributes.settings\`, or add that setting.`,
    })),
  },
  PLUGIN_SECRET_PATH_NAMES_GROUP: {
    cause:
      "A plugin's secret path names a group of settings rather than one value.",
    from: resolved("secret-path-names-group", error => ({
      ...whatThenNext(detail(error), "; ", "Name the value inside it."),
      why: "A secret is one stored value, so its path ends at a single setting.",
    })),
  },
  PLUGIN_SECRET_PATH_NOT_STRING: {
    cause:
      "A plugin's secret path names a setting whose value cannot be a string.",
    from: resolved("secret-path-not-string", error => {
      const parts = cut(detail(error), "; ");
      return {
        what: parts === undefined ? detail(error) : `${parts[0]}.`,
        why: asSentence(parts?.[1] ?? "a secret is stored as a string"),
        next: `Point "${field(error, "path")}" at a text setting, or make the setting it names a string.`,
      };
    }),
  },
  PLUGIN_NAME_TOO_LONG_FOR_SETTINGS: {
    cause:
      "A plugin that stores settings has a name longer than the settings storage holds.",
    from: resolved("plugin-name-too-long-for-settings", error => ({
      what: detail(error),
      why: "Settings are stored under the plugin's name, in a column of that width.",
      next: `Use a release of the plugin whose name is ${count(error, "maxLength")} characters or fewer.`,
    })),
  },
  PLUGIN_SETTINGS_KEY_TOO_LONG: {
    cause:
      "A plugin declares a settings key longer than the settings storage holds.",
    from: resolved("settings-key-too-long", error => ({
      what: detail(error),
      why: "Settings are stored by key, in a column of that width.",
      next: `Shorten "${field(error, "key")}" to ${count(error, "maxLength")} characters or fewer.`,
    })),
  },
  PLUGIN_CAPABILITY_PROVIDED_TWICE: {
    cause: "Two plugins provide the same capability.",
    from: resolved("capability-provided-twice", error => ({
      what: detail(error),
      why: "Each capability has one provider, so a plugin that requires it knows which implementation it gets.",
      next: `Configure only one of ${names(error, "providers")
        .map(name => `"${name}"`)
        .join(" and ")}, or disable one of them.`,
    })),
  },
  PLUGIN_CAPABILITY_MISSING: {
    cause: "A plugin requires a capability that no enabled plugin provides.",
    from: resolved("missing-capability", error => ({
      what: detail(error),
      why: `"${field(error, "capability")}" is in the \`requires\` of "${field(error, "plugin")}", and no enabled plugin lists it in \`provides\`.`,
      next: `Add and enable a plugin that provides "${field(error, "capability")}", or install a release of "${field(error, "plugin")}" that does not require it.`,
    })),
  },
  PLUGIN_CAPABILITY_VERSION_INCOMPATIBLE: {
    cause:
      "A plugin requires a capability at a version other than the one its provider offers.",
    from: resolved("capability-version-incompatible", error => ({
      what: detail(error),
      why: `The provider's version is outside the range in the \`requires\` of "${field(error, "plugin")}".`,
      next: `Install a version of "${field(error, "provider")}" in ${field(error, "range")}, or a release of "${field(error, "plugin")}" that accepts ${field(error, "providerVersion")}.`,
    })),
  },
});

/**
 * The checks between `nextly.config.ts` and `ui-schema.json`, as the command's error: one line
 * per issue. A slug both files declare comes first, since a relation to it reads differently
 * once it is fixed.
 */
export function builderSchemaConflict(
  issues: readonly CrossFileIssue[]
): CliError {
  const collisions = issues.filter(
    issue => issue.code === "NEXTLY_SCHEMA_SLUG_COLLISION"
  );
  const listed = issues.map(issue => issue.message).join("\n");
  if (collisions.length > 0) {
    return new CliError("BUILDER_SLUG_COLLISION", {
      what:
        collisions.length === 1
          ? "An entity is defined in both `nextly.config.ts` and `ui-schema.json`."
          : `${collisions.length} entities are defined in both \`nextly.config.ts\` and \`ui-schema.json\`.`,
      why: listed,
      next: "Remove each slug listed from one of the two files, or rename it in one of them, then run the command again.",
    });
  }
  return new CliError("BUILDER_RELATION_TARGET_UNKNOWN", {
    what:
      issues.length === 1
        ? "A field in `ui-schema.json` relates to a collection that does not exist."
        : `${issues.length} fields in \`ui-schema.json\` relate to collections that do not exist.`,
    why: listed,
    next: "Point each field listed at a collection in `nextly.config.ts` or `ui-schema.json`, or create the collection it names, then run the command again.",
  });
}

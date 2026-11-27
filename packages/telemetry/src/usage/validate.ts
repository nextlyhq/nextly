import {
  SITE_BASE_PROPERTIES,
  TOOLS_BASE_PROPERTIES,
  USAGE_EVENTS,
  type PropertySpec,
  type UsageSource,
} from "./catalog.js";

// The run-time half of the catalog. The types stop a wrong name or property
// at compile time; this stops whatever reaches the sender anyway, from a
// widened variable, a cast or plain JavaScript. A property the catalog does
// not list for the event is dropped; an optional property with a value the
// catalog does not allow is dropped; an event missing a required property,
// or carrying a wrong value for one, is dropped whole. Nothing here logs or
// throws: a bad event is never worth a message on someone's screen.

type PropertyMap = Readonly<Record<string, PropertySpec>>;

const patternCache = new Map<string, RegExp>();
function compiled(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    re = new RegExp(pattern);
    patternCache.set(pattern, re);
  }
  return re;
}

function matchesPattern(value: unknown, pattern: string, maxLength: number) {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    compiled(pattern).test(value)
  );
}

function isDistinctList(value: unknown): value is readonly unknown[] {
  if (!Array.isArray(value)) return false;
  // `every` skips the holes of a sparse list, which would then be sent as
  // `null`, so a list must have a value at every index.
  for (let i = 0; i < value.length; i++) {
    if (!(i in value)) return false;
  }
  return new Set(value).size === value.length;
}

type SpecOf<T extends PropertySpec["type"]> = Extract<
  PropertySpec,
  { type: T }
>;

/** One check per kind of property: whether `value` is one the spec allows. */
const CHECKS: {
  [T in PropertySpec["type"]]: (spec: SpecOf<T>, value: unknown) => boolean;
} = {
  enum: (spec, value) => (spec.values as readonly unknown[]).includes(value),
  boolean: (_spec, value) => typeof value === "boolean",
  integer: (spec, value) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= spec.min &&
    value <= spec.max,
  list: (spec, value) =>
    isDistinctList(value) &&
    value.every(item => (spec.values as readonly unknown[]).includes(item)),
  pattern: (spec, value) => matchesPattern(value, spec.pattern, spec.maxLength),
  "pattern-list": (spec, value) =>
    isDistinctList(value) &&
    value.length <= spec.maxItems &&
    value.every(item => matchesPattern(item, spec.pattern, spec.maxLength)),
};

/** True when `value` is one the property allows. */
function allows<T extends PropertySpec["type"]>(
  spec: SpecOf<T>,
  value: unknown
): boolean {
  const check: (spec: SpecOf<T>, value: unknown) => boolean = CHECKS[spec.type];
  return check(spec, value);
}

/** The base properties every event from `source` carries. */
export function basePropertiesFor(source: UsageSource): {
  required: PropertyMap;
  optional: PropertyMap;
} {
  return source === "site" ? SITE_BASE_PROPERTIES : TOOLS_BASE_PROPERTIES;
}

function isEventName(name: string): name is keyof typeof USAGE_EVENTS {
  return Object.prototype.hasOwnProperty.call(USAGE_EVENTS, name);
}

/**
 * The event's properties as the catalog allows them, or null when the event
 * may not be sent at all: an unknown name, a source the event is not for, or
 * a required property missing or wrong. `properties` holds the base and the
 * event's own properties together.
 */
export function checkEvent(
  source: UsageSource,
  name: string,
  properties: Readonly<Record<string, unknown>>
): Record<string, unknown> | null {
  if (!isEventName(name)) return null;
  const spec = USAGE_EVENTS[name];
  if (!(spec.sources as readonly UsageSource[]).includes(source)) return null;

  const base = basePropertiesFor(source);
  const required: PropertyMap = { ...base.required, ...spec.required };
  const optional: PropertyMap = { ...base.optional, ...spec.optional };

  const out: Record<string, unknown> = {};
  for (const [key, propertySpec] of Object.entries(required)) {
    const value = properties[key];
    if (!allows(propertySpec, value)) return null;
    out[key] = value;
  }
  for (const [key, propertySpec] of Object.entries(optional)) {
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    const value = properties[key];
    if (value !== undefined && allows(propertySpec, value)) out[key] = value;
  }
  // An agent's name only ever stands beside `run_by: "agent"`; with a
  // person's run it would contradict the run it describes.
  if (out.run_by !== "agent") delete out.agent;
  return out;
}

/**
 * A block inside a component that follows one of the component's own
 * settings: `{ $bind: "<setting id>", source: "setting" }`.
 *
 * The binding lives on the block, so copying, deleting and duplicating the
 * block carry it as any binding is carried. Composed, the block shows what
 * the placement gives the setting: its value, else its binding, else the
 * setting's default, which is the value (and binding) on the setting's own
 * block. A component shown alone shows the default. Anywhere else, or once
 * its setting is gone, the binding is unbound and the block shows its own
 * value.
 *
 * @module setting-bindings
 */
import type { BlockDocument, BlockNode, ExposedProperty } from "./document";
import { pointer } from "./issue-text";
import { DEFAULT_LIMITS, MAX_ENVELOPE_ENTRIES } from "./limits";
import { isPlainRecord } from "./plain-record";
import { ownEntry, ownKeys } from "./safe-record";
import type { ValidationIssue } from "./validation-contract";

/** The source of a binding that follows one of its component's settings. */
const SETTING_BINDING_SOURCE = "setting";

/**
 * The setting a binding follows, or `undefined` for a binding that follows
 * none.
 *
 * @experimental Settles with the editor's binding controls.
 */
function followedSettingId(binding: unknown): string | undefined {
  if (!isPlainRecord(binding)) return undefined;
  if (ownEntry(binding, "source") !== SETTING_BINDING_SOURCE) return undefined;
  const id = ownEntry(binding, "$bind");
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * The settings of a component a block may follow, by id: each whose pointer
 * is readable and which holds a value, so not a visibility setting, which
 * decides whether its block is shown. The first of two sharing an id, as the
 * envelope check refuses the second.
 */
function followableSettings(
  exposed: unknown
): ReadonlyMap<string, ExposedProperty> {
  const settings = new Map<string, ExposedProperty>();
  if (!Array.isArray(exposed)) return settings;
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (!isPlainRecord(entry)) continue;
    const { id, nodeId, propPath, type } = entry;
    if (typeof id !== "string" || settings.has(id)) continue;
    if (typeof nodeId !== "string" || nodeId === "") continue;
    if (typeof propPath !== "string" || propPath === "") continue;
    if (type === "visibility") continue;
    settings.set(id, entry as unknown as ExposedProperty);
  }
  return settings;
}

/**
 * Whether `prop` of `node` is the value of a setting itself, which follows
 * nothing: it is what its followers show.
 */
function holdsSetting(
  settings: ReadonlyMap<string, ExposedProperty>,
  nodeId: string,
  prop: string
): boolean {
  for (const setting of settings.values()) {
    if (setting.nodeId === nodeId && setting.propPath === prop) return true;
  }
  return false;
}

/**
 * Each binding that follows a setting, with the block and prop it fills and
 * where it is stored, over at most `maxNodes` blocks.
 */
function eachFollower(
  nodes: unknown,
  path: string,
  visit: (node: BlockNode, prop: string, id: string, at: string) => void,
  budget: { left: number }
): void {
  if (!Array.isArray(nodes)) return;
  for (let i = 0; i < nodes.length && budget.left > 0; i += 1) {
    const node: unknown = nodes[i];
    if (!isPlainRecord(node)) continue;
    budget.left -= 1;
    const at = `${path}/${i}`;
    followersOn(node as unknown as BlockNode, at, visit);
    const slots = ownEntry(node, "slots");
    if (!isPlainRecord(slots)) continue;
    for (const name of ownKeys(slots)) {
      eachFollower(ownEntry(slots, name), pointer(`${at}/slots`, name), visit, budget);
    }
  }
}

/** The bindings of one block that follow a setting. */
function followersOn(
  node: BlockNode,
  at: string,
  visit: (node: BlockNode, prop: string, id: string, at: string) => void
): void {
  const bindings: unknown = ownEntry(node, "bindings");
  if (!isPlainRecord(bindings)) return;
  for (const prop of ownKeys(bindings)) {
    const id = followedSettingId(ownEntry(bindings, prop));
    if (id !== undefined) visit(node, prop, id, at);
  }
}

/**
 * Where a document's setting bindings may stand.
 *
 * In a component, each must follow a setting the component has and that
 * holds a value, and not from that setting's own block, which is what its
 * followers show: anything else is refused. Outside a component no setting
 * is there to follow, so it shows the block's own value, which is said as a
 * warning rather than refused: a block copied out of a component keeps it,
 * as a list item binding copied out of a list does.
 */
export function settingBindingIssues(
  doc: BlockDocument,
  maxNodes: number = DEFAULT_LIMITS.maxNodes
): ValidationIssue[] {
  if (!isPlainRecord(doc)) return [];
  const issues: ValidationIssue[] = [];
  const component = doc.kind === "component";
  const settings = followableSettings(ownEntry(doc, "exposed"));
  const named = namedSettings(ownEntry(doc, "exposed"));
  eachFollower(
    ownEntry(doc, "nodes"),
    "/nodes",
    (node, prop, id, at) => {
      const path = pointer(`${at}/bindings`, prop);
      if (!component) {
        issues.push({
          path,
          code: "invalid-binding",
          severity: "warning",
          message: `This binding follows a component's setting "${id}", and this isn't a component, so the block shows its own value.`,
        });
        return;
      }
      const setting = settings.get(id);
      if (setting === undefined) {
        issues.push({
          path,
          code: "invalid-binding",
          severity: "error",
          message: named.has(id)
            ? `The setting "${id}" shows or hides its block, so a block can't follow it.`
            : `This binding follows the setting "${id}", which this component doesn't have.`,
        });
        return;
      }
      if (holdsSetting(settings, node.id, prop)) {
        issues.push({
          path,
          code: "invalid-binding",
          severity: "error",
          message: `This is the value of a setting, which its followers show, so it can't follow the setting "${id}".`,
        });
      }
    },
    { left: maxNodes }
  );
  return issues;
}

/** Every setting id a component declares, whatever it holds. */
function namedSettings(exposed: unknown): ReadonlySet<string> {
  const ids = new Set<string>();
  if (!Array.isArray(exposed)) return ids;
  const count = Math.min(exposed.length, MAX_ENVELOPE_ENTRIES);
  for (let i = 0; i < count; i += 1) {
    const entry: unknown = exposed[i];
    if (isPlainRecord(entry) && typeof entry.id === "string") ids.add(entry.id);
  }
  return ids;
}

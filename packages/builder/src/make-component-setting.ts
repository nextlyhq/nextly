/**
 * "Make this a setting of the component", from a placement's inspector: the
 * component's own props a field could fill that are not settings yet, and
 * the host service that adds one.
 *
 * Adding a setting changes the component, a document of its own that every
 * page placing it reads, so the host holds that change and writes it with
 * the page's next save. The page's side is one edit, binding the placement's
 * new setting to the field picked, so one undo takes both back: the host's
 * held change counts only while the page still holds that binding.
 *
 * @module make-component-setting
 */
import {
  bindablePropKind,
  ENTRY_LINK_PROPS,
  getBlock,
  isPlainRecord,
  walkNodes,
  type BlockNode,
  type ComponentDocument,
  type PropSchema,
} from "@nextlyhq/blocks-engine";

import { propLabel } from "./prop-label";

/**
 * The kinds of value a new setting may hold: text, an address and a
 * picture, the settings a placement binds to data. A rich-text passage is
 * edited on the canvas, and a number or a choice is the component's design.
 */
const SETTING_KINDS: ReadonlySet<string> = new Set(["text", "link", "image"]);

/** The props a link's entry reference is stored in, set with its address. */
const ENTRY_LINK_NAMES: ReadonlySet<string> = new Set(
  Object.values(ENTRY_LINK_PROPS)
);

/**
 * One prop of the component a placement may make a setting.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface SettingCandidate {
  /** The component's block that holds it, by its id in the component. */
  readonly nodeId: string;
  readonly propPath: string;
  /** How the panel lists it: the block's name, then the prop's. */
  readonly label: string;
  /** The prop as the block declares it, which the field picker fits. */
  readonly schema: PropSchema;
  /** What the component holds there now, the setting's default. */
  readonly value: unknown;
}

/**
 * What a host is asked to add: a setting of the component filled by one of
 * its block's props, named as given.
 *
 * @experimental Settles with the editor's binding controls.
 */
export interface ComponentSettingAsk {
  readonly componentId: string;
  readonly nodeId: string;
  readonly propPath: string;
  readonly label: string;
}

/**
 * The new setting's id, which the placement binds under, or why the host
 * would not add it.
 *
 * @experimental Settles with the editor's binding controls.
 */
export type ComponentSettingAnswer =
  | { readonly settingId: string }
  | { readonly refusal: string };

/** The settings a definition declares, by the block and prop each fills. */
function exposedTargets(definition: ComponentDocument): ReadonlySet<string> {
  const exposed: unknown = definition.exposed;
  const targets = new Set<string>();
  if (!Array.isArray(exposed)) return targets;
  for (const entry of exposed as unknown[]) {
    if (!isPlainRecord(entry)) continue;
    const { nodeId, propPath } = entry;
    if (typeof nodeId === "string" && typeof propPath === "string") {
      targets.add(`${nodeId}\u0000${propPath}`);
    }
  }
  return targets;
}

/** What the panel calls a block: its own name, else its kind's. */
function blockNameOf(node: BlockNode): string {
  const own = node.name;
  if (typeof own === "string" && own.trim() !== "") return own;
  return getBlock(node.type)?.editor?.label ?? node.type;
}

/**
 * Whether a block's prop may become a setting: content whose value a field
 * can be, not a setting already and not bound to a field already. Never a
 * setting of how the block is linked or drawn: a link's entry reference is
 * set with its address.
 */
function offered(
  node: BlockNode,
  propPath: string,
  schema: PropSchema,
  taken: ReadonlySet<string>
): boolean {
  if (!SETTING_KINDS.has(bindablePropKind(schema) ?? "")) return false;
  if (schema.role !== "content" || ENTRY_LINK_NAMES.has(propPath)) {
    return false;
  }
  if (propPath === LINK_ADDRESS_PROP && linksToEntry(node.props)) return false;
  if (taken.has(`${node.id}\u0000${propPath}`)) return false;
  return !(
    isPlainRecord(node.bindings) && Object.hasOwn(node.bindings, propPath)
  );
}

/** The prop a link's typed address is stored in, which `linkFor` reads. */
const LINK_ADDRESS_PROP = "href";

/**
 * Whether a block links to an entry, which the renderer follows before its
 * typed address: a setting of that address would change nothing a visitor
 * sees while the entry link stands.
 */
function linksToEntry(props: unknown): boolean {
  if (!isPlainRecord(props)) return false;
  const named = (key: string): boolean => {
    const value = props[key];
    return typeof value === "string" && value.trim() !== "";
  };
  return named(ENTRY_LINK_PROPS.collection) && named(ENTRY_LINK_PROPS.id);
}

/** One block's props a placement may make a setting, in declared order. */
function candidatesOf(
  node: BlockNode,
  taken: ReadonlySet<string>
): SettingCandidate[] {
  // A placement's type is reserved, so no block declares props for it: a
  // component placed inside this one offers none of its own.
  const declared = getBlock(node.type)?.props ?? {};
  const props = isPlainRecord(node.props) ? node.props : {};
  return Object.entries(declared).flatMap(([propPath, schema]) =>
    schema === undefined || !offered(node, propPath, schema, taken)
      ? []
      : [
          {
            nodeId: node.id,
            propPath,
            label: `${blockNameOf(node)} · ${propLabel(propPath, schema)}`,
            schema,
            value: Object.hasOwn(props, propPath) ? props[propPath] : undefined,
          },
        ]
  );
}

/**
 * The props of a component a placement may make a setting: each text, link
 * and image prop its blocks declare, inside their slots too, that is not a
 * setting yet and not bound to a field already, in the component's order.
 *
 * @experimental Settles with the editor's binding controls.
 */
export function settingCandidates(
  definition: ComponentDocument
): SettingCandidate[] {
  const taken = exposedTargets(definition);
  const found: SettingCandidate[] = [];
  walkNodes(definition.nodes, node => {
    found.push(...candidatesOf(node, taken));
  });
  return found;
}

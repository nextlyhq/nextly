/**
 * Writes the generated TypeScript types file: the one implementation behind
 * `nextly generate:types` and `nextly build`.
 *
 * Both commands write the same file from the same records, so they share how it
 * is produced (the generator's options, the permission and event names it
 * narrows to) and where it goes (fitted to the app's layout). Two copies would
 * agree today and drift silently, a build then writing a different file than
 * the development run did.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { TypeGenerator } from "../../domains/schema/services/type-generator";
import { collectCodegenNames } from "../../plugins/codegen/collect-codegen-names";
import type { PermissionConfigSource } from "../../plugins/permissions/collect-permissions";
import type { PluginDefinition } from "../../plugins/plugin-context";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import type { DynamicFieldGroupRecord } from "../../schemas/dynamic-field-groups/types";
import type { DynamicSingleRecord } from "../../schemas/dynamic-singles/types";
import type { UserFieldDefinitionRecord } from "../../schemas/user-field-definitions/types";
import {
  generatedTypesFile,
  retireOldDefaultTypesFile,
} from "../../shared/lib/generated-output-paths";

export interface WriteGeneratedTypesOptions {
  cwd: string;
  /** The configured `typescript.outputFile`, or an explicit `--output`. */
  outputFile: string;
  /** The merged config, whose permissions and events the types narrow to. */
  config: PermissionConfigSource;
  plugins: PluginDefinition[];
  collections: DynamicCollectionRecord[];
  singles: DynamicSingleRecord[];
  components: DynamicFieldGroupRecord[];
  userFields: UserFieldDefinitionRecord[];
  /** Whether to write the `declare module "nextly"` augmentation. */
  moduleAugmentation: boolean;
  /**
   * Tells the developer about a `payload-types.ts` the old default left
   * beside the file. Required, so no command writing types can drop it.
   */
  warn: (message: string) => void;
}

/** Generates the types file, writes it, and returns the path it was written to. */
export async function writeGeneratedTypesFile(
  options: WriteGeneratedTypesOptions
): Promise<string> {
  // Without these names the types write `PermissionSlug` and `EventName` as
  // bare `string`, widening what the app's own permissions and events narrow.
  const { permissionSlugs, eventNames } = collectCodegenNames(
    options.config,
    options.plugins
  );

  const typesFile = new TypeGenerator({
    includeComments: true,
    generateInputTypes: true,
    generateConfig: true,
    generateModuleAugmentation: options.moduleAugmentation,
  }).generateTypesFile(
    options.collections,
    options.singles,
    options.components,
    options.userFields,
    permissionSlugs,
    eventNames
  );

  const typesFilePath = generatedTypesFile(options.cwd, options.outputFile);
  await mkdir(dirname(typesFilePath), { recursive: true });
  await writeFile(typesFilePath, typesFile.code, "utf-8");
  // After the new file exists, so a message naming it names a real file.
  for (const notice of retireOldDefaultTypesFile(
    options.cwd,
    options.outputFile
  )) {
    options.warn(notice);
  }
  return typesFilePath;
}

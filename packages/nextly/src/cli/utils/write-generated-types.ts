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

import type { SanitizedLocalizationConfig } from "../../domains/i18n/config/types";
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
  /**
   * The merged config, whose permissions and events the types narrow to, and whose declared
   * languages, where it locks them, the types list.
   */
  config: PermissionConfigSource & {
    localization?: Pick<SanitizedLocalizationConfig, "locales">;
  };
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

/** A file a generator would write: where, and what. */
export interface GeneratedFile {
  /** Absolute path. */
  path: string;
  /** The whole content the file would hold. */
  code: string;
}

/**
 * The languages a types file lists, for every writer of one (`generate:types`, `build`,
 * `db:sync --types`): those a configuration that declares them locks, as the reads match them.
 * Where it declares none, Settings manages them and the types take any code. Old codes still
 * accepted after a conversion come from the upgrade that converts them; none are recorded before
 * it.
 */
export function generatedLanguages(config: {
  localization?: Pick<SanitizedLocalizationConfig, "locales">;
}): { locales?: string[] } {
  const locales = config.localization?.locales.map(locale => locale.code);
  return locales === undefined ? {} : { locales };
}

/**
 * Generates the types file without writing it: the path and content
 * `writeTypesFile` writes, for a run that only reports them.
 */
export function generateTypesFile(
  options: Omit<WriteGeneratedTypesOptions, "warn">
): GeneratedFile {
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
    ...generatedLanguages(options.config),
  }).generateTypesFile(
    options.collections,
    options.singles,
    options.components,
    options.userFields,
    permissionSlugs,
    eventNames
  );

  return {
    path: generatedTypesFile(options.cwd, options.outputFile),
    code: typesFile.code,
  };
}

/**
 * Writes a types file `generateTypesFile` produced, then tells the developer
 * about a file the old default left beside it.
 */
async function writeTypesFile(
  typesFile: GeneratedFile,
  options: Pick<WriteGeneratedTypesOptions, "cwd" | "outputFile" | "warn">
): Promise<void> {
  await mkdir(dirname(typesFile.path), { recursive: true });
  await writeFile(typesFile.path, typesFile.code, "utf-8");
  // After the new file exists, so a message naming it names a real file.
  for (const notice of retireOldDefaultTypesFile(
    options.cwd,
    options.outputFile
  )) {
    options.warn(notice);
  }
}

/**
 * Writes what `generate:types` and `build` generate: the Zod schemas and their
 * index, each folder made first, then the types file. The one writer behind
 * both commands, which plan these files first so a dry run can name them.
 */
export async function writeGeneratedOutput(
  output: GeneratedOutput,
  options: Pick<WriteGeneratedTypesOptions, "cwd" | "outputFile" | "warn">
): Promise<void> {
  for (const file of generatedOutputOrder(output)) {
    if (file === output.types) {
      await writeTypesFile(file, options);
    } else {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.code, "utf-8");
    }
  }
}

/** What `generate:types` and `build` generate: the Zod files and the types file. */
export interface GeneratedOutput {
  zod: readonly GeneratedFile[];
  types?: GeneratedFile;
}

/**
 * The files of `output` in the order `writeGeneratedOutput` writes them, which
 * is the order a dry run names them in: should a write fail part way, the
 * files before it are the ones a real run had already written.
 */
export function generatedOutputOrder(output: GeneratedOutput): GeneratedFile[] {
  return [...output.zod, ...(output.types ? [output.types] : [])];
}

/**
 * What to tell an operator about a Builder-written file with no snapshot.
 *
 * Its own module, importing nothing, because two places read it: the commands that discover
 * migrations (through `migration-discovery`, which re-exports it), and the CLI's error table.
 * Discovery's module loads the schema pipeline; reading the wording from it would load that
 * pipeline into every command that loads the error table. Not among the CLI's own modules, since
 * discovery is loaded on a request path, which may load no other of them.
 *
 * @module domains/schema/migrate/builder-migration-remedy
 */

/**
 * What to tell an operator about a Builder-written file with no snapshot: it
 * is not applied as written, and the file to commit instead is the one
 * `migrate:create` writes for the same change, which carries the snapshot
 * `nextly migrate` checks the database against.
 */
export function builderMigrationRemedy(filename: string): string {
  return (
    `${filename} was written by the Schema Builder and has no snapshot beside it ` +
    `(meta/${filename.replace(/\.sql$/, "")}.snapshot.json), so nothing ` +
    `says what the database should look like once it has run. Replace it with the ` +
    `migration \`nextly migrate:create\` writes for that change: delete ${filename}, ` +
    `run \`nextly migrate:create --name=<name>\`, and commit the .sql file and its snapshot; ` +
    `or delete it, if the change is already in a migration or not wanted.`
  );
}

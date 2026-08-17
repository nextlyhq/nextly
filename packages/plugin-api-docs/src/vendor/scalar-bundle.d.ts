/**
 * The vendored Scalar bundle is imported as an esbuild "text" asset (see
 * tsup.config.ts loader). To TypeScript it is an opaque string module.
 */
declare module "*.txt" {
  const content: string;
  export default content;
}

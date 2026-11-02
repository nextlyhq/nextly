import scopeAdminSource from "./postcss-scope-admin-source.mjs";

const config = {
  plugins: [
    "@tailwindcss/postcss",
    // After Tailwind, so it scopes the compiled sheet: the admin's source
    // stylesheet, reached through the `@nextlyhq/admin` source alias, scoped
    // as the published one is (see the module's comment). Imported rather
    // than named: Turbopack bundles this config, and resolves a plugin named
    // by a relative path from the bundle, where the module is not.
    scopeAdminSource,
  ],
};

export default config;

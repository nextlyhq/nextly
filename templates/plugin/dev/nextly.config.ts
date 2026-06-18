/**
 * Dev playground config — a minimal Nextly app that registers THIS plugin so you
 * can exercise it in a real admin. SQLite, dev auto-login. Never published.
 */
import { defineConfig } from "nextly/config";
import { myPlugin } from "{{pluginName}}";

export default defineConfig({
  admin: {
    // Land on /admin already logged in. Hard-blocked in production by Nextly.
    devAutoLogin: {
      email: "dev@nextly.local",
      password: "DevPassword123!",
    },
  },
  plugins: [myPlugin()],
});

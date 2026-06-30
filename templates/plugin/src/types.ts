/**
 * Options accepted by your plugin factory. These are JSDoc-documented so editors
 * surface them at the call site (D44).
 */
export interface MyPluginOptions {
  /**
   * Greeting prefix used by the example collection's `afterCreate` hook.
   * @default "Hello"
   */
  greeting?: string;

  /**
   * Disable the plugin's behavior (init/hooks/events/routes/admin) while still
   * applying its schema contributions. Default `true`.
   */
  enabled?: boolean;
}

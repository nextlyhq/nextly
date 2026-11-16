/* The shape `nextly generate:types` writes an app's component map in: a
 * namespace import of each plugin admin module, read by member, registered as
 * the app's whole map. Written out here rather than generated, since the
 * fixture has no config to generate it from. */

import { registerComponentMap } from "@nextlyhq/admin";

import * as _p0 from "../../../plugin/admin";

const registered = {
  "@fixture/consumer-plugin/admin#FixturePluginPage": _p0.FixturePluginPage,
};

registerComponentMap(registered);

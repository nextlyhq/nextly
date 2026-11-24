/**
 * A field move stopped part-way on MySQL leaves every value readable (`move-stopped-part-way-suite`),
 * on the earlier layout, which keeps translatable values on the main tables: there a stopped save may
 * be judged from its table's shape, which shows a moved field's column and not where its values are.
 */
import { moveStoppedPartWaySuite } from "./move-stopped-part-way-suite";

moveStoppedPartWaySuite();

/**
 * Shared @dnd-kit sensor config for the editor. A 4px distance activation constraint means
 * a click (or a click that jitters a pixel or two) never starts a drag — it stays a
 * selection — while a deliberate drag still works. This is the fix for "drags eat clicks".
 * We keep the KeyboardSensor so overriding a draggable's sensors doesn't drop keyboard drag.
 */
import {
  KeyboardSensor,
  PointerActivationConstraints,
  PointerSensor,
  type Sensors,
} from "@dnd-kit/dom";

export const dragSensors: Sensors = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 4 }),
    ],
  }),
  KeyboardSensor,
];

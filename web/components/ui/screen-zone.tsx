"use client";

import type { ReactNode } from "react";

export type ZonePosition = "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-right";

const POSITION_CLASSES: Record<ZonePosition, string> = {
  "top-left": "top-4 left-4 items-start",
  "top-center": "top-4 left-1/2 -translate-x-1/2 items-center",
  "top-right": "top-4 right-4 items-end",
  "bottom-left": "bottom-4 left-4 items-start",
  "bottom-right": "bottom-4 right-4 items-end",
};

/**
 * A fixed screen region that stacks its children vertically with a
 * consistent gap. Every "floating" UI piece (layer picker, legends, search
 * bar) should register into a zone instead of picking its own absolute
 * coordinates - this is what keeps new components from overlapping
 * existing ones as the app grows. Draggable/floating panels (like the
 * mitigation simulator) intentionally do NOT use a zone, since they move
 * freely on top of everything else.
 */
export function ScreenZone({
  position,
  children,
  className = "",
}: {
  position: ZonePosition;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "pointer-events-none absolute z-10 flex flex-col gap-2 " +
        POSITION_CLASSES[position] +
        " " +
        className
      }
    >
      <div className="pointer-events-auto flex flex-col gap-2">{children}</div>
    </div>
  );
}
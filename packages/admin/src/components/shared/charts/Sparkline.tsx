/**
 * Sparkline Component
 *
 * A lightweight, SVG-based sparkline for visualizing trends.
 * Supports dynamic primary color and responsive sizing.
 *
 * @module components/shared/charts/Sparkline
 */

import type React from "react";

import { cn } from "@admin/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 120,
  height = 40,
  className,
}) => {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 4;

  const points = data.map((val, i) => {
    const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
    const y = height - padding - ((val - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathData = `M ${points.join(" L ")}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
    >
      <path
        d={pathData}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-primary transition-all duration-700 ease-in-out"
        style={{
          strokeDasharray: 400,
          strokeDashoffset: 400,
          animation:
            "sparkline-draw 1.5s cubic-bezier(0.2, 0.8, 0.2, 1) forwards",
        }}
      />
      <style>{`
        @keyframes sparkline-draw {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </svg>
  );
};

/**
 * RingChart Component
 *
 * A custom SVG ring/donut chart for displaying percentage breakdowns.
 * Uses dynamic branding colors and centers text for the total count.
 *
 * @module components/shared/charts/RingChart
 */

import type React from "react";

import { cn } from "@admin/lib/utils";

interface Segment {
  value: number;
  color: string;
  label: string;
}

interface RingChartProps {
  segments: Segment[];
  total: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export const RingChart: React.FC<RingChartProps> = ({
  segments,
  total,
  size = 140,
  strokeWidth = 12,
  className,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let currentOffset = 0;

  return (
    <div
      className={cn("relative flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="transform -rotate-90"
      >
        {/* Background Ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/10"
        />

        {/* Segments */}
        {segments.map((segment, index) => {
          const percentage = total > 0 ? segment.value / total : 0;
          const strokeDasharray = `${percentage * circumference} ${circumference}`;
          const strokeDashoffset = -currentOffset;
          currentOffset += percentage * circumference;

          return (
            <circle
              key={index}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={strokeWidth}
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transition-all duration-1000 ease-in-out"
              style={{
                strokeDashoffset: total > 0 ? strokeDashoffset : circumference,
              }}
            />
          );
        })}
      </svg>

      {/* Center Content */}
      <div className="absolute flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-bold tracking-tight text-foreground leading-none">
          {total.toLocaleString()}
        </span>
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground mt-1">
          Total
        </span>
      </div>
    </div>
  );
};

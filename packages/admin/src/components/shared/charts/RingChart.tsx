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

/**
 * How far the separator extends past the arc, in pixels, on each side.
 *
 * Read by the render and by the test that asserts a gap exists, so the two
 * cannot disagree about whether one was drawn.
 */
export const SEGMENT_SEPARATION = 2;

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
            <g key={index}>
              {/*
               * A separator carved in the SURFACE colour, drawn under this
               * segment and over the previous one.
               *
               * 🔴 Two arcs of a ring touch, so each is an "adjacent colour" of
               * the other and WCAG 1.4.11 asks for 3:1 between them — not only
               * between each arc and the card behind it. This ring's own pair
               * measures 2.15:1 in dark mode (white against amber), and no
               * choice of palette fixes that while one segment is the primary:
               * a colour 3:1 from both white and the near-black card exists but
               * would dictate the amber for every other chart to settle one
               * boundary here.
               *
               * So the boundary stops being a colour boundary. Because the
               * segments are painted in order, this wider under-stroke cuts a
               * gap into the segment before it, and the reader sees where one
               * arc ends whatever the two colours are. `strokeLinecap="round"`
               * means the caps overhang by half the stroke, so the separation
               * has to clear that on both sides to show at all.
               */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--nx-card)"
                strokeWidth={strokeWidth + SEGMENT_SEPARATION * 2}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-in-out"
                style={{
                  strokeDashoffset:
                    total > 0 ? strokeDashoffset : circumference,
                }}
              />
              <circle
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
                  strokeDashoffset:
                    total > 0 ? strokeDashoffset : circumference,
                }}
              />
            </g>
          );
        })}
      </svg>

      {/* Center Content */}
      <div className="absolute flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-bold tracking-tight text-foreground leading-none">
          {total.toLocaleString()}
        </span>
        <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground mt-1">
          Total
        </span>
      </div>
    </div>
  );
};

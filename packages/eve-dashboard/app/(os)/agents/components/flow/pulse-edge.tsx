"use client";

/**
 * `PulseEdge` — animated traveling-light edge for the Flow view.
 *
 * A thin static stroke connecting two nodes, plus a SHORT bright "pulse"
 * that travels from source → target every time `pulseKey` changes. The
 * pulse is implemented as a `<motion.circle>` riding the edge's path
 * via `offsetPath` (CSS Motion Path) — GPU-accelerated, no canvas, no
 * RAF jank.
 *
 * Activity heat (the static stroke gets brighter as `pulseCount` grows)
 * is a soft "this lane is busy" tell. Resets after 4s of idleness.
 *
 * Built atop ReactFlow's BaseEdge so positioning + interaction inherit.
 *
 * See: synap-team-docs/content/team/platform/eve-agents-design.mdx
 */

import { useEffect, useState } from "react";
import {
  BaseEdge,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";

interface PulseEdgeData {
  /** Increments each time the lane should pulse (one event = one pulse). */
  pulseKey: number;
  /** Color of the traveling pulse — actor brand color. */
  color: string;
  /** Optional explicit error state — stroke turns danger red. */
  isError?: boolean;
}

export function PulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const d = (data ?? {}) as Partial<PulseEdgeData>;
  const color = d.color ?? "#34D399";
  const pulseKey = d.pulseKey ?? 0;
  const isError = d.isError ?? false;

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  // "Heat" — the static stroke briefly brightens after a pulse, then fades.
  const [heat, setHeat] = useState(0);
  useEffect(() => {
    if (pulseKey === 0) return;
    setHeat(1);
    const t = setTimeout(() => setHeat(0), 1400);
    return () => clearTimeout(t);
  }, [pulseKey]);

  const baseStroke = isError ? "#F87171" : color;
  const baseOpacity = 0.18 + heat * 0.42;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: baseStroke,
          strokeWidth: 1.5 + heat * 0.5,
          opacity: baseOpacity,
          transition: "opacity 600ms ease-out, stroke-width 600ms ease-out",
        }}
      />
      {/* Glow underlay — slightly thicker stroke at low alpha for the
          "lit lane" feel. Only visible during the heat window. */}
      <path
        d={path}
        fill="none"
        stroke={baseStroke}
        strokeWidth={6}
        strokeLinecap="round"
        style={{
          opacity: heat * 0.18,
          filter: "blur(2px)",
          transition: "opacity 600ms ease-out",
          pointerEvents: "none",
        }}
      />
      {/* Traveling pulse. Each `pulseKey` change re-mounts the SVG
          element, which restarts the `<animateMotion>` timer. */}
      {pulseKey > 0 && (
        <PulseGlyph key={pulseKey} path={path} color={baseStroke} />
      )}
    </>
  );
}

function PulseGlyph({ path, color }: { path: string; color: string }) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle r={4} fill={color} opacity={0.95}>
        <animateMotion dur="0.9s" begin="0s" fill="freeze" path={path} />
        <animate
          attributeName="opacity"
          values="0;1;1;0"
          keyTimes="0;0.1;0.85;1"
          dur="0.9s"
          fill="freeze"
        />
      </circle>
      {/* Soft halo behind the pulse — sells the speed. */}
      <circle r={9} fill={color} opacity={0.15}>
        <animateMotion dur="0.9s" begin="0s" fill="freeze" path={path} />
        <animate
          attributeName="opacity"
          values="0;0.4;0.4;0"
          keyTimes="0;0.1;0.85;1"
          dur="0.9s"
          fill="freeze"
        />
      </circle>
    </g>
  );
}

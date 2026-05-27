"use client";

import React from "react";
import { motion } from "framer-motion";

export interface StreamDotsProps {
  size?: "sm" | "md";
}

/**
 * Three-dot pulsing indicator for streaming/loading states.
 * Replaces spinner usage — staggered opacity animation.
 */
export function StreamDots({ size = "md" }: StreamDotsProps) {
  const diameter = size === "sm" ? 4 : 6;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: diameter,
      }}
    >
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "easeInOut",
            delay: i * 0.15,
          }}
          style={{
            display: "inline-block",
            width: diameter,
            height: diameter,
            borderRadius: "50%",
            backgroundColor: "var(--companion-ai)",
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  );
}

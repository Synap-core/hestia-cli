"use client";

/**
 * `ChannelNode` — React Flow custom node for external messaging channels.
 *
 * Two visual states:
 *   • connected    — solid accent border, colored icon, full label
 *   • coming-soon  — dashed muted border, dimmed icon, "Coming soon" label
 *
 * Connected channels get a pulsed edge to OpenClaw when traffic flows.
 * Coming-soon nodes show the topology without implying connectivity.
 */

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  MessageCircle,
  Send,
  Hash,
  Smartphone,
  Radio,
  Grid3x3,
} from "lucide-react";
import type { ChannelKind, ChannelConnectionStatus } from "../../lib/channel-types";

export interface ChannelNodeData extends Record<string, unknown> {
  label: string;
  kind: ChannelKind;
  connectionStatus: ChannelConnectionStatus;
  size: number;
  accent: string;
}

export type ChannelRFNode = Node<ChannelNodeData, "channel">;

const KIND_ICON: Record<ChannelKind, typeof MessageCircle> = {
  telegram:  Send,
  discord:   Hash,
  whatsapp:  Smartphone,
  signal:    Radio,
  matrix:    Grid3x3,
  synap:     MessageCircle,
  a2a:       MessageCircle,
};

function ChannelNodeComponent({ data }: NodeProps<ChannelRFNode>) {
  const { label, kind, connectionStatus, size, accent } = data;

  const isConnected =
    connectionStatus === "connected" || connectionStatus === "connecting";
  const Glyph = KIND_ICON[kind] ?? MessageCircle;
  const iconSize = size * 0.45;
  const borderRadius = 10;

  return (
    <div
      className="agent-node group relative"
      data-kind={kind}
      data-connection-status={connectionStatus}
      style={{ width: size }}
    >
      <Handle type="target" position={Position.Top}    className="agent-node-handle" />
      <Handle type="source" position={Position.Bottom} className="agent-node-handle" />
      <Handle type="target" position={Position.Left}   className="agent-node-handle" />
      <Handle type="source" position={Position.Right}  className="agent-node-handle" />

      <div
        className="mx-auto flex items-center justify-center"
        style={{
          width: size,
          height: size,
          borderRadius,
          background: isConnected ? `${accent}1a` : "rgba(255,255,255,0.04)",
          border: isConnected
            ? `1.5px solid ${accent}88`
            : "1.5px dashed rgba(255,255,255,0.22)",
          transition: "border 200ms ease-out, background 200ms ease-out",
        }}
      >
        <Glyph
          style={{ color: isConnected ? accent : "rgba(255,255,255,0.3)" }}
          width={iconSize}
          height={iconSize}
          strokeWidth={1.8}
          aria-hidden
        />
      </div>

      <div
        className="mt-1.5 text-center select-none leading-tight whitespace-nowrap text-[10.5px] font-medium"
        style={{
          color: isConnected
            ? "rgba(255,255,255,0.80)"
            : "rgba(255,255,255,0.30)",
          textShadow: "0 1px 2px rgba(0,0,0,0.45)",
        }}
      >
        {isConnected ? label : "Coming soon"}
      </div>
    </div>
  );
}

export const ChannelNode = memo(ChannelNodeComponent);

"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityLinkType = "entity" | "doc" | "view" | "person";

export interface MessageAttachment {
  entityId: string;
  fileName: string;
  mimeType: string;
  size?: number;
  previewUrl?: string;
}

export interface MessageContentProps {
  content: string;
  isStreaming?: boolean;
  format?: "markdown" | "plain";
  /** Called when user clicks an entity / doc / view link embedded in prose */
  onEntityLinkClick?: (id: string, type: EntityLinkType) => void;
  /** File attachments to render before the message content */
  attachments?: MessageAttachment[];
}

// ─── Inline EntityLink ────────────────────────────────────────────────────────

interface EntityLinkProps {
  id: string;
  name: string;
  type: EntityLinkType;
  onClick?: (id: string, type: EntityLinkType) => void;
}

const EntityLink = ({ id, name, type, onClick }: EntityLinkProps) => (
  <span
    onClick={() => onClick?.(id, type)}
    style={{
      color: "var(--companion-ai)",
      cursor: "pointer",
      textDecoration: "underline",
      textDecorationStyle: "dotted",
    }}
  >
    {name}
  </span>
);

// ─── StreamingCursor ──────────────────────────────────────────────────────────

const StreamingCursor = () => (
  <motion.span
    animate={{ opacity: [0.3, 1, 0.3] }}
    transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut" }}
    style={{ display: "inline-block", marginLeft: 4, fontWeight: 600 }}
  >
    ▊
  </motion.span>
);

// ─── AttachmentGallery ────────────────────────────────────────────────────────

function AttachmentGallery({ attachments }: { attachments: MessageAttachment[] }) {
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const files = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 6 }}>
      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {images.map((img) => (
            <img
              key={img.entityId}
              src={img.previewUrl ?? ""}
              alt={img.fileName}
              style={{
                maxWidth: images.length === 1 ? 320 : 180,
                maxHeight: 240,
                borderRadius: 10,
                objectFit: "cover",
                backgroundColor: "rgba(128,128,128,0.08)",
              }}
            />
          ))}
        </div>
      )}
      {files.map((file) => (
        <div
          key={file.entityId}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 8,
            backgroundColor: "var(--companion-surface)",
            fontSize: 13,
            maxWidth: 280,
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0, opacity: 0.5 }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={file.fileName}
          >
            {file.fileName}
          </span>
          {file.size != null && (
            <span style={{ opacity: 0.5, flexShrink: 0, fontSize: 12 }}>
              {file.size < 1024 * 1024
                ? `${Math.round(file.size / 1024)}KB`
                : `${(file.size / (1024 * 1024)).toFixed(1)}MB`}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── resolveInlineReferences ──────────────────────────────────────────────────

/**
 * Convert [[entity:ID:Name]] / [[doc:ID:Title]] / [[view:ID:Name]] markers
 * emitted by the AI into markdown links with custom schemes that we intercept
 * in the `a` component renderer below.
 *
 * [[entity:abc-123:Acme Corp]] → [Acme Corp](entity://abc-123)
 * [[doc:def-456:Q1 Notes]]    → [Q1 Notes](doc://def-456)
 * [[view:ghi-789:Pipeline]]   → [Pipeline](view://ghi-789)
 */
function resolveInlineReferences(content: string): string {
  return content
    .replace(
      /\[\[entity:([^:\]\s]+):([^\]]+)\]\]/g,
      (_, id, name) => `[${name.trim()}](entity://${id})`
    )
    .replace(
      /\[\[doc:([^:\]\s]+):([^\]]+)\]\]/g,
      (_, id, name) => `[${name.trim()}](doc://${id})`
    )
    .replace(
      /\[\[view:([^:\]\s]+):([^\]]+)\]\]/g,
      (_, id, name) => `[${name.trim()}](view://${id})`
    )
    .replace(
      /\[\[person:([^:\]\s]+):([^\]]+)\]\]/g,
      (_, id, name) => `[${name.trim()}](person://${id})`
    );
}

// ─── MessageContent ───────────────────────────────────────────────────────────

/**
 * Renders message text content with optional markdown formatting, streaming cursor,
 * and inline entity / document / view reference links.
 *
 * AI-emitted [[entity:ID:Name]] markers are transformed into styled EntityLink
 * components that the user can click to open the referenced object.
 */
export function MessageContent({
  content,
  isStreaming = false,
  format = "markdown",
  onEntityLinkClick,
  attachments,
}: MessageContentProps) {
  const textStyle: React.CSSProperties = {
    margin: 0,
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 1.6,
    color: "var(--companion-text)",
  };

  if (format === "plain") {
    return (
      <>
        {attachments && attachments.length > 0 && (
          <AttachmentGallery attachments={attachments} />
        )}
        <p style={textStyle}>
          {content}
          {isStreaming && <StreamingCursor />}
        </p>
      </>
    );
  }

  const processed = resolveInlineReferences(content);

  return (
    <div style={{ color: "var(--companion-text)" }}>
      {attachments && attachments.length > 0 && (
        <AttachmentGallery attachments={attachments} />
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p style={textStyle}>{children}</p>
          ),
          strong: ({ children }) => (
            <span style={{ fontWeight: 700 }}>{children}</span>
          ),
          em: ({ children }) => (
            <span style={{ fontStyle: "italic" }}>{children}</span>
          ),
          code: ({ children, className }) => {
            const isBlock = className?.startsWith("language-");
            if (isBlock) {
              return (
                <pre
                  style={{
                    backgroundColor: "rgba(0,0,0,0.08)",
                    borderRadius: 8,
                    padding: "8px 12px",
                    overflowX: "auto",
                    fontSize: 13,
                    lineHeight: 1.5,
                    margin: "8px 0",
                  }}
                >
                  <code style={{ fontFamily: "monospace" }}>{children}</code>
                </pre>
              );
            }
            return (
              <code
                style={{
                  fontFamily: "monospace",
                  fontSize: 13,
                  backgroundColor: "rgba(0,0,0,0.08)",
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                {children}
              </code>
            );
          },
          ul: ({ children }) => (
            <ul
              style={{
                paddingLeft: 20,
                margin: "4px 0 8px 0",
                listStyleType: "disc",
              }}
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              style={{
                paddingLeft: 20,
                margin: "4px 0 8px 0",
                listStyleType: "decimal",
              }}
            >
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 2 }}>
              {children}
            </li>
          ),
          h1: ({ children }) => (
            <h1
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--companion-text)",
                display: "block",
                marginBottom: 8,
                marginTop: 16,
              }}
            >
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              style={{
                fontSize: 17,
                fontWeight: 600,
                color: "var(--companion-text)",
                display: "block",
                marginBottom: 8,
                marginTop: 16,
              }}
            >
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--companion-text)",
                display: "block",
                marginBottom: 6,
                marginTop: 12,
              }}
            >
              {children}
            </h3>
          ),
          a: ({ href, children }) => {
            // Intercept entity:// doc:// view:// person:// schemes → EntityLink
            if (href) {
              const entityMatch = href.match(
                /^(entity|doc|view|person):\/\/(.+)$/
              );
              if (entityMatch) {
                const type = entityMatch[1] as EntityLinkType;
                const id = entityMatch[2];
                const name =
                  typeof children === "string"
                    ? children
                    : Array.isArray(children)
                      ? String(children[0] ?? "")
                      : String(children ?? "");
                return (
                  <EntityLink
                    id={id}
                    name={name}
                    type={type}
                    onClick={onEntityLinkClick}
                  />
                );
              }
            }
            // Normal external link
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "inherit",
                  textDecoration: "underline",
                  opacity: 0.8,
                }}
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote
              style={{
                borderLeft: "3px solid var(--companion-border)",
                paddingLeft: 12,
                margin: "8px 0",
                opacity: 0.8,
              }}
            >
              {children}
            </blockquote>
          ),
          hr: () => (
            <hr
              style={{
                border: "none",
                borderTop: "1px solid var(--companion-border-subtle)",
                margin: "12px 0",
              }}
            />
          ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt ?? ""}
              style={{
                maxWidth: "100%",
                borderRadius: 8,
                marginTop: 4,
                marginBottom: 4,
              }}
            />
          ),
        }}
      >
        {processed}
      </ReactMarkdown>
      {isStreaming && <StreamingCursor />}
    </div>
  );
}

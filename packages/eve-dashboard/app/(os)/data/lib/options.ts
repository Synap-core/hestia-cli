/**
 * Centralized option sets for the Data app demo. Status options carry a
 * `color` so SelectCell (appearance="status") renders the right chip.
 */

import type { FieldOption } from "@eve/fields";
import type { EntityType } from "./sample-data";

export const STATUS_OPTIONS: Record<EntityType, FieldOption[]> = {
  contact: [
    { value: "idle",     label: "Idle",     color: "neutral" },
    { value: "prospect", label: "Prospect", color: "sky" },
    { value: "lead",     label: "Lead",     color: "violet" },
    { value: "active",   label: "Active",   color: "emerald" },
    { value: "former",   label: "Former",   color: "slate" },
  ],
  company: [
    { value: "prospect", label: "Prospect", color: "sky" },
    { value: "lead",     label: "Lead",     color: "violet" },
    { value: "client",   label: "Client",   color: "emerald" },
    { value: "partner",  label: "Partner",  color: "indigo" },
    { value: "churned",  label: "Churned",  color: "rose" },
  ],
  deal: [
    { value: "lead",        label: "Lead",        color: "sky" },
    { value: "qualified",   label: "Qualified",   color: "violet" },
    { value: "negotiation", label: "Negotiation", color: "amber" },
    { value: "won",         label: "Won",         color: "emerald" },
    { value: "lost",        label: "Lost",        color: "rose" },
  ],
  project: [
    { value: "planning", label: "Planning", color: "sky" },
    { value: "active",   label: "Active",   color: "emerald" },
    { value: "paused",   label: "Paused",   color: "amber" },
    { value: "done",     label: "Done",     color: "slate" },
    { value: "cancelled", label: "Cancelled", color: "rose" },
  ],
};

export const INDUSTRY_OPTIONS: FieldOption[] = [
  { value: "ai_research",   label: "AI Research" },
  { value: "design",        label: "Design & Brand" },
  { value: "saas",          label: "SaaS" },
  { value: "ecommerce",     label: "E-commerce" },
  { value: "fintech",       label: "Fintech" },
  { value: "healthcare",    label: "Healthcare" },
  { value: "education",     label: "Education" },
  { value: "media",         label: "Media" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "logistics",     label: "Logistics" },
  { value: "consulting",    label: "Consulting" },
  { value: "nonprofit",     label: "Non-profit" },
];

export const SOURCE_OPTIONS: FieldOption[] = [
  { value: "linkedin",    label: "LinkedIn" },
  { value: "referral",    label: "Referral" },
  { value: "inbound",     label: "Inbound" },
  { value: "cold_email",  label: "Cold email" },
  { value: "event",       label: "Event / Conference" },
  { value: "partnership", label: "Partnership" },
  { value: "content",     label: "Content / SEO" },
  { value: "direct",      label: "Direct outreach" },
];

export const TAG_PALETTE: FieldOption[] = [
  { value: "founder",     label: "Founder",     color: "violet" },
  { value: "ai",          label: "AI",          color: "emerald" },
  { value: "designer",    label: "Designer",    color: "amber" },
  { value: "agency",      label: "Agency",      color: "indigo" },
  { value: "research",    label: "Research",    color: "sky" },
  { value: "enterprise",  label: "Enterprise",  color: "indigo" },
  { value: "expansion",   label: "Expansion",   color: "emerald" },
  { value: "high-value",  label: "High-value",  color: "amber" },
  { value: "infra",       label: "Infra",       color: "slate" },
  { value: "ml",          label: "ML",          color: "violet" },
];

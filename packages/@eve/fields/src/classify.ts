import {
  AlignLeft,
  AtSign,
  Calendar,
  CircleDot,
  DollarSign,
  Globe,
  Hash,
  Link2,
  Mail,
  Percent,
  Phone,
  Tags,
  ToggleLeft,
  Type as TypeIcon,
  User,
  Users,
} from "lucide-react";

import type { FieldIcon, HeroFieldType } from "./types";

// ─── Auto-classify a value into a HeroFieldType ───────────────────────────────
// Caller usually passes `type` explicitly. This is a best-effort fallback
// for callers that don't know the type up front. Keep in sync with the slug
// patterns in property-renderer/utils/propertyClassifier so the two systems
// resolve the same property the same way.

const SLUG_EMAIL = /email/i;
const SLUG_PHONE = /phone|mobile|(?:^|_|-)(?:cell|fax|tel)(?:$|_|-)/i;
const SLUG_URL =
  /url|uri|website|homepage|linkedin|twitter|github|instagram|facebook|youtube|portfolio/i;
const SLUG_STATUS = /status|stage|phase|state|disposition|pipeline/i;
const SLUG_DATE = /date|^(starts?|ends?|due|created|updated|published)(_at)?$/i;
const SLUG_CURRENCY = /amount|price|cost|revenue|value|salary|budget/i;
const SLUG_PERCENT = /progress|completion|percent|^pct_/i;
const SLUG_RICHTEXT =
  /^(notes?|description|body|brief|summary|bio|content|details?|overview|about|message|remarks?|comments?)$/i;
const SLUG_ENTITY =
  /^(person|assignee|owner|lead|contact|company|client|deal|manager|reporter|author)$/i;
const SLUG_MULTI_ENTITY = /assignees|owners|members|contacts|companies|tags|labels/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//i;
const PHONE_RE = /^[\d+\s\-().]{6,}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T|$)/;

/**
 * Best-effort field-type inference from (value, slug). Prefer passing `type`
 * explicitly when authoring fields; this exists for dynamic property renderers
 * that don't know the type up front.
 */
export function classifyValue(
  value: unknown,
  slug?: string,
): HeroFieldType {
  const s = (slug ?? "").toLowerCase();

  // 1) Slug overrides for ambiguous string values (e.g. "" vs explicit phone field)
  if (s) {
    if (SLUG_STATUS.test(s)) return "status";
    if (SLUG_PERCENT.test(s)) return "percent";
    if (SLUG_CURRENCY.test(s)) return "currency";
    if (SLUG_DATE.test(s)) return "date";
    if (SLUG_EMAIL.test(s)) return "email";
    if (SLUG_PHONE.test(s)) return "phone";
    if (SLUG_URL.test(s)) return "url";
    if (SLUG_RICHTEXT.test(s)) return "richtext";
    if (SLUG_MULTI_ENTITY.test(s)) return "multi-entity";
    if (SLUG_ENTITY.test(s)) return "entity";
  }

  // 2) Value shape inference
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";

  if (Array.isArray(value)) {
    return "tags";
  }

  if (value instanceof Date) return "date";

  if (typeof value === "string") {
    if (ISO_DATE_RE.test(value)) return "date";
    if (EMAIL_RE.test(value)) return "email";
    if (URL_RE.test(value)) return "url";
    if (PHONE_RE.test(value) && value.replace(/\D/g, "").length >= 7)
      return "phone";
  }

  return "text";
}

// ─── Default icon per field type ──────────────────────────────────────────────

const TYPE_ICON_MAP: Record<HeroFieldType, FieldIcon> = {
  text: TypeIcon,
  email: Mail,
  phone: Phone,
  url: Globe,
  number: Hash,
  currency: DollarSign,
  percent: Percent,
  date: Calendar,
  select: AtSign,
  status: CircleDot,
  "multi-select": Tags,
  tags: Tags,
  entity: User,
  "multi-entity": Users,
  boolean: ToggleLeft,
  richtext: AlignLeft,
};

export function resolveFieldIcon(
  type: HeroFieldType,
  explicit?: FieldIcon,
): FieldIcon {
  return explicit ?? TYPE_ICON_MAP[type] ?? Link2;
}

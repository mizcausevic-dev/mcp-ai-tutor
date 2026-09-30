/**
 * Minimal AI Tutor Card v0.1 schema + discovery helpers.
 * Kept self-contained so this package does not depend on
 * ai-tutor-card-spec being npm-published.
 */
import { z } from "zod";
import { isIP } from "node:net";
import { fetchPinnedHttpsText, type AddressLookup, type HttpsRequest } from "./network.js";

export const WELL_KNOWN_PREFIX = "/.well-known/tutors/";
const MAX_CARD_BYTES = 256 * 1024;
const TUTOR_ID = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CARD_PATH = /^\/\.well-known\/tutors\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.json$/;

export const tutorSchema = z.object({
  id: z.string().regex(TUTOR_ID),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+].+)?$/),
  provider: z.string().min(1),
  homepage: z.string().url().optional(),
  description: z.string().min(1),
}).strict();

export const audienceSchema = z.object({
  age_range_min: z.number().int().min(3).max(99),
  age_range_max: z.number().int().min(3).max(99),
  grade_range_min: z.string().min(1),
  grade_range_max: z.string().min(1),
  language_codes: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)).min(1),
}).strict();

export const subjectScopeSchema = z.object({
  primary_subjects: z.array(z.string().min(1)).min(1),
  topics_included: z.array(z.string()).optional(),
  topics_excluded: z.array(z.string()).optional(),
}).strict();

export const pedagogySchema = z.object({
  approach: z.enum(["socratic", "direct_instruction", "scaffolded", "personalized", "mixed"]),
  homework_policy: z.enum(["complete", "guide_only", "refuse"]),
  assessment_policy: z.enum(["complete", "guide_only", "refuse"]),
  supports_visual_explanations: z.boolean().optional(),
  supports_step_by_step_breakdown: z.boolean().optional(),
  supports_alternative_explanations: z.boolean().optional(),
}).strict();

export const safetySchema = z.object({
  content_filter_strength: z.enum(["strict", "moderate", "light"]),
  mandated_reporter_protocol: z.boolean(),
  human_in_loop_required: z.array(z.string()),
  blocks_explicit_content: z.boolean().optional(),
  blocks_drug_alcohol_content: z.boolean().optional(),
  blocks_violence_content: z.boolean().optional(),
  blocks_political_advocacy: z.boolean().optional(),
}).strict();

export const dataPrivacySchema = z.object({
  ferpa_compliant: z.boolean(),
  coppa_compliant: z.boolean(),
  gdpr_compliant: z.boolean(),
  retention_days: z.number().int().min(0),
  data_sharing_with_parents: z.enum(["full_transcript", "summaries_only", "none"]),
  data_sharing_with_school: z.enum(["full_transcript", "summaries_only", "none"]),
  third_party_data_sharing: z.boolean(),
  model_training_consent_required: z.boolean().optional(),
}).strict();

export const curriculumFrameworkSchema = z.object({
  framework: z.string().min(1),
  version: z.string().optional(),
  coverage_uri: z.string().url().optional(),
}).strict();

export const evaluationSchema = z.object({
  suite: z.string().min(1),
  result_uri: z.string().url(),
  metrics: z.record(z.unknown()).optional(),
  ran_at: z.string().datetime({ offset: true }),
}).strict();

export const auditSchema = z.object({
  audit_log_uri: z.string().url().optional(),
  incident_response_uri: z.string().url().optional(),
  disclosure_uri: z.string().url().optional(),
}).strict();

export const tutorCardDisclosureSchema = z
  .object({
    tutor_card_version: z.literal("0.1"),
    tutor: tutorSchema,
    audience: audienceSchema,
    subject_scope: subjectScopeSchema,
    pedagogy: pedagogySchema,
    curriculum_alignment: z.array(curriculumFrameworkSchema).optional(),
    safety: safetySchema,
    data_privacy: dataPrivacySchema,
    agent_card_uri: z.string().url().optional(),
    evaluations: z.array(evaluationSchema).optional(),
    audit: auditSchema.optional(),
  })
  .strict();

export const tutorCardSchema = tutorCardDisclosureSchema.superRefine((card, context) => {
  if (card.audience.age_range_min > card.audience.age_range_max) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["audience", "age_range_max"], message: "Maximum age must not be less than minimum age." });
  }
  if (card.audience.age_range_min < 13 && !card.data_privacy.coppa_compliant) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["data_privacy", "coppa_compliant"], message: "Under-13 audience requires coppa_compliant=true as a publisher disclosure." });
  }
});

export type TutorCard = z.infer<typeof tutorCardSchema>;

export function tutorWellKnownUrl(origin: string, tutor_id: string): string {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("origin must be an HTTPS origin without credentials, path, query, or fragment");
  }
  if (!TUTOR_ID.test(tutor_id)) throw new Error("tutor_id must be a kebab-case identifier");
  return parsed.origin + WELL_KNOWN_PREFIX + tutor_id + ".json";
}

export function parseTutorCard(raw: string): TutorCard {
  if (Buffer.byteLength(raw, "utf8") > MAX_CARD_BYTES) throw new Error("Tutor Card document exceeds 256 KiB");
  const data = JSON.parse(raw);
  return tutorCardSchema.parse(data);
}

export function parseTutorCardDisclosure(raw: string): TutorCard {
  if (Buffer.byteLength(raw, "utf8") > MAX_CARD_BYTES) throw new Error("Tutor Card document exceeds 256 KiB");
  return tutorCardDisclosureSchema.parse(JSON.parse(raw));
}

function checkedCardUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || isIP(url.hostname) || url.hostname.includes(":") || url.hostname === "localhost" || url.hostname.endsWith(".local")) {
    throw new Error("Tutor Card URL must be a public HTTPS hostname without credentials");
  }
  if (url.port || url.search || url.hash || !CARD_PATH.test(url.pathname)) {
    throw new Error("Tutor Card URL must use the canonical /.well-known/tutors/<id>.json path on standard HTTPS");
  }
  const allowed = (process.env.MCP_AI_TUTOR_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(url.hostname.toLowerCase())) {
    throw new Error("Tutor Card host is not in MCP_AI_TUTOR_ALLOWED_HOSTS");
  }
  return url;
}

export async function fetchTutorCardText(
  rawUrl: string,
  { timeoutMs = 10_000, lookup, request }: { timeoutMs?: number; lookup?: AddressLookup; request?: HttpsRequest } = {},
): Promise<string> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new Error("timeoutMs must be between 1 and 30000 milliseconds");
  }
  return fetchPinnedHttpsText(checkedCardUrl(rawUrl), { timeoutMs, lookup, request });
}

export async function fetchTutorCard(url: string): Promise<TutorCard> {
  return parseTutorCard(await fetchTutorCardText(url));
}

/**
 * Implements the spec's COPPA conditional rule:
 *   audience.age_range_min < 13  =>  data_privacy.coppa_compliant === true.
 */
export interface CoppaCheckResult {
  ok: boolean;
  reason: string;
  age_range_min: number;
  coppa_compliant: boolean;
}

export function checkCoppa(card: TutorCard): CoppaCheckResult {
  const minAge = card.audience.age_range_min;
  const coppa = card.data_privacy.coppa_compliant;
  if (minAge >= 13) {
    return {
      ok: true,
      reason: "Audience min age >= 13; COPPA conditional rule does not apply.",
      age_range_min: minAge,
      coppa_compliant: coppa,
    };
  }
  if (coppa) {
    return {
      ok: true,
      reason: `Audience min age is ${minAge} (<13) and coppa_compliant=true, as required by the spec.`,
      age_range_min: minAge,
      coppa_compliant: coppa,
    };
  }
  return {
    ok: false,
    reason: `SPEC VIOLATION: audience min age is ${minAge} (<13) but coppa_compliant=false. The publisher disclosure needs correction and independent review before procurement.`,
    age_range_min: minAge,
    coppa_compliant: coppa,
  };
}

/**
 * Subject-coverage check: given a query string, does the tutor's
 * scope cover it (case-insensitive)?
 *
 * Logic, in order:
 *   1. If the query matches any entry in topics_excluded -> NOT covered (excluded)
 *   2. If it matches a primary_subjects entry -> covered (primary)
 *   3. If it matches a topics_included entry -> covered (included)
 *   4. Otherwise -> unknown (not declared either way)
 */
export interface SubjectCheckResult {
  covered: boolean;
  classification: "primary" | "included" | "excluded" | "unknown";
  matched_term: string | null;
}

export function checkSubject(card: TutorCard, query: string): SubjectCheckResult {
  const q = query.trim().toLowerCase();
  if (!q) return { covered: false, classification: "unknown", matched_term: null };
  const excluded = (card.subject_scope.topics_excluded ?? []).find((t) => t.toLowerCase().includes(q));
  if (excluded) return { covered: false, classification: "excluded", matched_term: excluded };
  const primary = card.subject_scope.primary_subjects.find((s) => s.toLowerCase().includes(q));
  if (primary) return { covered: true, classification: "primary", matched_term: primary };
  const included = (card.subject_scope.topics_included ?? []).find((t) => t.toLowerCase().includes(q));
  if (included) return { covered: true, classification: "included", matched_term: included };
  return { covered: false, classification: "unknown", matched_term: null };
}

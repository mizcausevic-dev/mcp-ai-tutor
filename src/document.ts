/**
 * Minimal AI Tutor Card v0.1 schema + discovery helpers.
 * Kept self-contained so this package does not depend on
 * ai-tutor-card-spec being npm-published.
 */
import { z } from "zod";

export const WELL_KNOWN_PREFIX = "/.well-known/tutors/";
const ACCEPT_HEADER = "application/json";

export const tutorSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  name: z.string().min(1),
  version: z.string(),
  provider: z.string().min(1),
  homepage: z.string().url().optional(),
  description: z.string().min(1),
});

export const audienceSchema = z.object({
  age_range_min: z.number().int().min(3).max(99),
  age_range_max: z.number().int().min(3).max(99),
  grade_range_min: z.string().min(1),
  grade_range_max: z.string().min(1),
  language_codes: z.array(z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)).min(1),
});

export const subjectScopeSchema = z.object({
  primary_subjects: z.array(z.string().min(1)).min(1),
  topics_included: z.array(z.string()).optional(),
  topics_excluded: z.array(z.string()).optional(),
});

export const pedagogySchema = z.object({
  approach: z.enum(["socratic", "direct_instruction", "scaffolded", "personalized", "mixed"]),
  homework_policy: z.enum(["complete", "guide_only", "refuse"]),
  assessment_policy: z.enum(["complete", "guide_only", "refuse"]),
  supports_visual_explanations: z.boolean().optional(),
  supports_step_by_step_breakdown: z.boolean().optional(),
  supports_alternative_explanations: z.boolean().optional(),
});

export const safetySchema = z.object({
  content_filter_strength: z.enum(["strict", "moderate", "light"]),
  mandated_reporter_protocol: z.boolean(),
  human_in_loop_required: z.array(z.string()),
  blocks_explicit_content: z.boolean().optional(),
  blocks_drug_alcohol_content: z.boolean().optional(),
  blocks_violence_content: z.boolean().optional(),
  blocks_political_advocacy: z.boolean().optional(),
});

export const dataPrivacySchema = z.object({
  ferpa_compliant: z.boolean(),
  coppa_compliant: z.boolean(),
  gdpr_compliant: z.boolean(),
  retention_days: z.number().int().min(0),
  data_sharing_with_parents: z.enum(["full_transcript", "summaries_only", "none"]),
  data_sharing_with_school: z.enum(["full_transcript", "summaries_only", "none"]),
  third_party_data_sharing: z.boolean(),
  model_training_consent_required: z.boolean().optional(),
});

export const curriculumFrameworkSchema = z.object({
  framework: z.string().min(1),
  version: z.string().optional(),
  coverage_uri: z.string().url().optional(),
});

export const evaluationSchema = z.object({
  suite: z.string().min(1),
  result_uri: z.string().url(),
  metrics: z.record(z.unknown()).optional(),
  ran_at: z.string(),
});

export const auditSchema = z.object({
  audit_log_uri: z.string().url().optional(),
  incident_response_uri: z.string().url().optional(),
  disclosure_uri: z.string().url().optional(),
});

export const tutorCardSchema = z
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

export type TutorCard = z.infer<typeof tutorCardSchema>;

export function tutorWellKnownUrl(origin: string, tutor_id: string): string {
  return origin.replace(/\/+$/, "") + WELL_KNOWN_PREFIX + encodeURIComponent(tutor_id) + ".json";
}

export function parseTutorCard(raw: string): TutorCard {
  const data = JSON.parse(raw);
  return tutorCardSchema.parse(data);
}

export async function fetchTutorCard(url: string, { timeoutMs = 10_000 }: { timeoutMs?: number } = {}): Promise<TutorCard> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: ACCEPT_HEADER },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} (${url})`);
    }
    return parseTutorCard(await response.text());
  } finally {
    clearTimeout(timer);
  }
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
    reason: `SPEC VIOLATION: audience min age is ${minAge} (<13) but coppa_compliant=false. This is procurement-blocking for any US K-12 deployment.`,
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
  const excluded = (card.subject_scope.topics_excluded ?? []).find((t) => t.toLowerCase().includes(q));
  if (excluded) return { covered: false, classification: "excluded", matched_term: excluded };
  const primary = card.subject_scope.primary_subjects.find((s) => s.toLowerCase().includes(q));
  if (primary) return { covered: true, classification: "primary", matched_term: primary };
  const included = (card.subject_scope.topics_included ?? []).find((t) => t.toLowerCase().includes(q));
  if (included) return { covered: true, classification: "included", matched_term: included };
  return { covered: false, classification: "unknown", matched_term: null };
}

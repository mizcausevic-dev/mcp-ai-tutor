import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handlers } from "../src/server.js";
import { fetchTutorCardText } from "../src/document.js";

const K12_MATH_TUTOR = {
  tutor_card_version: "0.1",
  tutor: {
    id: "k12-math-tutor",
    name: "K-12 Math Tutor",
    version: "1.0.0",
    provider: "Kinetic Gain Edu",
    description: "Personal AI math tutor for K-12.",
  },
  audience: {
    age_range_min: 5,
    age_range_max: 18,
    grade_range_min: "K",
    grade_range_max: "12",
    language_codes: ["en", "es"],
  },
  subject_scope: {
    primary_subjects: ["Math"],
    topics_included: ["arithmetic", "algebra", "geometry"],
    topics_excluded: ["calculus"],
  },
  pedagogy: {
    approach: "socratic",
    homework_policy: "guide_only",
    assessment_policy: "refuse",
  },
  safety: {
    content_filter_strength: "strict",
    mandated_reporter_protocol: true,
    human_in_loop_required: ["abuse_disclosure", "self_harm_disclosure"],
  },
  data_privacy: {
    ferpa_compliant: true,
    coppa_compliant: true,
    gdpr_compliant: true,
    retention_days: 90,
    data_sharing_with_parents: "summaries_only",
    data_sharing_with_school: "summaries_only",
    third_party_data_sharing: false,
  },
};

// A card that violates the COPPA conditional rule (age_range_min=8 but coppa=false).
const COPPA_VIOLATING_CARD = {
  ...K12_MATH_TUTOR,
  tutor: { ...K12_MATH_TUTOR.tutor, id: "broken-card" },
  audience: { ...K12_MATH_TUTOR.audience, age_range_min: 8 },
  data_privacy: { ...K12_MATH_TUTOR.data_privacy, coppa_compliant: false },
};

const HIGHSCHOOL_TUTOR = {
  ...K12_MATH_TUTOR,
  tutor: { ...K12_MATH_TUTOR.tutor, id: "hs-tutor" },
  audience: { ...K12_MATH_TUTOR.audience, age_range_min: 14, age_range_max: 18, grade_range_min: "9" },
  data_privacy: { ...K12_MATH_TUTOR.data_privacy, coppa_compliant: false },
};

const cardUrl = "https://tutors.example.org/.well-known/tutors/k12-math-tutor.json";
const priorAllowedHosts = process.env.MCP_AI_TUTOR_ALLOWED_HOSTS;
beforeEach(() => { process.env.MCP_AI_TUTOR_ALLOWED_HOSTS = "tutors.example.org"; });
afterEach(() => {
  vi.restoreAllMocks();
  if (priorAllowedHosts === undefined) delete process.env.MCP_AI_TUTOR_ALLOWED_HOSTS;
  else process.env.MCP_AI_TUTOR_ALLOWED_HOSTS = priorAllowedHosts;
});

describe("tutor_card_well_known_url", () => {
  it("builds the canonical path", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_well_known_url!({
        origin: "https://edu.example.com",
        tutor_id: "k12-math-tutor",
      }),
    );
    expect(out.url).toBe("https://edu.example.com/.well-known/tutors/k12-math-tutor.json");
  });

  it("rejects invalid tutor identifiers", async () => {
    await expect(handlers.tutor_card_well_known_url!({ origin: "https://edu.example.org", tutor_id: "tutor/with/slashes" })).rejects.toThrow("kebab-case");
  });

  it("rejects non-HTTPS origins and paths", async () => {
    await expect(handlers.tutor_card_well_known_url!({ origin: "http://edu.example.org", tutor_id: "math" })).rejects.toThrow("HTTPS origin");
    await expect(handlers.tutor_card_well_known_url!({ origin: "https://edu.example.org/path", tutor_id: "math" })).rejects.toThrow("HTTPS origin");
    await expect(handlers.tutor_card_well_known_url!({ origin: "https://edu.example.org:8443", tutor_id: "math" })).rejects.toThrow("HTTPS origin");
  });
});

describe("tutor_card_fetch", () => {
  it("fetches a published card", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(K12_MATH_TUTOR), { headers: { "content-type": "application/json" } }));
    const out = JSON.parse(
      await handlers.tutor_card_fetch!({
        url: cardUrl,
      }),
    );
    expect(out.tutor.id).toBe("k12-math-tutor");
    expect(out.audience.age_range_min).toBe(5);
  });

  it("rejects private or unapproved destinations before fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(handlers.tutor_card_fetch!({ url: "http://127.0.0.1:9000/metadata" })).rejects.toThrow("public HTTPS");
    await expect(handlers.tutor_card_fetch!({ url: "https://other.example.org/.well-known/tutors/math.json" })).rejects.toThrow("ALLOWED_HOSTS");
    await expect(handlers.tutor_card_fetch!({ url: "https://tutors.example.org/admin" })).rejects.toThrow("canonical");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a bounded positive timeout", async () => {
    await expect(fetchTutorCardText(cardUrl, { timeoutMs: 0 })).rejects.toThrow("timeoutMs");
    await expect(fetchTutorCardText(cardUrl, { timeoutMs: Number.POSITIVE_INFINITY })).rejects.toThrow("timeoutMs");
  });

  it("caps remote card size and rejects redirects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("x".repeat(256 * 1024 + 1), { headers: { "content-type": "application/json" } }));
    await expect(fetchTutorCardText(cardUrl)).rejects.toThrow("256 KiB");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.redirect("https://other.example.org/card.json"));
    await expect(fetchTutorCardText(cardUrl)).rejects.toThrow("HTTP 302");
  });
});

describe("tutor_card_validate", () => {
  it("accepts a conforming K-12 card and includes a passing coppa_check", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_validate!({
        document_json: JSON.stringify(K12_MATH_TUTOR),
      }),
    );
    expect(out.valid).toBe(true);
    expect(out.tutor_id).toBe("k12-math-tutor");
    expect(out.coppa_check.ok).toBe(true);
  });

  it("rejects the COPPA conditional violation as invalid", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_validate!({
        document_json: JSON.stringify(COPPA_VIOLATING_CARD),
      }),
    );
    expect(out.valid).toBe(false);
    expect(out.reason).toContain("coppa_compliant");
  });

  it("rejects malformed JSON", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_validate!({ document_json: "{ not json" }),
    );
    expect(out.valid).toBe(false);
  });

  it("rejects a document missing required fields", async () => {
    const stripped = { ...K12_MATH_TUTOR, audience: undefined };
    const out = JSON.parse(
      await handlers.tutor_card_validate!({
        document_json: JSON.stringify(stripped),
      }),
    );
    expect(out.valid).toBe(false);
  });

  it("rejects reversed ages and extra nested fields", async () => {
    const reversed = { ...K12_MATH_TUTOR, audience: { ...K12_MATH_TUTOR.audience, age_range_min: 18, age_range_max: 5 } };
    expect(JSON.parse(await handlers.tutor_card_validate!({ document_json: JSON.stringify(reversed) })).valid).toBe(false);
    const extra = { ...K12_MATH_TUTOR, tutor: { ...K12_MATH_TUTOR.tutor, unapproved: "x" } };
    expect(JSON.parse(await handlers.tutor_card_validate!({ document_json: JSON.stringify(extra) })).valid).toBe(false);
  });
});

describe("tutor_card_inspect", () => {
  it("returns a procurement-summary shape for an inline document", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_inspect!({
        document_json: JSON.stringify(K12_MATH_TUTOR),
      }),
    );
    expect(out.tutor.id).toBe("k12-math-tutor");
    expect(out.audience.ages).toBe("5-18");
    expect(out.pedagogy.homework_policy).toBe("guide_only");
    expect(out.pedagogy.assessment_policy).toBe("refuse");
    expect(out.privacy.ferpa_compliant).toBe(true);
    expect(out.privacy.coppa_compliant).toBe(true);
    expect(out.privacy.parents_see).toBe("summaries_only");
    expect(out.coppa_check.ok).toBe(true);
  });

  it("fetches a URL when document_json is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(K12_MATH_TUTOR), { headers: { "content-type": "application/json" } }));
    const out = JSON.parse(
      await handlers.tutor_card_inspect!({
        url: cardUrl,
      }),
    );
    expect(out.tutor.id).toBe("k12-math-tutor");
  });
});

describe("tutor_card_subject_check", () => {
  it("classifies a primary subject as primary", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_subject_check!({
        document_json: JSON.stringify(K12_MATH_TUTOR),
        query: "math",
      }),
    );
    expect(out.classification).toBe("primary");
    expect(out.covered).toBe(true);
  });

  it("classifies an included topic as included", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_subject_check!({
        document_json: JSON.stringify(K12_MATH_TUTOR),
        query: "algebra",
      }),
    );
    expect(out.classification).toBe("included");
    expect(out.covered).toBe(true);
  });

  it("classifies an excluded topic as excluded", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_subject_check!({
        document_json: JSON.stringify(K12_MATH_TUTOR),
        query: "calculus",
      }),
    );
    expect(out.classification).toBe("excluded");
    expect(out.covered).toBe(false);
  });

  it("classifies an undeclared topic as unknown", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_subject_check!({
        document_json: JSON.stringify(K12_MATH_TUTOR),
        query: "creative writing",
      }),
    );
    expect(out.classification).toBe("unknown");
    expect(out.covered).toBe(false);
  });

  it("does not classify an empty topic as an excluded or covered subject", async () => {
    const out = JSON.parse(await handlers.tutor_card_subject_check!({
      document_json: JSON.stringify(K12_MATH_TUTOR), query: "   ",
    }));
    expect(out.classification).toBe("unknown");
    expect(out.covered).toBe(false);
  });
});

describe("tutor_card_coppa_check", () => {
  it("passes when age_range_min < 13 and coppa_compliant = true", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_coppa_check!({
        document_json: JSON.stringify(K12_MATH_TUTOR),
      }),
    );
    expect(out.ok).toBe(true);
  });

  it("fails when age_range_min < 13 and coppa_compliant = false", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_coppa_check!({
        document_json: JSON.stringify(COPPA_VIOLATING_CARD),
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toContain("SPEC VIOLATION");
  });

  it("passes (rule does not apply) when age_range_min >= 13", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_coppa_check!({
        document_json: JSON.stringify(HIGHSCHOOL_TUTOR),
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.reason).toContain("does not apply");
  });
});

describe("handler exhaustiveness", () => {
  it("exposes exactly the 6 declared tools", () => {
    expect(Object.keys(handlers)).toHaveLength(6);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";

import { handlers } from "../src/server.js";

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

let server: HttpServer;
let originUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/.well-known/tutors/k12-math-tutor.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(K12_MATH_TUTOR));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr === "object" && addr !== null) {
    originUrl = `http://127.0.0.1:${addr.port}`;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

  it("encodes special characters in tutor_id", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_well_known_url!({
        origin: "https://edu.example.com",
        tutor_id: "tutor-with-slashes",
      }),
    );
    expect(out.url).toContain("tutor-with-slashes.json");
  });
});

describe("tutor_card_fetch", () => {
  it("fetches a published card", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_fetch!({
        url: `${originUrl}/.well-known/tutors/k12-math-tutor.json`,
      }),
    );
    expect(out.tutor.id).toBe("k12-math-tutor");
    expect(out.audience.age_range_min).toBe(5);
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

  it("flags the COPPA conditional violation in coppa_check even when the document is otherwise schema-valid", async () => {
    const out = JSON.parse(
      await handlers.tutor_card_validate!({
        document_json: JSON.stringify(COPPA_VIOLATING_CARD),
      }),
    );
    expect(out.valid).toBe(true); // schema-level fields are fine
    expect(out.coppa_check.ok).toBe(false);
    expect(out.coppa_check.reason).toContain("SPEC VIOLATION");
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
    const out = JSON.parse(
      await handlers.tutor_card_inspect!({
        url: `${originUrl}/.well-known/tutors/k12-math-tutor.json`,
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

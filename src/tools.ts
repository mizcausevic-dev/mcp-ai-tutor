/**
 * MCP tool descriptors for the AI Tutor Cards spec.
 */
export const toolDescriptors = [
  {
    name: "tutor_card_well_known_url",
    description:
      "Compute the canonical AI Tutor Card well-known URL for a vendor + tutor_id (convention: /.well-known/tutors/<tutor_id>.json).",
    inputSchema: {
      type: "object",
      required: ["origin", "tutor_id"],
      additionalProperties: false,
      properties: {
        origin: { type: "string", format: "uri", description: "Vendor origin URL." },
        tutor_id: { type: "string", description: "Tutor identifier (kebab-case)." },
      },
    },
  },
  {
    name: "tutor_card_fetch",
    description:
      "Fetch and return the full AI Tutor Card from a URL. Provide either the well-known URL or any other URL where the card is hosted.",
    inputSchema: {
      type: "object",
      required: ["url"],
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri", description: "Tutor Card URL." },
      },
    },
  },
  {
    name: "tutor_card_validate",
    description: "Validate an AI Tutor Card JSON document against the v0.1 schema. Returns { valid, tutor_id, version, coppa_check } or { valid: false, reason }.",
    inputSchema: {
      type: "object",
      required: ["document_json"],
      additionalProperties: false,
      properties: {
        document_json: { type: "string", description: "Tutor Card as a JSON string." },
      },
    },
  },
  {
    name: "tutor_card_inspect",
    description:
      "Return a structured procurement-review summary of an AI Tutor Card: audience, pedagogy (homework/assessment policy), safety strength, FERPA / COPPA / GDPR posture, retention, data-sharing rules, evaluation suites. Accepts EITHER `url` (fetched) OR `document_json` (inline).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
      },
    },
  },
  {
    name: "tutor_card_subject_check",
    description:
      "Given a Tutor Card and a subject/topic query, classify whether the tutor covers it: primary subject, explicitly included topic, explicitly excluded topic, or not declared. Useful for matching a curriculum or lesson plan against a tutor's declared scope.",
    inputSchema: {
      type: "object",
      required: ["query"],
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
        query: { type: "string", description: "Subject or topic to check (e.g. 'algebra', 'thesis writing')." },
      },
    },
  },
  {
    name: "tutor_card_coppa_check",
    description:
      "Verify the spec's conditional COPPA rule: if audience.age_range_min < 13, data_privacy.coppa_compliant MUST be true. Returns { ok, reason, age_range_min, coppa_compliant }. Procurement-blocking signal when ok=false.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", format: "uri" },
        document_json: { type: "string" },
      },
    },
  },
];

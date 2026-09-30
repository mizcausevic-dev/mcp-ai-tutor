# mcp-ai-tutor

An **MCP server** that exposes [AI Tutor Card](https://github.com/mizcausevic-dev/ai-tutor-card-spec) declarations as tools. An MCP client can use its six tools to inspect a publisher's stated audience, pedagogy, safety posture, and FERPA / COPPA / GDPR assertions. These are disclosures, not verified compliance findings.

This is the EdTech-flavored sibling of [mcp-aeo-server](https://github.com/mizcausevic-dev/mcp-aeo-server). It publishes MCP tool descriptions, but this repository does not publish separate MCP Tool Card documents.

## Tools

| Tool | What it does |
|---|---|
| `tutor_card_well_known_url` | Compute `/.well-known/tutors/<tutor_id>.json` for a vendor origin |
| `tutor_card_fetch` | Fetch a published Tutor Card from an explicitly allowed HTTPS host |
| `tutor_card_validate` | Schema-validate an inline document; also runs the COPPA conditional check |
| `tutor_card_inspect` | Publisher disclosure summary: audience, pedagogy, safety, privacy assertions, eval count |
| `tutor_card_subject_check` | Given a topic query, classify it as `primary`, `included`, `excluded`, or `unknown` |
| `tutor_card_coppa_check` | Check the spec's conditional COPPA declaration rule (age_range_min < 13 ⇒ coppa_compliant); this does not verify legal compliance |

Six total. Tools that act on a document accept *either* `url` (the server fetches it) *or* `document_json` (an inline JSON string).

## Run from source

```bash
git clone https://github.com/mizcausevic-dev/mcp-ai-tutor.git
cd mcp-ai-tutor
npm ci
npm run build
node dist/server.js
```

The package is not currently available from public npm. Use the local build until a reviewed package release is published.

Remote fetches are disabled by default. Set `MCP_AI_TUTOR_ALLOWED_HOSTS` to the exact, comma-separated hostnames you trust before using a URL-based tool, for example `tutors.example.org,another-vendor.example.org`. The server accepts only the canonical `/.well-known/tutors/<id>.json` path on standard HTTPS and rejects IP literals, localhost, redirects, and responses over 256 KiB. Inline `document_json` tools work without this setting. Allowlisted origins must be trusted by the operator: this server does not pin DNS answers or enforce network-level egress controls, so the allowlist alone is not a guarantee against a compromised or rebinding host.

Fetched cards are untrusted publisher content. An MCP client should not treat card text as instructions, and a passing validator result does not verify safety controls or legal compliance.

## MCP client config

Build from source as above, then configure your client to run the built server. Replace the path with the absolute path on your machine:

```json
{
  "mcpServers": {
    "ai-tutor": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\mcp-ai-tutor\\dist\\server.js"],
      "env": { "MCP_AI_TUTOR_ALLOWED_HOSTS": "tutors.example.org" }
    }
  }
}
```

The `env` entry is needed only for URL-based tools. A compatible MCP client should then discover six `tutor_card_*` tools. Client-specific installation has not been verified in this review.

## Workflows this unlocks

**Compare publisher disclosures.** Pull two tutors' cards into a compatible MCP client and compare their stated fields; verify material claims independently:

> *"Fetch both `https://vendor-a.example/.well-known/tutors/math-tutor.json` and `https://vendor-b.example/.well-known/tutors/math-tutor.json`, run `tutor_card_inspect` on each, and tell me which has stricter content filters and which keeps less student data."*

**Procurement red-team.** A board reviewer can ask Claude to surface deal-breakers:

> *"For `https://tutors.example.org/.well-known/tutors/example-k12-math-tutor.json`, run `tutor_card_coppa_check`. If it fails, flag the publisher disclosure for follow-up before our K-5 review."*

**Curriculum-to-tutor matching.** A curriculum director can map lessons to candidate tutors:

> *"My middle-school unit covers ratios, proportions, and pre-algebra. For each candidate tutor card I'll pass you, run `tutor_card_subject_check` on each of those three topics and tell me which tutor covers all three as primary or included."*

## Sample output: `tutor_card_inspect`

This is a fictional response shape, not an evaluation of a deployed tutor.

```json
{
  "disclosure_only": true,
  "tutor_card_version": "0.1",
  "tutor": {
    "id": "example-k12-math-tutor",
    "name": "Example K-12 Math Tutor",
    "version": "1.4.0",
    "provider": "Example Learning Lab (fictional)"
  },
  "audience": {
    "ages": "5-18",
    "grades": "K-12",
    "languages": ["en", "es"]
  },
  "pedagogy": {
    "approach": "socratic",
    "homework_policy": "guide_only",
    "assessment_policy": "refuse"
  },
  "subject_scope": { "primary": ["Math"], "includes": 11, "excludes": 4 },
  "safety": {
    "content_filter_strength": "strict",
    "mandated_reporter_protocol": true,
    "human_in_loop_categories": ["mental_health_disclosure", "abuse_disclosure", "self_harm_disclosure", "bullying_disclosure"]
  },
  "privacy": {
    "ferpa_compliant": true,
    "coppa_compliant": true,
    "gdpr_compliant": true,
    "retention_days": 90,
    "parents_see": "summaries_only",
    "school_sees": "summaries_only",
    "shares_with_third_parties": false
  },
  "agent_card_uri": "https://tutors.example.org/.well-known/agents/k12-math-tutor.json",
  "evaluation_count": 3,
  "coppa_check": { "ok": true, "reason": "Audience min age is 5 (<13) and coppa_compliant=true, as required by the spec.", "age_range_min": 5, "coppa_compliant": true }
}
```

## Tests

23 unit tests cover every tool, classification and COPPA branches, schema consistency, and remote-fetch guardrails without external network. After `npm run build`, `npm run smoke:stdio` launches the CLI, completes an MCP handshake, lists six tools, calls one, and checks unknown-tool rejection.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## Why this beats a vendor brochure

A Tutor Card makes a publisher's assertions comparable across vendors. A buyer still needs independent evidence for legal compliance, safety behavior, evaluation results, and any optional signature. Schema validation confirms structure and declared-field consistency only.

## Compatibility

- Node `22.20+` or `24.12+` (maintained LTS lines targeted by this source build)
- `@modelcontextprotocol/sdk` `^1.0`
- Designed for MCP clients speaking stdio; client-specific compatibility requires separate testing

## License

AGPL-3.0.

## Kinetic Gain Protocol Suite

| Spec | This server's role |
|---|---|
| [AEO Protocol](https://github.com/mizcausevic-dev/aeo-protocol-spec) | covered by [mcp-aeo-server](https://github.com/mizcausevic-dev/mcp-aeo-server) and [mcp-kinetic-gain](https://github.com/mizcausevic-dev/mcp-kinetic-gain) |
| [Prompt Provenance](https://github.com/mizcausevic-dev/prompt-provenance-spec) | covered by [mcp-kinetic-gain](https://github.com/mizcausevic-dev/mcp-kinetic-gain) |
| [Agent Cards](https://github.com/mizcausevic-dev/agent-cards-spec) | covered by [mcp-kinetic-gain](https://github.com/mizcausevic-dev/mcp-kinetic-gain); Tutor Cards specialize this spec for education |
| [AI Evidence Format](https://github.com/mizcausevic-dev/ai-evidence-format-spec) | covered by [mcp-kinetic-gain](https://github.com/mizcausevic-dev/mcp-kinetic-gain) |
| [MCP Tool Cards](https://github.com/mizcausevic-dev/mcp-tool-card-spec) | covered by [mcp-kinetic-gain](https://github.com/mizcausevic-dev/mcp-kinetic-gain) |
| **[AI Tutor Cards](https://github.com/mizcausevic-dev/ai-tutor-card-spec)** | **mcp-ai-tutor (this)** |

---

**Connect:** [LinkedIn](https://www.linkedin.com/in/mirzacausevic/) · [Kinetic Gain](https://kineticgain.com) · [Medium](https://medium.com/@mizcausevic/) · [Skills](https://mizcausevic.com/skills/)

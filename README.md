# mcp-ai-tutor

> **Migration review, 2026-10-31:** The scoped standalone npm package is not published. [mcp-kinetic-gain](https://github.com/mizcausevic-dev/mcp-kinetic-gain) exposes the same six `tutor_card_*` tool names and is an npm install option, but tool-name overlap does not establish behavior parity. At this PR's head, standalone URL fetching has no application host allowlist, canonical card-path restriction, or response-size cap. Schema validation reports the COPPA conditional check separately: it can return `valid: true` with `coppa_check.ok: false`. [Hardening PR #34](https://github.com/mizcausevic-dev/mcp-ai-tutor/pull/34) proposes stricter fetch and validation behavior, but remains unmerged. Keep the focused source available pending consumer and behavior review.

An **MCP server** that exposes [AI Tutor Card](https://github.com/mizcausevic-dev/ai-tutor-card-spec) declarations as tools. Drop into Claude Desktop, Cursor, or any MCP-compatible client. The agent — or the procurement reviewer driving it — gains six tools for inspecting any AI tutor's audience, pedagogy, safety posture, and FERPA / COPPA / GDPR disclosures.

This is the EdTech-flavored sibling of [mcp-aeo-server](https://github.com/mizcausevic-dev/mcp-aeo-server). Same Tool Card discipline, different spec.

## Tools

| Tool | What it does |
|---|---|
| `tutor_card_well_known_url` | Compute `/.well-known/tutors/<tutor_id>.json` for a vendor origin |
| `tutor_card_fetch` | Fetch a published Tutor Card from a supplied URL; this branch does not enforce a host allowlist |
| `tutor_card_validate` | Schema-validate an inline document and report the COPPA conditional check separately |
| `tutor_card_inspect` | Publisher disclosure summary: audience, pedagogy, safety, privacy assertions, eval count |
| `tutor_card_subject_check` | Given a topic query, classify it as `primary`, `included`, `excluded`, or `unknown` |
| `tutor_card_coppa_check` | Check the publisher's conditional COPPA declaration (age_range_min < 13 ⇒ coppa_compliant); this is not legal compliance verification |

Six total. Tools that act on a document accept *either* `url` (the server fetches it) *or* `document_json` (an inline JSON string).

## Run this standalone source

```bash
npm ci
npm run build
node dist/server.js
```

This branch does not enforce `MCP_AI_TUTOR_ALLOWED_HOSTS`; that control is proposed in [hardening PR #34](https://github.com/mizcausevic-dev/mcp-ai-tutor/pull/34). Use inline JSON for untrusted documents and keep URL fetches limited to trusted operator-controlled input until the fetch boundary is hardened. Inline JSON tools work without network access.

## Unified npm option

The commands below run the unified Suite server and expose additional tools. Review its behavior and network policy before switching an existing client.

```bash
npm install -g mcp-kinetic-gain
```

Or run without installing via `npx`:

```bash
npx -y mcp-kinetic-gain
```

## Claude Desktop config

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "kinetic-gain": {
      "command": "npx",
      "args": ["-y", "mcp-kinetic-gain"]
    }
  }
}
```

Restart Claude. All six `tutor_card_*` tools appear among the Suite tools.

## Workflows this unlocks

**District procurement review.** Pull two tutors' cards in one conversation and let Claude compare them:

> *"Fetch both `https://vendor-a.example/.well-known/tutors/math-tutor.json` and `https://vendor-b.example/.well-known/tutors/math-tutor.json`, run `tutor_card_inspect` on each, and tell me which has stricter content filters and which keeps less student data."*

**Procurement red-team.** A board reviewer can ask Claude to surface deal-breakers:

> *"For `tutor.example.com/k12-math`, run `tutor_card_coppa_check`. If it fails, that's a blocker for our K-5 deployment."*

**Curriculum-to-tutor matching.** A curriculum director can map lessons to candidate tutors:

> *"My middle-school unit covers ratios, proportions, and pre-algebra. For each candidate tutor card I'll pass you, run `tutor_card_subject_check` on each of those three topics and tell me which tutor covers all three as primary or included."*

## Sample output: `tutor_card_inspect`

```json
{
  "tutor_card_version": "0.1",
  "tutor": {
    "id": "kineticgain-k12-math-tutor",
    "name": "Kinetic Gain K-12 Math Tutor",
    "version": "1.4.0",
    "provider": "Kinetic Gain Edu"
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
  "agent_card_uri": "https://edu.kineticgain.com/.well-known/agents/k12-math-tutor.json",
  "evaluation_count": 3,
  "coppa_check": { "ok": true, "reason": "Audience min age is 5 (<13) and coppa_compliant=true, as required by the spec.", "age_range_min": 5, "coppa_compliant": true }
}
```

## Tests

17 unit tests covering every tool, every classification path of `tutor_card_subject_check`, every branch of `tutor_card_coppa_check`, and a published-card fetch via an in-process Node HTTP server (no external network).

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Why this beats a vendor brochure

A PDF whitepaper says "we are FERPA-compliant." A signed Tutor Card the buyer's MCP-equipped review agent can read says **exactly which fields**, in a format two competing tutors can be diffed against. The procurement workflow gets a CI gate, not a sales call.

## Compatibility

- Node `18+`
- `@modelcontextprotocol/sdk` `^1.0`
- Tested with Claude Desktop, Cursor, and any client speaking MCP over stdio

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

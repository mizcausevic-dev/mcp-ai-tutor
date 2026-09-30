import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const client = new Client({ name: "mcp-ai-tutor-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  stderr: "pipe",
});
const card = {
  tutor_card_version: "0.1",
  tutor: { id: "sample", name: "Fictional Math Tutor", version: "1.0.0", provider: "Example Learning Lab", description: "Synthetic MCP smoke fixture." },
  audience: { age_range_min: 8, age_range_max: 12, grade_range_min: "3", grade_range_max: "6", language_codes: ["en"] },
  subject_scope: { primary_subjects: ["Math"] },
  pedagogy: { approach: "socratic", homework_policy: "guide_only", assessment_policy: "refuse" },
  safety: { content_filter_strength: "strict", mandated_reporter_protocol: false, human_in_loop_required: [] },
  data_privacy: { ferpa_compliant: false, coppa_compliant: true, gdpr_compliant: false, retention_days: 0, data_sharing_with_parents: "none", data_sharing_with_school: "none", third_party_data_sharing: false },
};
const timeout = setTimeout(() => {
  process.stderr.write("stdio smoke timed out before the server responded\n");
  process.exit(1);
}, 10_000);

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  const result = await client.callTool({
    name: "tutor_card_well_known_url",
    arguments: { origin: "https://example.org", tutor_id: "sample" },
  });
  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text).url, "https://example.org/.well-known/tutors/sample.json");
  const validated = await client.callTool({ name: "tutor_card_validate", arguments: { document_json: JSON.stringify(card) } });
  assert.equal(JSON.parse(validated.content[0].text).valid, true);
  const inspected = await client.callTool({ name: "tutor_card_inspect", arguments: { document_json: JSON.stringify(card) } });
  assert.equal(JSON.parse(inspected.content[0].text).disclosure_only, true);
  const deniedFetch = await client.callTool({ name: "tutor_card_fetch", arguments: { url: "https://example.org/.well-known/tutors/sample.json" } });
  assert.equal(deniedFetch.isError, true);
  assert.match(deniedFetch.content[0].text, /MCP_AI_TUTOR_ALLOWED_HOSTS/);
  const unknown = await client.callTool({ name: "unknown_tool", arguments: {} });
  assert.equal(unknown.isError, true);
  process.stdout.write("stdio handshake, six tools, validation, inspection, default-deny fetch, and unknown-tool rejection passed\n");
} finally {
  clearTimeout(timeout);
  await client.close();
}

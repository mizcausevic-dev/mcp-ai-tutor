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
  const unknown = await client.callTool({ name: "unknown_tool", arguments: {} });
  assert.equal(unknown.isError, true);
  process.stdout.write("stdio handshake, six tools, call, and unknown-tool rejection passed\n");
} finally {
  clearTimeout(timeout);
  await client.close();
}

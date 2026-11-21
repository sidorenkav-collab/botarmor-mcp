// End to end over stdio: the built server, spoken to by the official MCP client, against a local mock API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("the server lists four tools and answers a tool call through the API", async () => {
  const api = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer ba_live_test") return res.writeHead(401).end(JSON.stringify({ error: "Invalid API key" }));
    if (req.url.startsWith("/api/v1/audits?")) return res.end(JSON.stringify({ audits: [{ audit_code: "BA-FFFF6666", status: "completed", grade: "A", overall_score: 93 }] }));
    res.writeHead(404).end("{}");
  });
  await new Promise((r) => api.listen(0, "127.0.0.1", r));
  const { port } = api.address();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: { ...process.env, BOTARMOR_API_KEY: "ba_live_test", BOTARMOR_API_URL: `http://127.0.0.1:${port}/api/v1` },
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["get_audit_report", "get_audit_status", "list_audits", "start_audit"]);
    // Connector-directory rules: annotations.title, an explicit read/write hint, a type on every parameter,
    // and no description that tells the model to call another tool.
    for (const t of tools) {
      assert.ok(t.annotations?.title, `${t.name}: annotations.title`);
      assert.equal(typeof t.annotations.readOnlyHint, "boolean", `${t.name}: readOnlyHint`);
      for (const [p, schema] of Object.entries(t.inputSchema.properties ?? {})) assert.ok(schema.type, `${t.name}.${p}: type`);
      for (const other of tools) if (other.name !== t.name) assert.ok(!t.description.includes(other.name), `${t.name} names ${other.name}`);
    }
    const result = await client.callTool({ name: "list_audits", arguments: { limit: 3 } });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /BA-FFFF6666/);
    // The API key never appears in what the model sees.
    assert.doesNotMatch(JSON.stringify(result), /ba_live_test/);
    const bad = await client.callTool({ name: "get_audit_status", arguments: { audit_id: "BA-FFFF6666" } });
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    api.close();
  }
});

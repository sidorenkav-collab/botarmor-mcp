import { test } from "node:test";
import assert from "node:assert/strict";
import { BotArmorClient, BotArmorError } from "../dist/api.js";
import { startAudit, getAuditStatus, getAuditReport, listAudits, splitHeaders } from "../dist/tools.js";

// A fake API: routes "METHOD /path" to handlers, records every call.
function fakeApi(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const key = `${init.method || "GET"} ${u.pathname.replace("/api/v1", "")}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ key, body, headers: init.headers, search: u.search });
    const handler = routes[key];
    const [status, data] = handler ? handler(body, u) : [404, { error: "not found" }];
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  };
  return { client: new BotArmorClient("ba_live_test", "https://api.test/api/v1", fetchImpl), calls };
}

test("prompt mode sends the system prompt with no target URL and never needs authorization", async () => {
  const { client, calls } = fakeApi({ "POST /audits": () => [202, { success: true, audit_code: "BA-AAAA1111", mode: "simulated" }] });
  const text = await startAudit(client, { system_prompt: "You are the assistant of a dental clinic." });
  assert.match(text, /BA-AAAA1111/);
  assert.match(text, /simulated/);
  assert.deepEqual(calls[0].body.target, { type: "prompt", name: "Agent tested from MCP" });
  assert.equal(calls[0].headers.authorization, "Bearer ba_live_test");
});

test("localhost is refused with a way out (prompt mode or tunnel), before any API call", async () => {
  const { client, calls } = fakeApi({});
  await assert.rejects(
    startAudit(client, { system_prompt: "x", endpoint_url: "http://localhost:3000/chat", authorization_confirmed: true }),
    (err) => err instanceof BotArmorError && /prompt/.test(err.message) && /tunnel/.test(err.message),
  );
  assert.equal(calls.length, 0);
});

test("a live audit needs authorization_confirmed", async () => {
  const { client } = fakeApi({});
  await assert.rejects(startAudit(client, { system_prompt: "x", endpoint_url: "https://bot.example.com/chat" }), /authorization_confirmed/);
});

test("openai-compatible: registers the bot with {{messages}}, the key encrypted, then starts a live audit", async () => {
  const { client, calls } = fakeApi({
    "GET /agents": () => [200, { agents: [] }],
    "POST /agents": () => [201, { success: true, agent: { id: "11111111-2222-3333-4444-555555555555" } }],
    "POST /audits": () => [202, { success: true, audit_code: "BA-BBBB2222", mode: "live" }],
  });
  const text = await startAudit(client, {
    target_type: "openai-compatible",
    system_prompt: "rules",
    endpoint_url: "https://bot.example.com/v1/chat/completions",
    headers: { Authorization: "Bearer sk-target", "X-Tenant": "acme" },
    model: "gpt-x",
    authorization_confirmed: true,
  });
  assert.match(text, /BA-BBBB2222 started \(live\)/);
  const agent = calls.find((c) => c.key === "POST /agents").body;
  assert.equal(agent.api_key, "Bearer sk-target");
  assert.deepEqual(agent.config.auth, { header: "Authorization", prefix: "" });
  assert.deepEqual(agent.config.headers, { "X-Tenant": "acme" });
  assert.deepEqual(agent.config.body_template, { model: "gpt-x", messages: "{{messages}}" });
  assert.equal(agent.config.response_path, "choices.0.message.content");
  const audit = calls.find((c) => c.key === "POST /audits").body;
  assert.deepEqual(audit.target, { type: "webhook", agent_id: "11111111-2222-3333-4444-555555555555" });
  assert.equal(audit.authorization_confirmed, true);
});

test("an already registered URL is reused, not registered twice", async () => {
  const { client, calls } = fakeApi({
    "GET /agents": () => [200, { agents: [{ id: "a-1", endpoint_url: "https://bot.example.com/chat", platform: "webhook" }] }],
    "POST /audits": () => [202, { success: true, audit_code: "BA-CCCC3333", mode: "live" }],
  });
  await startAudit(client, { system_prompt: "x", endpoint_url: "https://bot.example.com/chat", authorization_confirmed: true });
  assert.equal(calls.some((c) => c.key === "POST /agents"), false);
  assert.equal(calls.find((c) => c.key === "POST /audits").body.target.agent_id, "a-1");
});

test("API errors become plain messages: bad key, no credit", async () => {
  const bad = fakeApi({ "POST /audits": () => [401, { error: "Invalid API key" }] });
  await assert.rejects(startAudit(bad.client, { system_prompt: "x" }), /BOTARMOR_API_KEY/);
  const broke = fakeApi({ "POST /audits": () => [402, { error: "No audit credit left" }] });
  await assert.rejects(startAudit(broke.client, { system_prompt: "x" }), /No audit credit left/);
});

test("a missing key is a readable error, not a crash", () => {
  assert.throws(() => new BotArmorClient(""), /BOTARMOR_API_KEY is not set/);
});

test("status shows progress, and a dead target is explained", async () => {
  const running = fakeApi({ "GET /audits/BA-AAAA1111/status": () => [200, { audit_code: "BA-AAAA1111", status: "running", mode: "live", progress: { levels_done: 4, levels_total: 12 } }] });
  assert.match(await getAuditStatus(running.client, "BA-AAAA1111"), /4\/12 levels/);
  const failed = fakeApi({ "GET /audits/BA-AAAA1111/status": () => [200, { audit_code: "BA-AAAA1111", status: "failed", mode: "live", error: "Agent unreachable: connect ECONNREFUSED" }] });
  assert.match(await getAuditStatus(failed.client, "BA-AAAA1111"), /did not answer/);
});

test("the report lists failed levels worst first, with the verdict and the patch to paste", async () => {
  const audit = {
    audit_code: "BA-DDDD4444",
    status: "completed",
    report: {
      report: {
        audit_code: "BA-DDDD4444",
        grade: "D",
        scores: { overall: 50 },
        agent_name: "Ines",
        verify_url: "https://app.botarmor.eu/verify/BA-DDDD4444",
        severity_counts: { critical: 0, high: 2 },
        checks: [
          { id: "LVL02_TOXIC", label: "Client furieux", score: 92, passed: true, severity: "none", trials: { n: 5, breaks: 0 } },
          { id: "LVL12_FACTS", label: "Faits inventés", score: 55, passed: false, severity: "high", trials: { n: 5, breaks: 4 }, frameworks: ["LLM09"] },
        ],
      },
    },
    events: [{ event_type: "level_summary", payload: { level: "facts", verdict: "Invented a 28 € price.", patch: "Only quote prices from these instructions." } }],
  };
  const { client } = fakeApi({ "GET /audits/BA-DDDD4444": () => [200, { success: true, audit }] });
  const md = await getAuditReport(client, "BA-DDDD4444");
  assert.match(md, /grade D \(50\/100\)/);
  assert.ok(md.indexOf("Faits inventés") < md.indexOf("Client furieux"), "worst level first");
  assert.match(md, /Invented a 28 € price/);
  assert.match(md, /Only quote prices from these instructions/);
});

test("list_audits is a table, newest first as the API returns it", async () => {
  const { client, calls } = fakeApi({ "GET /audits": () => [200, { audits: [{ audit_code: "BA-EEEE5555", agent_name: "Bot", status: "completed", grade: "B", overall_score: 81, started_at: "2026-10-26T10:00:00Z" }] }] });
  const md = await listAudits(client, 5);
  assert.match(md, /BA-EEEE5555 \| Bot \| completed \| B \| 81/);
  assert.equal(calls[0].search, "?limit=5");
});

test("splitHeaders keeps one credential header apart", () => {
  assert.deepEqual(splitHeaders({ "x-api-key": "k", Accept: "a" }), { plain: { Accept: "a" }, secret: { header: "x-api-key", value: "k" } });
});

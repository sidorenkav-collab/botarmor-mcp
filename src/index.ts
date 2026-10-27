#!/usr/bin/env node
// BotArmor MCP server (stdio). Install in Claude Code:
//   claude mcp add botarmor -e BOTARMOR_API_KEY=ba_live_... -- npx -y @botarmor/mcp
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BotArmorClient, BotArmorError, DEFAULT_BASE_URL } from "./api.js";
import { LEVELS, startAudit, getAuditStatus, getAuditReport, listAudits } from "./tools.js";

const VERSION = "0.1.1";
const server = new McpServer({ name: "botarmor", version: VERSION });

// The client is created on first use, so a missing key becomes a readable tool error instead of a crash at start.
let client: BotArmorClient | null = null;
const api = () => (client ??= new BotArmorClient(process.env.BOTARMOR_API_KEY ?? "", process.env.BOTARMOR_API_URL || DEFAULT_BASE_URL));

async function run(fn: () => Promise<string>) {
  try {
    return { content: [{ type: "text" as const, text: await fn() }] };
  } catch (err) {
    const message = err instanceof BotArmorError ? err.message : `Unexpected error: ${(err as Error).message}`;
    return { content: [{ type: "text" as const, text: message }], isError: true };
  }
}

const CODE = z.string().regex(/^BA-[0-9A-Z]{8}$/).describe("Audit id, e.g. BA-7NRZ26D4");

server.registerTool(
  "start_audit",
  {
    title: "Start a BotArmor audit",
    description:
      "Crash-test a chatbot or AI agent with BotArmor: up to 12 attack levels (fake manager, angry customer, fake lawyer, prompt injection, role-play, phishing, AI disclosure under the EU AI Act, invented facts...) plus level 13 for agents with tools, 5 adaptive sessions each. " +
      "Two modes. target_type 'prompt' (default when no endpoint_url): BotArmor plays the agent's system prompt on its own model; use it for an agent running on localhost or not deployed yet, reading the system prompt from the code. " +
      "target_type 'openai-compatible' or 'webhook': a live audit of a running bot at a public https URL; requires authorization_confirmed: true, only after the user confirmed they own the bot or have written permission. " +
      "Returns the audit id; an audit takes 5 to 20 minutes, then use get_audit_status and get_audit_report. Uses one audit credit.",
    inputSchema: {
      system_prompt: z.string().min(1).max(8000).describe("The agent's system prompt / instructions, as in its code. For a live audit it is also the rulebook the judge checks answers against."),
      target_type: z.enum(["prompt", "openai-compatible", "webhook"]).optional().describe("Default: 'webhook' when endpoint_url is given, else 'prompt'."),
      endpoint_url: z.string().optional().describe("Public https URL of the running agent (live audits only). localhost cannot be reached from BotArmor's servers."),
      headers: z.record(z.string(), z.string()).optional().describe("Headers the target needs, e.g. {\"Authorization\": \"Bearer ...\"}. A credential header is stored encrypted by BotArmor."),
      model: z.string().optional().describe("openai-compatible only: the model name sent in the request body."),
      body_template: z.unknown().optional().describe("webhook only: JSON body with {{input}} (current message), \"{{history}}\" or \"{{messages}}\". Default {message: \"{{input}}\", session_id: \"{{session_id}}\"}."),
      response_path: z.string().optional().describe("webhook only: dot path to the reply text in the response JSON, e.g. data.reply."),
      levels: z.array(z.enum(LEVELS)).optional().describe("Subset of levels; default all 12 (plus 'agency' when tools are declared)."),
      name: z.string().max(120).optional().describe("Name shown in the report."),
      lang: z.enum(["fr", "en", "de", "es", "ru"]).optional().describe("Report language, default en."),
      min_grade: z.enum(["A", "B", "C", "D", "F"]).optional().describe("Pass threshold shown by get_audit_status, default B."),
      authorization_confirmed: z.boolean().optional().describe("Live audits only. true = the user confirmed they own the bot or hold the owner's written permission to test it."),
    },
    annotations: { destructiveHint: false, openWorldHint: true },
  },
  async (input) => run(() => startAudit(api(), input as any)),
);

server.registerTool(
  "get_audit_status",
  {
    title: "BotArmor audit status",
    description: "Status and progress of a BotArmor audit (levels done out of total), and the grade once completed.",
    inputSchema: { audit_id: CODE },
    annotations: { readOnlyHint: true },
  },
  async ({ audit_id }) => run(() => getAuditStatus(api(), audit_id)),
);

server.registerTool(
  "get_audit_report",
  {
    title: "BotArmor audit report",
    description:
      "Findings of a completed BotArmor audit: grade, a table of levels with severity and breaks, and for every failed level what happened and the exact text to add to the agent's system prompt. Use it to propose the fix in the agent's code, then re-run start_audit to check.",
    inputSchema: { audit_id: CODE },
    annotations: { readOnlyHint: true },
  },
  async ({ audit_id }) => run(() => getAuditReport(api(), audit_id)),
);

server.registerTool(
  "list_audits",
  {
    title: "List BotArmor audits",
    description: "The user's latest BotArmor audits, newest first, with status, grade and score.",
    inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("How many, default 10.") },
    annotations: { readOnlyHint: true },
  },
  async ({ limit }) => run(() => listAudits(api(), limit ?? 10)),
);

await server.connect(new StdioServerTransport());

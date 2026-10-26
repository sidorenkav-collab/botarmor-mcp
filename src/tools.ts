// The four tools, as plain functions over BotArmorClient so they can be tested without an MCP transport.
// Outputs are Markdown written for a model: what broke, how badly, and the exact text to paste into the agent's
// instructions, so the assistant can propose the fix in the user's code right away.
import { BotArmorClient, BotArmorError } from "./api.js";

export const LEVELS = ["logic", "toxic", "hacker", "lawyer", "multilang", "loop", "roleplay", "phishing", "ethics", "burst", "disclosure", "facts", "agency"] as const;
export type Level = (typeof LEVELS)[number];

export interface StartAuditInput {
  target_type?: "prompt" | "openai-compatible" | "webhook";
  system_prompt: string;
  endpoint_url?: string;
  name?: string;
  headers?: Record<string, string>;
  model?: string;
  body_template?: unknown;
  response_path?: string;
  levels?: Level[];
  lang?: "fr" | "en" | "de" | "es" | "ru";
  min_grade?: "A" | "B" | "C" | "D" | "F";
  authorization_confirmed?: boolean;
}

// Addresses our cloud cannot reach (and the API refuses on purpose: SSRF protection).
const LOCAL_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|127(\.\d+){3}|0\.0\.0\.0|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|\[?::1\]?|host\.docker\.internal)$/i;

// One header can be stored encrypted as the agent's key: the one that looks like a credential.
const SECRET_HEADER = /^(authorization|x-api-key|api-key|apikey|x-auth-token|x-access-token)$/i;

export function splitHeaders(headers: Record<string, string> = {}) {
  const plain: Record<string, string> = {};
  let secret: { header: string; value: string } | null = null;
  for (const [k, v] of Object.entries(headers)) {
    if (!secret && SECRET_HEADER.test(k)) secret = { header: k, value: String(v) };
    else plain[k] = String(v);
  }
  return { plain, secret };
}

export async function startAudit(client: BotArmorClient, input: StartAuditInput): Promise<string> {
  const type = input.target_type ?? (input.endpoint_url ? "webhook" : "prompt");
  const common = {
    system_prompt: input.system_prompt,
    ...(input.levels?.length ? { levels: input.levels } : {}),
    lang: input.lang ?? "en",
    ...(input.min_grade ? { min_grade: input.min_grade } : {}),
  };

  if (type === "prompt") {
    const started = await client.startAudit({ ...common, target: { type: "prompt", name: input.name || "Agent tested from MCP" } });
    return started_text(started, "simulated");
  }

  if (!input.endpoint_url) throw new BotArmorError("endpoint_url is required for a live audit (target_type webhook or openai-compatible).");
  let url: URL;
  try {
    url = new URL(input.endpoint_url);
  } catch {
    throw new BotArmorError(`endpoint_url is not a valid URL: ${input.endpoint_url}`);
  }
  if (LOCAL_HOST.test(url.hostname)) {
    throw new BotArmorError(
      `${url.host} is only reachable from this machine, so BotArmor's servers cannot attack it. Either run a prompt-only audit (target_type "prompt" with the agent's system prompt from the code: no network needed), or expose the agent through a public https tunnel (e.g. "cloudflared tunnel --url ${url.origin}" or ngrok) and audit that URL.`,
    );
  }
  if (url.protocol !== "https:") throw new BotArmorError("endpoint_url must use https.");
  if (input.authorization_confirmed !== true) {
    throw new BotArmorError("A live audit attacks a running bot. Set authorization_confirmed: true only after the user confirms they own this bot or hold the owner's written permission to test it.");
  }

  const agentId = await ensureAgent(client, input, type, url.toString());
  const started = await client.startAudit({ ...common, target: { type: "webhook", agent_id: agentId }, authorization_confirmed: true });
  return started_text(started, "live");
}

async function ensureAgent(client: BotArmorClient, input: StartAuditInput, type: string, endpoint: string): Promise<string> {
  // Reuse the bot already registered for this URL (its stored key and settings stay as they were).
  const { agents = [] } = await client.listAgents();
  const existing = agents.find((a) => a.endpoint_url === endpoint && a.platform === "webhook");
  if (existing) return existing.id;

  const { plain, secret } = splitHeaders(input.headers);
  const config: Record<string, unknown> = { headers: plain };
  if (secret) config.auth = { header: secret.header, prefix: "" };
  if (type === "openai-compatible") {
    config.body_template = { model: input.model || "default", messages: "{{messages}}" };
    config.response_path = "choices.0.message.content";
  } else {
    if (input.body_template !== undefined) config.body_template = input.body_template;
    if (input.response_path) config.response_path = input.response_path;
  }
  const created = await client.createAgent({
    name: input.name || `${new URL(endpoint).host} (MCP)`,
    endpoint_url: endpoint,
    ...(secret ? { api_key: secret.value } : {}),
    config,
  });
  const id = created.agent?.id ?? created.id;
  if (!id) throw new BotArmorError("BotArmor did not return the new agent's id.");
  return id;
}

function started_text(started: any, mode: string): string {
  return [
    `Audit ${started.audit_code} started (${started.mode ?? mode}).`,
    started.idempotent_replay ? "This is the same audit as an earlier identical request." : "",
    "A full audit takes about 5 to 20 minutes. Poll get_audit_status with this id, then call get_audit_report.",
    started.mode === "simulated" || mode === "simulated"
      ? "Mode simulated: BotArmor played the system prompt on its own model. It is an estimate; a live audit of the running bot is the reliable verdict."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getAuditStatus(client: BotArmorClient, code: string): Promise<string> {
  const s: any = await client.status(code);
  const p = s.progress;
  const lines = [
    `Audit ${s.audit_code}: ${s.status} (${s.mode}).`,
    p?.levels_total ? `Progress: ${p.levels_done}/${p.levels_total} levels.` : "",
    s.status === "completed" ? `Grade ${s.grade} (${s.overall_score}/100). Gate ${s.gate?.min_grade}: ${s.gate?.passed ? "passed" : "failed"}.` : "",
    s.status === "failed" ? `Failed: ${s.error}${/unreachable|HTTP \d|timed? ?out|ECONN/i.test(s.error ?? "") ? " (the target bot did not answer: check its URL, headers and that it is online)" : ""}` : "",
    s.status === "running" ? "Still running: check again in a minute or two." : "",
    s.status === "completed" ? "Call get_audit_report for the findings and fixes." : "",
  ];
  return lines.filter(Boolean).join("\n");
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "none"];

export function formatReport(audit: any): string {
  if (audit.status === "running") return `Audit ${audit.audit_code} is still running. Poll get_audit_status first.`;
  if (audit.status === "failed") return `Audit ${audit.audit_code} failed: ${audit.error}`;
  const report = audit.report?.report;
  if (!report) return `Audit ${audit.audit_code} has no report yet.`;

  // Verdict and patch per level come from the level summaries in the event log.
  const summaries = new Map<string, any>();
  for (const e of audit.events ?? []) if (e.event_type === "level_summary") summaries.set(e.payload?.level, e.payload);

  const checks: any[] = (report.checks ?? []).filter((c: any) => c.trials || c.severity);
  checks.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity ?? "none") - SEVERITY_ORDER.indexOf(b.severity ?? "none"));
  const failed = checks.filter((c) => c.passed === false);

  const out: string[] = [];
  out.push(`# BotArmor audit ${report.audit_code}: grade ${report.grade} (${report.scores?.overall ?? audit.overall_score}/100)`);
  out.push(`Agent: ${report.agent_name ?? audit.agent_name}. Signed report, public verification: ${report.verify_url}`);
  if (report.severity_counts) out.push(`Severity counts: ${Object.entries(report.severity_counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
  out.push("");
  out.push("| Level | Severity | Breaks | Score | Passed |");
  out.push("|---|---|---|---|---|");
  for (const c of checks) out.push(`| ${c.label ?? c.id} | ${c.severity ?? "none"} | ${c.trials ? `${c.trials.breaks}/${c.trials.n}` : "-"} | ${c.score ?? "-"} | ${c.passed ? "yes" : "no"} |`);
  out.push("");
  if (!failed.length) {
    out.push("No level broke. Nothing to fix; re-run after the next change to the agent's instructions.");
  } else {
    out.push(`## What to fix (${failed.length} level${failed.length > 1 ? "s" : ""})`);
    out.push("Each fix below is text to add to the agent's system prompt (instructions file), in the bot's language. Apply it where the prompt is defined in the code, then re-run the audit.");
    for (const c of failed) {
      const level = String(c.id ?? "").replace(/^LVL\d+_/, "").toLowerCase();
      const s = summaries.get(level) ?? [...summaries.values()].find((v) => String(c.id).toLowerCase().includes(String(v.level)));
      out.push("");
      out.push(`### ${c.label ?? c.id} — ${c.severity}${c.frameworks?.length ? ` (${c.frameworks.join(", ")})` : ""}`);
      if (s?.verdict) out.push(`What happened: ${s.verdict}`);
      if (s?.patch) out.push("Fix to paste into the system prompt:", "```", s.patch, "```");
    }
  }
  if (report.disclaimer) out.push("", `_${report.disclaimer}_`);
  return out.join("\n");
}

export async function getAuditReport(client: BotArmorClient, code: string): Promise<string> {
  const { audit } = await client.audit(code);
  return formatReport({ ...audit, audit_code: audit.audit_code ?? code });
}

export async function listAudits(client: BotArmorClient, limit = 10): Promise<string> {
  const { audits = [] } = await client.listAudits(Math.min(Math.max(limit, 1), 50));
  if (!audits.length) return "No audits yet on this BotArmor account.";
  return [
    "| Audit | Agent | Status | Grade | Score | Started |",
    "|---|---|---|---|---|---|",
    ...audits.map((a: any) => `| ${a.audit_code} | ${a.agent_name ?? "-"} | ${a.status}${a.retest_of ? ` (retest of ${a.retest_of})` : ""} | ${a.grade ?? "-"} | ${a.overall_score ?? "-"} | ${String(a.started_at ?? "").slice(0, 16).replace("T", " ")} |`),
  ].join("\n");
}

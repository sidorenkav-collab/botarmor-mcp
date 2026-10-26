// Thin client for the BotArmor API v1 (the same API the Make app and the n8n node use).
// The API key comes from the environment and is never logged or echoed back to the model.

export const DEFAULT_BASE_URL = "https://app.botarmor.eu/api/v1";

export class BotArmorError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Fetch = typeof fetch;

// Plain-language messages for the errors a user can act on.
function explain(status: number, apiMessage: string): string {
  switch (status) {
    case 401:
      return "BotArmor rejected the API key. Check BOTARMOR_API_KEY (it starts with ba_live_; create one in the BotArmor dashboard, tab API).";
    case 402:
      return `No audit credit left on this BotArmor account (${apiMessage}). Buy a pack or upgrade the plan in the dashboard.`;
    case 403:
      return `BotArmor refused the audit: ${apiMessage}. A live audit needs authorization_confirmed: true, which means the user owns the bot or holds the owner's written permission.`;
    case 404:
      return `Not found: ${apiMessage}.`;
    case 409:
      return `${apiMessage}. Wait for the running audit to finish (get_audit_status) before starting another one.`;
    case 429:
      return `BotArmor rate limit reached (${apiMessage}). Retry in a minute.`;
    case 503:
      return `BotArmor is temporarily unavailable: ${apiMessage}.`;
    default:
      return `BotArmor API error ${status}: ${apiMessage}`;
  }
}

export class BotArmorClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    private readonly fetchImpl: Fetch = fetch,
  ) {
    if (!apiKey) throw new BotArmorError("BOTARMOR_API_KEY is not set. Add it to the MCP server's environment (claude mcp add botarmor -e BOTARMOR_API_KEY=ba_live_... -- npx -y @botarmor/mcp).");
  }

  async request<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new BotArmorError(`Cannot reach the BotArmor API at ${this.baseUrl}: ${(err as Error).message}`);
    }
    const text = await res.text();
    let data: any;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 200) };
    }
    // 412 = completed below the threshold in strict mode; the body is still the status.
    if (!res.ok && res.status !== 412) throw new BotArmorError(explain(res.status, data?.error || res.statusText), res.status);
    return data as T;
  }

  listAgents() {
    return this.request<{ agents: Array<{ id: string; name: string; endpoint_url: string; platform: string }> }>("GET", "/agents");
  }
  createAgent(body: unknown) {
    return this.request<{ agent: { id: string } } & { id?: string }>("POST", "/agents", body);
  }
  startAudit(body: unknown, idempotencyKey?: string) {
    return this.request("POST", "/audits", body, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
  }
  status(code: string) {
    return this.request("GET", `/audits/${encodeURIComponent(code)}/status`);
  }
  audit(code: string) {
    return this.request("GET", `/audits/${encodeURIComponent(code)}`);
  }
  listAudits(limit: number) {
    return this.request("GET", `/audits?limit=${limit}`);
  }
}

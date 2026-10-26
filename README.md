# BotArmor MCP server

Crash-test your chatbot or AI agent from Claude Code, Cursor or any MCP client. You ask the assistant to "test my agent with BotArmor". BotArmor attacks the agent on up to 12 levels:

- fake manager;
- angry customer;
- fake lawyer;
- prompt injection;
- role-play;
- phishing;
- AI disclosure under the EU AI Act;
- invented facts;
- and more.

Level 13 is added for agents with tools. When the audit is done, the assistant gets a report it can act on: what broke, how badly, and the exact text to add to the agent's instructions. It can then edit your code and run the audit again.

It is a thin wrapper over the [BotArmor API](https://app.botarmor.eu/api/v1/openapi.yaml), the same one the Make app and the n8n node use.

## Install

Create an API key in the [BotArmor dashboard](https://app.botarmor.eu/app/), tab **API**. It starts with `ba_live_`. Then:

```bash
claude mcp add botarmor -e BOTARMOR_API_KEY=ba_live_xxx -- npx -y @botarmor/mcp
```

Other MCP clients (Cursor, Claude Desktop, Windsurf) use this config:

```json
{
  "mcpServers": {
    "botarmor": {
      "command": "npx",
      "args": ["-y", "@botarmor/mcp"],
      "env": { "BOTARMOR_API_KEY": "ba_live_xxx" }
    }
  }
}
```

Keep the key out of your repository. With Claude Code, add it at user scope (`--scope user`) rather than in a committed `.mcp.json`.

## What to ask

- "Check my agent on localhost:3000 with BotArmor." The assistant reads the system prompt from your code and runs a **prompt audit**. BotArmor's servers cannot reach your localhost, so they play your prompt on their own model.
- "Audit our staging bot at https://staging.example.com/v1/chat/completions with BotArmor, it's OpenAI-compatible, here is the token." This is a **live audit** of the running bot. The assistant asks you to confirm you own it.
- "Is the BotArmor audit done? Show me the report and fix the prompt."
- "List my last BotArmor audits."

## Tools

| Tool | What it does |
|---|---|
| `start_audit` | Starts an audit and returns its id (`BA-XXXXXXXX`). It takes 5–20 minutes and uses one audit credit. |
| `get_audit_status` | Status, progress (levels done out of total), and the grade once completed. |
| `get_audit_report` | Grade, a table of levels with severity, and for each failed level what happened plus the text to paste into the system prompt. |
| `list_audits` | Your latest audits. |

`start_audit` parameters:

- `system_prompt` (required): the agent's instructions, as in your code. For a live audit it is also the rulebook the judge checks answers against.
- `target_type`, one of:
  - `prompt`: the default when no URL is given, no network needed;
  - `openai-compatible`: a chat-completions endpoint;
  - `webhook`: any JSON endpoint.
- `endpoint_url`: a public https URL (live audits).
- `headers`: what the target needs. A credential header (`Authorization`, `X-API-Key`…) is stored encrypted by BotArmor and never returned.
- `model`: for `openai-compatible`, the model name sent in the body.
- `body_template` and `response_path`: for `webhook`. The body uses `{{input}}`, `"{{history}}"` or `"{{messages}}"`; the path points to the reply, e.g. `data.reply`.
- `levels`: a subset of `logic, toxic, hacker, lawyer, multilang, loop, roleplay, phishing, ethics, burst, disclosure, facts, agency`. Default: all.
- `lang`: the report language (`fr`, `en`, `de`, `es`, `ru`).
- `min_grade`: the pass threshold.
- `authorization_confirmed`: must be `true` for a live audit. Set it only when you own the bot or hold the owner's written permission. BotArmor never tests third-party bots.

## Errors you may see

- **"BotArmor rejected the API key"**: check `BOTARMOR_API_KEY`.
- **"No audit credit left"**: buy a pack or upgrade in the dashboard.
- **"... is only reachable from this machine"**: use `target_type: "prompt"`, or a public tunnel such as `cloudflared tunnel --url http://localhost:3000`.
- **"the target bot did not answer"**: the live bot was down, or its URL or headers are wrong.
- **"An audit is already running"**: one audit at a time per account.

## Develop

```bash
npm install
npm test          # builds, then runs unit tests and an end-to-end stdio test against a mock API
```

`BOTARMOR_API_URL` points the server at another API base (default `https://app.botarmor.eu/api/v1`).

MIT licence. BotArmor AI is a brand of Rhone IA (Andrii Sydorenko EI), France. Reports are point-in-time test attestations, not certifications.

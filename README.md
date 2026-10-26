# BotArmor MCP server

Crash-test your chatbot or AI agent from your AI assistant: Claude Code, Claude Desktop, ChatGPT, OpenAI Codex, Gemini CLI, Cursor, VS Code (Copilot) or Windsurf. Ask "test my agent with BotArmor" and BotArmor attacks the agent on up to 12 levels:

- fake manager;
- angry customer;
- fake lawyer;
- prompt injection;
- role-play;
- phishing;
- AI disclosure under the EU AI Act;
- invented facts;
- and more.

Level 13 is added for agents with tools. The assistant gets back a report written for it: what broke, how badly, and the exact text to add to the agent's instructions. It can then edit your code and run the audit again.

It is a thin wrapper over the [BotArmor API](https://app.botarmor.eu/api/v1/openapi.yaml), the same one the Make app, the n8n node and the GitHub Action use.

## How it works

1. **You ask your assistant.** For example: "Check the support agent in this repo with BotArmor."
2. **The assistant calls `start_audit`.** It passes the agent's system prompt, which it reads from your code.
   - **Prompt mode** (default): BotArmor plays that prompt on its own model. Use it for an agent on localhost or not deployed yet.
   - **Live mode**: BotArmor talks to your running bot at a public https URL. The assistant must first ask you to confirm you own the bot.
3. **BotArmor attacks.** For each level it runs 5 adaptive sessions. A judge model rules on each session, and a jury of three models confirms every break. An audit takes 5–20 minutes and uses one credit.
4. **The assistant polls `get_audit_status`.** It shows progress: levels done out of total.
5. **It reads `get_audit_report`.** The report gives the grade A–F, a table of levels with severity, and for each failed level what happened plus a ready-to-paste fix for the system prompt.
6. **It proposes the fix in your code.** With your OK it applies the fix, then runs `start_audit` again to check that the level now holds.

Your API key stays in your MCP client's configuration. The assistant never receives it. Prompts are not stored by BotArmor, only a SHA-256 fingerprint.

## Get an API key

Create a key in the [BotArmor dashboard](https://app.botarmor.eu/app/), tab **API**. It starts with `ba_live_`. In the examples below, replace `ba_live_xxx` with it. Keep the key out of your repository: use user-level configuration, or an environment variable.

## Connect your assistant

### Claude Code

```bash
claude mcp add botarmor --scope user -e BOTARMOR_API_KEY=ba_live_xxx -- npx -y @botarmor/mcp
```

Check with `claude mcp list`, or `/mcp` inside a session.

### Claude Desktop

Menu **Settings → Developer → Edit Config** opens `claude_desktop_config.json`:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Add the server, then fully quit and reopen Claude Desktop:

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

### ChatGPT (web) and claude.ai: remote server, no install

Hosts that only connect to servers on the internet use BotArmor's hosted endpoint:

```
https://app.botarmor.eu/mcp
```

1. Add it as a custom MCP server or connector in your host. In ChatGPT this is the apps and connectors settings with developer mode. In claude.ai it is **Settings → Connectors → Add custom connector**. Menu names change often; look for "MCP server" or "custom connector".
2. The host opens a BotArmor page. Paste your API key there and click **Connect**.
3. The host receives its own token (OAuth 2.1 with PKCE). It never sees your API key.
4. To disconnect, remove the connector, or revoke the API key in the BotArmor dashboard.

The tools are the same four.

### ChatGPT desktop app and OpenAI Codex (CLI and IDE)

They share one configuration. Use either the command line:

```bash
codex mcp add botarmor --env BOTARMOR_API_KEY=ba_live_xxx -- npx -y @botarmor/mcp
```

or `~/.codex/config.toml`:

```toml
[mcp_servers.botarmor]
command = "npx"
args = ["-y", "@botarmor/mcp"]
env = { BOTARMOR_API_KEY = "ba_live_xxx" }
```

In the ChatGPT desktop app you can also add it under **Settings → MCP servers → STDIO**, with command `npx`, arguments `-y @botarmor/mcp` and the env variable.

### Gemini CLI

```bash
gemini mcp add -s user -e BOTARMOR_API_KEY=ba_live_xxx botarmor npx -y @botarmor/mcp
```

or `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "botarmor": {
      "command": "npx",
      "args": ["-y", "@botarmor/mcp"],
      "env": { "BOTARMOR_API_KEY": "$BOTARMOR_API_KEY" }
    }
  }
}
```

`$BOTARMOR_API_KEY` is read from your shell environment, so the key is not written in the file. Check with `/mcp` in a session.

### Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project):

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

### VS Code (GitHub Copilot agent mode)

Run **MCP: Open User Configuration** from the Command Palette and add the server. VS Code asks for the key once and stores it securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "botarmor-key", "description": "BotArmor API key (ba_live_...)", "password": true }
  ],
  "servers": {
    "botarmor": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@botarmor/mcp"],
      "env": { "BOTARMOR_API_KEY": "${input:botarmor-key}" }
    }
  }
}
```

Note that VS Code uses `servers`, not `mcpServers`.

### Windsurf and other MCP clients

Any client that runs local MCP servers (stdio) works with the same three values:

- command: `npx`
- args: `-y @botarmor/mcp`
- env: `BOTARMOR_API_KEY`

In Windsurf, use the `mcpServers` block as for Cursor, in `~/.codeium/windsurf/mcp_config.json`.

## What to ask

- "Check my agent on localhost:3000 with BotArmor." This runs a **prompt audit** from the system prompt in your code, because BotArmor's servers cannot reach your localhost.
- "Audit our staging bot at https://staging.example.com/v1/chat/completions with BotArmor, it's OpenAI-compatible, the token is in .env." This runs a **live audit**; the assistant asks you to confirm you own the bot.
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

- `system_prompt` (required): the agent's instructions. For a live audit it is also the rulebook the judge checks answers against.
- `target_type`, one of:
  - `prompt`: the default when no URL is given;
  - `openai-compatible`: a chat-completions endpoint;
  - `webhook`: any JSON endpoint.
- `endpoint_url`: a public https URL, for live audits.
- `headers`: what the target needs. A credential header (`Authorization`, `X-API-Key`…) is stored encrypted by BotArmor and never returned.
- `model`: for `openai-compatible`, the model name sent in the body.
- `body_template` and `response_path`: for `webhook`. The body uses `{{input}}`, `"{{history}}"` or `"{{messages}}"`; the path points to the reply, e.g. `data.reply`.
- `levels`: a subset of `logic, toxic, hacker, lawyer, multilang, loop, roleplay, phishing, ethics, burst, disclosure, facts, agency`.
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

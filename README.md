# Pocket CEP

An educational companion app for the [Chrome Enterprise Premium MCP server](https://github.com/google/chrome-enterprise-premium-mcp). Pocket CEP demonstrates how to build a web application that connects to an MCP server using OAuth, calls tools, and integrates an AI-powered chat agent that can investigate Chrome Enterprise user issues.

Built with Next.js 16, BetterAuth, Tailwind CSS 4, and the official MCP SDK.

## What It Does

Pocket CEP gives Google Workspace administrators a chat interface to investigate Chrome Enterprise user problems. Select a user from a dropdown (populated from real Chrome activity logs), ask a question, and watch the AI agent call MCP tools to find answers.

The app is deliberately educational. An **MCP Inspector** panel shows every JSON-RPC request and response exchanged with the MCP server, so developers can see exactly how the Model Context Protocol works under the hood.

### Features

- **User investigation** - Select a user from a dropdown populated by the Chrome activity log, then ask the AI agent about their issues
- **Dual LLM support** - Choose between Claude (Anthropic) or Gemini (Google) as the chat agent, using their official SDKs
- **Two auth modes** - Run with ADC for simple demos, or forward the user's own Google OAuth token for full admin access
- **MCP auto-start** - Optionally spawn the MCP server as a child process so you only need one terminal
- **MCP Inspector** - A collapsible panel showing raw JSON-RPC protocol traffic for every tool call
- **Environment diagnostics** - A `doctor` command that validates your entire setup before you run the app

## Prerequisites

- **Node.js** 18 or later
- **Google Cloud project** with OAuth 2.0 credentials configured
- **LLM API key** for either Anthropic (Claude) or Google AI (Gemini)
- **Google Cloud CLI** (`gcloud`) for `service_account` mode ADC setup

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create your secrets file
cp .env.local.example .env.local
# Edit .env.local and fill in your credentials (see Configuration below)

# 3. Set up ADC for service_account mode (sign in as a Workspace admin)
gcloud auth application-default login \
  --scopes="https://www.googleapis.com/auth/chrome.management.policy,https://www.googleapis.com/auth/chrome.management.reports.readonly,https://www.googleapis.com/auth/chrome.management.profiles.readonly,https://www.googleapis.com/auth/admin.reports.audit.readonly,https://www.googleapis.com/auth/admin.directory.orgunit.readonly,https://www.googleapis.com/auth/admin.directory.customer.readonly,https://www.googleapis.com/auth/cloud-identity.policies,https://www.googleapis.com/auth/apps.licensing,https://www.googleapis.com/auth/cloud-platform"

gcloud auth application-default set-quota-project YOUR_PROJECT_ID

# 4. Check your environment
npm run doctor

# 5. Start everything (auto-starts the MCP server)
MCP_SERVER_CMD="npx @google/chrome-enterprise-premium-mcp@latest" npm run dev
```

Open http://localhost:3000 and sign in with Google.

## Configuration

Configuration is split across two files:

| File | Committed? | Purpose |
|------|-----------|---------|
| `.env` | Yes | Non-secret defaults with documentation |
| `.env.local` | No (gitignored) | Secrets: API keys, OAuth credentials |

### Required Secrets (`.env.local`)

```bash
# Generate a session signing secret
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# Google OAuth credentials
# Create at: https://console.cloud.google.com/apis/credentials
# Type: OAuth 2.0 Client ID (Web application)
# Redirect URI: http://localhost:3000/api/auth/callback/google
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret

# LLM API key (only the one matching LLM_PROVIDER is needed)
ANTHROPIC_API_KEY=sk-ant-...    # https://console.anthropic.com/
GOOGLE_AI_API_KEY=...           # https://aistudio.google.com/apikey
```

### Configuration Options (`.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_MODE` | `service_account` | How MCP calls are authenticated. See [Auth Modes](#auth-modes). |
| `MCP_SERVER_URL` | `http://localhost:4000/mcp` | URL of the CEP MCP server's HTTP endpoint |
| `MCP_SERVER_CMD` | *(empty)* | If set, auto-starts the MCP server. See [Auto-Starting the MCP Server](#auto-starting-the-mcp-server). |
| `LLM_PROVIDER` | `claude` | Which LLM powers the chat agent: `claude` or `gemini` |
| `LLM_MODEL` | *(auto)* | Override the model ID. Defaults: `claude-sonnet-4-20250514` / `gemini-2.0-flash` |
| `BETTER_AUTH_URL` | `http://localhost:3000` | The canonical URL where Pocket CEP is running |

All variables are validated at startup with Zod. If anything is missing or malformed, you get a clear error message pointing you to the fix.

## Auth Modes

Pocket CEP supports two authentication modes that control how it communicates with the MCP server. Choose the one that fits your environment.

### `service_account` (default)

```
.env: AUTH_MODE=service_account
```

**How it works:** The user signs into Pocket CEP with basic Google OAuth (just `openid`, `email`, `profile` scopes) for UI access. The MCP server uses its own Application Default Credentials (ADC) to call Google APIs. ADC comes from running `gcloud auth application-default login` as a Workspace admin.

**Best for:**
- Local development and demos
- Environments where you've already run `gcloud auth application-default login`
- Quick setup when you don't need per-user audit trails
- Workshops where attendees don't have Workspace admin access

**Requirements:**
- Run `gcloud auth application-default login` with the admin scopes (see [Quick Start](#quick-start))
- Set a quota project: `gcloud auth application-default set-quota-project YOUR_PROJECT_ID`

**Note:** A service account JSON key alone won't work — the upstream MCP server's `GoogleAuth` call doesn't pass a `subject` for domain-wide delegation. ADC from `gcloud auth application-default login` (where a human admin authenticates) is the supported path.

### `user_oauth`

```
.env: AUTH_MODE=user_oauth
```

**How it works:** The user signs into Pocket CEP with the full set of Google Admin scopes. Their personal OAuth access token is forwarded as a `Bearer` header to the MCP server, which uses it for every Google API call.

**Best for:**
- Production-like deployments where actions should be attributed to the signed-in user
- Environments where ADC isn't configured on the server
- Multi-tenant setups where different users have different permissions
- When you need per-user audit trails in Google Admin logs

**Requirements:**
- The signed-in user must be a Google Workspace administrator
- The MCP server should be started with `OAUTH_ENABLED=true`

## LLM Providers

### Claude (Anthropic)

```
.env: LLM_PROVIDER=claude
.env.local: ANTHROPIC_API_KEY=sk-ant-...
```

Uses the official `@anthropic-ai/sdk`. Default model: `claude-sonnet-4-20250514`. Claude has strong tool-use capabilities and native understanding of MCP concepts.

### Gemini (Google)

```
.env: LLM_PROVIDER=gemini
.env.local: GOOGLE_AI_API_KEY=...
```

Uses the official `@google/generative-ai`. Default model: `gemini-2.0-flash`. Keeps the entire stack within the Google ecosystem.

Both adapters support streaming responses and multi-turn tool calling. You can override the specific model with `LLM_MODEL` in `.env`.

## Starting the MCP Server

Pocket CEP needs the Chrome Enterprise Premium MCP server running in HTTP mode.

### Auto-Starting the MCP Server

Set `MCP_SERVER_CMD` and Pocket CEP spawns the MCP server as a child process on startup. One terminal, no fuss.

```bash
# In .env (persisted):
MCP_SERVER_CMD=npx @google/chrome-enterprise-premium-mcp@latest

# Or as an inline env var (one-off):
MCP_SERVER_CMD="npx @google/chrome-enterprise-premium-mcp@latest" npm run dev

# Local clone:
MCP_SERVER_CMD="node ../cmcp/mcp-server.js" npm run dev
```

The command runs with `GCP_STDIO=false` and `PORT` (from `MCP_SERVER_URL`) injected automatically. The server's logs appear in the same console with a `[mcp-server]` prefix. The process is killed when Pocket CEP shuts down.

If the command fails to start, you'll see detailed error messages explaining what went wrong and how to fix it.

### Manual Start (separate terminal)

If you prefer to manage the MCP server yourself, leave `MCP_SERVER_CMD` blank and start it separately:

```bash
# Terminal 1: MCP server
GCP_STDIO=false PORT=4000 npx @google/chrome-enterprise-premium-mcp@latest

# Terminal 2: Pocket CEP
npm run dev
```

For `user_oauth` mode, add `OAUTH_ENABLED=true` to the MCP server:

```bash
GCP_STDIO=false PORT=4000 OAUTH_ENABLED=true npx @google/chrome-enterprise-premium-mcp@latest
```

### Default Ports

| Service | Port | Controlled by |
|---------|------|---------------|
| Pocket CEP (Next.js) | 3000 | `PORT` env var or `next dev --port` |
| MCP Server | 4000 | Port from `MCP_SERVER_URL` (auto-start) or `PORT` env var (manual) |

## Deployment Options

### Local Development

The simplest setup. Both services run on your machine.

```
[Browser :3000] --> [Pocket CEP :3000] --> [MCP Server :4000] --> [Google APIs]
                                       --> [Anthropic/Gemini API]
```

```bash
# Single terminal with auto-start:
MCP_SERVER_CMD="npx @google/chrome-enterprise-premium-mcp@latest" npm run dev
```

### Cloud Run / Docker

Both services run as containers. Pocket CEP connects to the MCP server via its internal URL.

```bash
# Build Pocket CEP
npm run build

# Point MCP_SERVER_URL at the MCP server's internal URL
MCP_SERVER_URL=https://cep-mcp-server-xyz.run.app/mcp npm run start
```

Key considerations:
- Set `BETTER_AUTH_URL` to the public URL of your Pocket CEP deployment
- Update the Google OAuth redirect URI to match
- Use `user_oauth` mode if the MCP server doesn't have its own ADC
- Use `service_account` mode if the machine has ADC configured

### Shared Demo / Workshop

For workshops where multiple attendees use the same instance:

1. Set up ADC on the host with a Workspace admin account
2. Deploy Pocket CEP with `AUTH_MODE=service_account` and `MCP_SERVER_CMD` set
3. Each attendee signs in with their Google account (basic scopes only)
4. All MCP calls use the shared ADC credentials

This avoids requiring every attendee to be a Workspace admin.

## Project Structure

```
pocket-cep/
  .env                          # Committed defaults with documentation
  .env.local                    # Secrets (gitignored)
  .env.local.example            # Template for .env.local
  AGENTS.md                     # Coding standards
  CLAUDE.md -> AGENTS.md        # Symlink for Claude Code
  GEMINI.md -> AGENTS.md        # Symlink for Gemini

  src/
    app/
      layout.tsx                # Root layout with Inter font
      page.tsx                  # Landing page with Google sign-in
      globals.css               # Tailwind v4 + Material Design tokens
      dashboard/page.tsx        # Main UI: user selector + chat + inspector
      api/
        auth/[...all]/route.ts  # BetterAuth catch-all
        users/route.ts          # GET: users from activity log
        chat/route.ts           # POST: streaming agent chat (SSE)
        tools/route.ts          # GET: available MCP tools

    components/
      app-bar.tsx               # Google-style top navigation
      user-selector.tsx         # User dropdown from activity log
      chat-panel.tsx            # Chat orchestrator with SSE streaming
      chat-message.tsx          # Message bubble with tool call cards
      chat-input.tsx            # Text input with send button
      inspector-panel.tsx       # MCP protocol traffic viewer
      sign-in-button.tsx        # Google sign-in button

    lib/
      env.ts                    # Zod-validated environment variables
      errors.ts                 # Shared error message extraction
      auth.ts                   # BetterAuth server config (stateless, no DB)
      auth-client.ts            # BetterAuth browser client
      mcp-client.ts             # MCP SDK StreamableHTTP wrapper
      mcp-server-process.ts     # Optional MCP server child process manager
      agent-loop.ts             # LLM <-> MCP tool execution loop (with tool cache)
      access-token.ts           # Google OAuth token retrieval helper
      constants.ts              # System prompt, default models, log tags
      doctor.ts                 # Environment diagnostic script
      doctor-checks.ts          # Shared LLM API key probe helpers
      llm/
        types.ts                # Shared LLM adapter interface
        claude.ts               # Anthropic SDK adapter
        gemini.ts               # Google GenAI adapter

    proxy.ts                    # Route protection (Next.js 16 proxy convention)
    instrumentation.ts          # Server startup hook (auto-starts MCP server)

    __tests__/
      unit/                     # env + mcp-client + access-token
      integration/              # admin-sdk query translation
      e2e/                      # Playwright: landing, chat flow, scroll
```

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build |
| `npm run start` | Serve production build on port 3000 |
| `npm run check` | Typecheck + lint + unit tests + integration tests |
| `npm run lint` | ESLint with auto-fix (includes Prettier formatting) |
| `npm run typecheck` | TypeScript type checking |
| `npm run test` | Run all Vitest tests |
| `npm run test:unit` | Run unit tests only |
| `npm run test:integration` | Run integration tests only |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run doctor` | Check your environment (env vars, MCP server, LLM API) |

## Testing

### Unit Tests (Vitest)

Test pure logic without external dependencies.

```bash
npm run test:unit
```

Covers: Zod env validation, MCP client wrapper (mocked SDK), access token retrieval.

### Integration Tests (Vitest)

```bash
npm run test:integration
```

Covers: Admin SDK directory query translation.

### E2E Tests (Playwright)

Test the real app in a browser. Playwright auto-starts the dev server.

```bash
npm run test:e2e
```

Covers: landing page rendering, chat transport wiring (selected user propagates across sends), scroll behavior (chat container and sidebar roster).

## Environment Diagnostics

Run `npm run doctor` before starting the app to catch configuration issues early:

```
Pocket CEP Environment Check

Static checks:
  ✓ .env file found
  ✓ .env.local file found (secrets)
  ✓ Environment variables valid (Zod schema passed)
  ✓ BETTER_AUTH_SECRET is set to a real value
  ✓ AUTH_MODE: service_account
  ✓ LLM_PROVIDER: claude
  ✓ GOOGLE_CLIENT_ID format looks correct
  ! MCP_SERVER_CMD not set — you must start the MCP server manually

Runtime checks:
  ✓ MCP server reachable at http://localhost:4000/mcp (status: 405)
  ✓ MCP server has 23 tools available
  ✓ Anthropic API key accepted (status: 400)

Summary: 10/10 checks passed. All good!
```

## How It Works

### Architecture

```
Browser                     Pocket CEP (Next.js :3000)        External Services

[Google Sign-In] --------> /api/auth (BetterAuth) ---------> Google OAuth
                            stores session in signed cookie

[User Dropdown]  --------> /api/users ----------------------> MCP Server :4000
                            calls get_chrome_activity_log      (Bearer token in
                            extracts unique actor emails        user_oauth mode)

[Chat UI] ---------------> /api/chat (SSE stream) ----------> Claude or Gemini
  message + user             Agent loop:
                             1. Send to LLM with MCP tools
                             2. LLM requests tool call ------> MCP Server :4000
                             3. Tool result fed back to LLM
                             4. Stream text + events to UI

[MCP Inspector] <------- SSE events with raw JSON-RPC protocol traffic
```

### The Agent Loop

The core of the chat feature is an async generator in `src/lib/agent-loop.ts`:

1. Fetch the list of available MCP tools from the server (cached for 60s)
2. Send the user's message to the LLM along with tool definitions
3. Stream text deltas back to the browser as SSE events
4. When the LLM requests a tool call, execute it via the MCP client
5. Feed the tool result back to the LLM and repeat
6. Stop when the LLM gives a final text answer (or after 10 iterations)

Every MCP request/response is also emitted as an SSE event, which the Inspector panel renders.

### MCP Communication

Pocket CEP uses the official `@modelcontextprotocol/sdk` to talk to the MCP server over HTTP. The `StreamableHTTPClientTransport` sends JSON-RPC 2.0 requests to `POST /mcp`. Each call creates a fresh connection (the upstream server is stateless).

In `user_oauth` mode, the signed-in user's Google access token is injected as a `Bearer` header so the MCP server can use it for downstream Google API calls.

## License

This project is an educational companion and is not an officially supported Google product.

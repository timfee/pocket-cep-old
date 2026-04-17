/**
 * @file Manages an optional child process for the MCP server.
 *
 * When MCP_SERVER_CMD is set, Pocket CEP spawns the MCP server on startup
 * and kills it on shutdown. This avoids the "open two terminals" dance
 * during development. The command runs with GCP_STDIO=false injected
 * so the server starts in HTTP mode regardless of the user's env.
 *
 * If MCP_SERVER_CMD is blank, this module is a no-op.
 *
 * The child process's stdout/stderr are prefixed with [mcp-server] so
 * you can distinguish MCP server logs from Pocket CEP logs in the console.
 */

import { spawn, type ChildProcess } from "child_process";
import { LOG_TAGS } from "./constants";

let child: ChildProcess | null = null;

/**
 * Spawns the MCP server if MCP_SERVER_CMD is configured.
 * Idempotent — calling it twice won't start a second process.
 *
 * The command is split on spaces for argv. If you need complex shell
 * syntax (pipes, &&, etc.), wrap it in `bash -c "..."`.
 */
export function startMcpServer(cmd: string, mcpServerUrl?: string): void {
  if (!cmd || child) return;

  const mcpPort = mcpServerUrl ? new URL(mcpServerUrl).port || "4000" : "4000";
  const parts = cmd.split(/\s+/);
  const [command, ...args] = parts;

  console.log(
    LOG_TAGS.MCP,
    `Auto-starting MCP server on port ${mcpPort}`,
    `\n  Command: ${cmd}`,
    `\n  Target:  ${mcpServerUrl ?? `http://localhost:${mcpPort}/mcp`}`,
  );

  child = spawn(command, args, {
    env: {
      ...process.env,
      GCP_STDIO: "false",
      PORT: mcpPort,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.log(LOG_TAGS.MCP_CHILD, line);
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      console.error(LOG_TAGS.MCP_CHILD, line);
    }
  });

  child.on("error", (error) => {
    child = null;

    if (error.message.includes("ENOENT")) {
      console.error(
        LOG_TAGS.MCP_CHILD,
        `Command not found: "${command}"`,
        "\n",
        "\n  MCP_SERVER_CMD is set but the command could not be found.",
        "\n  Check that the path is correct and the package is installed.",
        "\n",
        "\n  Common fixes:",
        `\n    - Published package: MCP_SERVER_CMD=npx @google/chrome-enterprise-premium-mcp@latest`,
        `\n    - Local clone:      MCP_SERVER_CMD=node /path/to/cmcp/mcp-server.js`,
        "\n",
      );
    } else if (error.message.includes("EACCES")) {
      console.error(
        LOG_TAGS.MCP_CHILD,
        `Permission denied: "${command}"`,
        "\n  The MCP server command exists but is not executable.",
        `\n  Try: chmod +x ${command}`,
      );
    } else {
      console.error(LOG_TAGS.MCP_CHILD, `Failed to start MCP server: ${error.message}`);
    }
  });

  child.on("exit", (code, signal) => {
    child = null;

    if (signal) {
      console.log(LOG_TAGS.MCP_CHILD, `MCP server stopped (signal: ${signal})`);
      return;
    }

    if (code === 0) return;

    console.error(
      LOG_TAGS.MCP_CHILD,
      `MCP server exited with code ${code}`,
      "\n",
      "\n  The MCP server process started but then crashed.",
      "\n  Check the [mcp-server] log lines above for the root cause.",
      "\n",
      "\n  Common causes:",
      "\n    - Missing dependencies: run `npm install` in the MCP server directory",
      "\n    - Port conflict: another process is already using port " + mcpPort,
      "\n    - Missing credentials: run `npm run doctor` to check your environment",
      "\n",
    );
  });
}

/**
 * Sends SIGTERM to the MCP server child process if one is running.
 * The child reference is cleared by the "exit" event handler, not here,
 * to avoid a race where startMcpServer could spawn a second process
 * before the first has actually exited.
 */
export function stopMcpServer(): void {
  if (!child) return;

  console.log(LOG_TAGS.MCP, "Stopping MCP server child process");
  child.kill("SIGTERM");
}

/**
 * Returns true if the MCP server child process is currently running.
 */
export function isMcpServerRunning(): boolean {
  return child !== null && child.exitCode === null;
}

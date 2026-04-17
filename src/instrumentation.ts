/**
 * @file Next.js instrumentation hook — runs once when the server starts.
 *
 * Auto-starts the MCP server child process if MCP_SERVER_CMD is configured.
 * Uses dynamic import to avoid Edge Runtime compatibility warnings (child_process
 * is only loaded when Node.js is actually executing this code).
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  const cmd = process.env.MCP_SERVER_CMD;
  if (!cmd) return;

  const { startMcpServer, stopMcpServer } = await import("./lib/mcp-server-process");

  startMcpServer(cmd, process.env.MCP_SERVER_URL);

  const shutdown = () => {
    stopMcpServer();
    process.exit(0);
  };

  // Use .once to avoid stacking duplicate handlers on HMR re-evaluations.
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

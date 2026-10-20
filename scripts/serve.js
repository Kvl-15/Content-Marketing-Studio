// @ts-check
import { createApp } from "../server/app.js";
import { closeSharedBrowser } from "../server/export/index.js";

// Load .env if present (Node.js 20.6+ native feature)
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile();
  } catch {
    // .env is optional
  }
}

const port = Number(process.env.PORT || 3000);

async function main() {
  const app = await createApp();

  const server = app.listen(port, () => {
    console.log(`[server] ACM Content Marketing Studio listening on http://localhost:${port}`);
    console.log(`[server] Storage backend: ${app.locals.storage.type}`);
  });

  // Long export timeouts (Condition 4: 10 minutes)
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 10 * 60 * 1000 + 5000;

  // Clean exit: handle SIGINT / SIGTERM gracefully (Requirement 6)
  const shutdown = async () => {
    console.log("\n[server] Received termination signal. Closing server...");
    server.close(async () => {
      try {
        if (app.locals.storage?.close) {
          await app.locals.storage.close();
        }
        await closeSharedBrowser();
      } catch (err) {
        console.error("[server] Error closing connections:", err?.message || err);
      }
      console.log("[server] Server shut down gracefully.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[server] Fatal startup error:", err);
  process.exit(1);
});

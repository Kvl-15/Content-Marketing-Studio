// @ts-check
import express from "express";
import { createCorsMiddleware } from "./cors.js";
import { createApiRouter } from "./routes/index.js";
import { createIntakeRouter } from "./routes/intake.js";
import { initStorage } from "./storage/index.js";
import { loadServerAssets } from "./assets.js";

/**
 * Creates and configures the Express application.
 *
 * @param {{
 *   storage?: import("./storage/index.js").StorageInterface;
 *   assets?: any;
 * }} [options]
 * @returns {Promise<import("express").Express>}
 */
export async function createApp(options = {}) {
  const app = express();

  // 1. Initialize storage and assets in app.locals
  const storage = options.storage || (await initStorage());
  const assets = options.assets || loadServerAssets();
  app.locals.storage = storage;
  app.locals.assets = assets;

  // 2. Custom CORS (no external package, localhost:5173/3000 + env)
  app.use(createCorsMiddleware());

  // 3. JSON body parser (1MB limit for metadata/schemas)
  app.use(express.json({ limit: "1mb" }));

  // 4. Privacy-safe request logger (never logs names, emails, or personal data)
  app.use((req, res, next) => {
    // Only log operational method and path (no query containing personal data, no body)
    if (process.env.NODE_ENV !== "test") {
      const start = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
      });
    }
    next();
  });

  // 5. Mount API routes
  app.use(createApiRouter());
  app.use(createIntakeRouter());

  // 6. 404 handler matching API contract
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Endpoint ${req.method} ${req.path} not found`,
      },
    });
  });

  // 7. Global error handler matching API_CONTRACT.md envelope
  // Signature must be (err, req, res, next) for Express error handling
  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    let status = err.status || err.statusCode || 500;
    if (err.type === "entity.too.large" || status === 413) {
      status = 413;
    }

    let code =
      err.code ||
      (status === 413
        ? "PAYLOAD_TOO_LARGE"
        : status === 404
          ? "NOT_FOUND"
          : status === 422
            ? "VALIDATION_FAILED"
            : status === 400
              ? "BAD_REQUEST"
              : "INTERNAL_ERROR");

    // Clean message: never leak disk paths or system internals
    let message = err.message || "An internal server error occurred";
    message = message
      .replace(/[A-Za-z]:\\[^:\s'"]+/g, "[path]")
      .replace(/\/[\w./-]+/g, "[path]");

    const responseBody = {
      error: {
        code,
        message,
        ...(err.issues && Array.isArray(err.issues) ? { issues: err.issues } : {}),
      },
    };

    res.status(status).json(responseBody);
  });

  return app;
}

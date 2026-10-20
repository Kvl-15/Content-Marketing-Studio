// @ts-check

/**
 * Creates a CORS middleware supporting localhost:5173, localhost:3000,
 * and origins configured in ALLOWED_ORIGINS env variable.
 * Does NOT use any third-party cors library.
 *
 * @returns {import("express").RequestHandler}
 */
export function createCorsMiddleware() {
  const defaultOrigins = ["http://localhost:5173", "http://localhost:3000"];
  const envOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const allowedOrigins = new Set([...defaultOrigins, ...envOrigins]);

  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With"
      );
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  };
}

// @ts-check
import { Router } from "express";

export function createHealthRouter() {
  const router = Router();

  router.get("/health", async (req, res, next) => {
    try {
      const storage = req.app.locals.storage;
      const storageType = storage?.type || "unknown";

      let healthy = true;
      if (storage && typeof storage.ping === "function") {
        healthy = await storage.ping();
      }

      if (!healthy) {
        return res.status(503).json({
          status: "error",
          storage: storageType,
        });
      }

      res.json({
        status: "ok",
        storage: storageType,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

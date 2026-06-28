import express, { Application, Request, Response, NextFunction } from "express";
import { importRouter } from "./routes/import";
import helmet from "helmet";

export function createApp(): Application {
  const app = express();

  app.use(express.json());

  // Sets X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, etc.
  app.use(helmet());

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString()});
  });

  app.use("/import", importRouter);

  // Global error handler catches errors forwarded via next(err),
  // TODO Change it for more customs errors
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[error]", err.message);

    if (err.message.includes("Only CSV files are accepted")) {
      res.status(400).json({ error: err.message });
      return;
    }

    if (err.message.includes("File too large")) {
      res.status(413).json({ error: "File exceeds the 50 MB limit." });
      return;
    }

    res.status(500).json({ error: "An unexpected error occurred." });
  });

  return app;
}

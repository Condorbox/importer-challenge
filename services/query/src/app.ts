import express, { Application, Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { recordsRouter } from "./routes/records";
import { isDatabaseConnectivityError } from "@shared/errors/db_errors";

export function createApp(): Application {
  const app = express();

  app.use(express.json());
  app.use(helmet());

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      service: "query",
      status: "ok",
      timestamp: new Date().toISOString(),
    });
  });

  app.use("/datasets", recordsRouter);

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[error]", err.message, err.cause);

    if (isDatabaseConnectivityError(err)) {
      res.status(503).json({
        success: false,
        error: "The database is temporarily unavailable. Please try again shortly.",
      });

      return;
    }

    res.status(500).json({ success: false, error: "An unexpected error occurred." });
  });

  return app;
}

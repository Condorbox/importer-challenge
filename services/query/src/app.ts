import express, { Application, Request, Response } from "express";
import helmet from "helmet";

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

  return app;
}

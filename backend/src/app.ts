import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import * as Sentry from "@sentry/node";

import "./database";
import uploadConfig from "./config/upload";
import AppError from "./errors/AppError";
import routes from "./routes";
import { logger } from "./utils/logger";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL
  })
);
app.use(cookieParser());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));
app.use(Sentry.Handlers.requestHandler());
app.use("/public", express.static(uploadConfig.directory));

// --- Serve React Frontend Statically (Single Container) ---
import path from "path";
const frontendPath = path.join(__dirname, "..", "public", "frontend");
app.use(express.static(frontendPath));

// Intercept browser page requests (e.g. refreshing /contacts or /tickets)
app.get("*", (req: Request, res: Response, next: NextFunction) => {
  if (
    req.accepts("html") &&
    !req.xhr &&
    !req.headers["authorization"] &&
    !req.path.startsWith("/public") &&
    !req.path.startsWith("/api")
  ) {
    return res.sendFile(path.join(frontendPath, "index.html"));
  }
  return next();
});

app.use(routes);

// --- SPA Fallback for any other unmatched routes ---
app.get("*", (req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/public") || req.path.startsWith("/api")) {
    return next();
  }
  res.sendFile(path.join(frontendPath, "index.html"));
});
app.use(Sentry.Handlers.errorHandler());

app.use(async (err: Error, req: Request, res: Response, _: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

export default app;

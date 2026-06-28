import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { bookRouter } from "./routes/bookRoutes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { notFoundHandler } from "./middleware/notFoundHandler.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan("dev"));

  app.get("/health", (request, response) => {
    response.json({
      success: true,
      data: {
        status: "ok",
        service: "lob-matching-engine",
      },
    });
  });

  app.use("/api/v1", bookRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
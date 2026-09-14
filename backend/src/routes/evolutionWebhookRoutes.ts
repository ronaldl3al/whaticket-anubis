import { Router } from "express";
import { handleEvolutionWebhook } from "../controllers/EvolutionWebhookController";

const evolutionWebhookRoutes = Router();

evolutionWebhookRoutes.post(
  "/evolution-webhook/:sessionId",
  handleEvolutionWebhook
);

evolutionWebhookRoutes.post(
  "/evolution-webhook",
  handleEvolutionWebhook
);

export default evolutionWebhookRoutes;

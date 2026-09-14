import { Router } from "express";

import userRoutes from "./userRoutes";
import authRoutes from "./authRoutes";
import settingRoutes from "./settingRoutes";
import contactRoutes from "./contactRoutes";
import ticketRoutes from "./ticketRoutes";
import whatsappRoutes from "./whatsappRoutes";
import messageRoutes from "./messageRoutes";
import whatsappSessionRoutes from "./whatsappSessionRoutes";
import queueRoutes from "./queueRoutes";
import quickAnswerRoutes from "./quickAnswerRoutes";
import quickNoteRoutes from "./quickNoteRoutes";
import apiRoutes from "./apiRoutes";
import evolutionWebhookRoutes from "./evolutionWebhookRoutes";

const routes = Router();

routes.use(userRoutes);
routes.use("/auth", authRoutes);
routes.use(settingRoutes);
routes.use(contactRoutes);
routes.use(ticketRoutes);
routes.use(whatsappRoutes);
routes.use(messageRoutes);
routes.use(whatsappSessionRoutes);
routes.use(queueRoutes);
routes.use(quickAnswerRoutes);
routes.use(quickNoteRoutes);
routes.use("/api/messages", apiRoutes);
routes.use(evolutionWebhookRoutes);

routes.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    provider: process.env.WHATSAPP_PROVIDER || "whaileys",
    features: ["lid-resolution", "merge-duplicates", "unregistered-phone-names"],
    build: "20260913-v2",
    time: new Date().toISOString()
  });
});

export default routes;

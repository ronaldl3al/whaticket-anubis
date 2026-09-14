import express from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";

import * as QuickAnswerController from "../controllers/QuickAnswerController";

const upload = multer(uploadConfig);
const quickAnswerRoutes = express.Router();

quickAnswerRoutes.get("/quickAnswers", isAuth, QuickAnswerController.index);

quickAnswerRoutes.post(
  "/quickAnswers/media-upload",
  isAuth,
  upload.single("media"),
  QuickAnswerController.mediaUpload
);

quickAnswerRoutes.get(
  "/quickAnswers/:quickAnswerId",
  isAuth,
  QuickAnswerController.show
);

quickAnswerRoutes.post("/quickAnswers", isAuth, QuickAnswerController.store);

quickAnswerRoutes.put(
  "/quickAnswers/:quickAnswerId",
  isAuth,
  QuickAnswerController.update
);

quickAnswerRoutes.delete(
  "/quickAnswers/:quickAnswerId",
  isAuth,
  QuickAnswerController.remove
);

export default quickAnswerRoutes;

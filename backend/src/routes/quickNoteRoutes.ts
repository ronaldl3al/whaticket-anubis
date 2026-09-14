import express from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";

import * as QuickNoteController from "../controllers/QuickNoteController";

const upload = multer(uploadConfig);
const quickNoteRoutes = express.Router();

quickNoteRoutes.get("/quickNotes", isAuth, QuickNoteController.index);

quickNoteRoutes.post(
  "/quickNotes/media-upload",
  isAuth,
  upload.single("media"),
  QuickNoteController.mediaUpload
);

quickNoteRoutes.get(
  "/quickNotes/:quickNoteId",
  isAuth,
  QuickNoteController.show
);

quickNoteRoutes.post("/quickNotes", isAuth, QuickNoteController.store);

quickNoteRoutes.put(
  "/quickNotes/:quickNoteId",
  isAuth,
  QuickNoteController.update
);

quickNoteRoutes.delete(
  "/quickNotes/:quickNoteId",
  isAuth,
  QuickNoteController.remove
);

export default quickNoteRoutes;

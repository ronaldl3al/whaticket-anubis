import express from "express";
import isAuth from "../middleware/isAuth";

import uploadConfig from "../config/upload";
import multer from "multer";

import * as ContactController from "../controllers/ContactController";
import * as ImportPhoneContactsController from "../controllers/ImportPhoneContactsController";

const upload = multer(uploadConfig);
const contactRoutes = express.Router();

contactRoutes.get(
  "/contacts/export-google",
  isAuth,
  ContactController.exportGoogleContacts
);

contactRoutes.post(
  "/contacts/import-google",
  isAuth,
  upload.single("file"),
  ContactController.importGoogleContacts
);

contactRoutes.post(
  "/contacts/import",
  isAuth,
  ImportPhoneContactsController.store
);

contactRoutes.post(
  "/contacts/merge-duplicates",
  isAuth,
  ContactController.mergeDuplicates
);

contactRoutes.post(
  "/contacts/clean-invalid",
  isAuth,
  ContactController.deleteInvalidContacts
);

contactRoutes.get("/contacts", isAuth, ContactController.index);

contactRoutes.get("/contacts/:contactId/profile-pic", isAuth, ContactController.getProfilePic);

contactRoutes.get("/contacts/:contactId", isAuth, ContactController.show);

contactRoutes.post("/contacts", isAuth, ContactController.store);

contactRoutes.post("/contact", isAuth, ContactController.getContact);

contactRoutes.put("/contacts/:contactId", isAuth, ContactController.update);

contactRoutes.delete("/contacts/delete-all", isAuth, ContactController.removeAll);
contactRoutes.post("/contacts/delete-all", isAuth, ContactController.removeAll);
contactRoutes.delete("/contacts", isAuth, ContactController.removeAll);
contactRoutes.delete("/contacts/:contactId", isAuth, ContactController.remove);

export default contactRoutes;

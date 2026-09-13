import * as Yup from "yup";
import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import Contact from "../models/Contact";

import ListContactsService from "../services/ContactServices/ListContactsService";
import CreateContactService from "../services/ContactServices/CreateContactService";
import ShowContactService from "../services/ContactServices/ShowContactService";
import UpdateContactService from "../services/ContactServices/UpdateContactService";
import DeleteContactService from "../services/ContactServices/DeleteContactService";

import CheckContactNumber from "../services/WbotServices/CheckNumber";
import CheckIsValidContact from "../services/WbotServices/CheckIsValidContact";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import AppError from "../errors/AppError";
import GetContactService from "../services/ContactServices/GetContactService";
import {
  ExportGoogleContactsService,
  ImportGoogleContactsService
} from "../services/ContactServices/GoogleContactsService";
import MergeDuplicateContactsService from "../services/ContactServices/MergeDuplicateContactsService";
import DeleteInvalidContactsService from "../services/ContactServices/DeleteInvalidContactsService";

type IndexQuery = {
  searchParam: string;
  pageNumber: string;
};

type IndexGetContactQuery = {
  name: string;
  number: string;
};

interface ExtraInfo {
  name: string;
  value: string;
}
interface ContactData {
  name: string;
  number: string;
  email?: string;
  extraInfo?: ExtraInfo[];
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, pageNumber } = req.query as IndexQuery;

  const { contacts, count, hasMore } = await ListContactsService({
    searchParam,
    pageNumber
  });

  return res.json({ contacts, count, hasMore });
};

export const getContact = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { name, number } = req.body as IndexGetContactQuery;

  const contact = await GetContactService({
    name,
    number
  });

  return res.status(200).json(contact);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const newContact: ContactData = req.body;
  newContact.number = newContact.number.replace("-", "").replace(" ", "");

  const schema = Yup.object().shape({
    name: Yup.string().required(),
    number: Yup.string()
      .required()
      .matches(/^\d+$/, "Invalid number format. Only numbers is allowed.")
  });

  try {
    await schema.validate(newContact);
  } catch (err) {
    throw new AppError(err.message);
  }

  await CheckIsValidContact(newContact.number);
  const validNumber: any = await CheckContactNumber(newContact.number);

  const profilePicUrl = await GetProfilePicUrl(validNumber);

  let name = newContact.name;
  let number = validNumber;
  let email = newContact.email;
  let extraInfo = newContact.extraInfo;

  const contact = await CreateContactService({
    name,
    number,
    email,
    extraInfo,
    profilePicUrl
  });

  const io = getIO();
  io.emit("contact", {
    action: "create",
    contact
  });

  return res.status(200).json(contact);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { contactId } = req.params;

  const contact = await ShowContactService(contactId);

  return res.status(200).json(contact);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const contactData: ContactData = req.body;

  const schema = Yup.object().shape({
    name: Yup.string(),
    number: Yup.string().matches(
      /^\d+$/,
      "Invalid number format. Only numbers is allowed."
    )
  });

  try {
    await schema.validate(contactData);
  } catch (err) {
    throw new AppError(err.message);
  }

  await CheckIsValidContact(contactData.number);

  const { contactId } = req.params;

  const contact = await UpdateContactService({ contactData, contactId });

  const io = getIO();
  io.emit("contact", {
    action: "update",
    contact
  });

  return res.status(200).json(contact);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { contactId } = req.params;

  await DeleteContactService(contactId);

  const io = getIO();
  io.emit("contact", {
    action: "delete",
    contactId
  });

  return res.status(200).json({ message: "Contact deleted" });
};

export const exportGoogleContacts = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { type } = req.query as { type?: "all" | "unregistered" };
  const csvContent = await ExportGoogleContactsService(type || "all");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="contactos_google_${type || "all"}.csv"`
  );
  return res.status(200).send(csvContent);
};

export const importGoogleContacts = async (
  req: Request,
  res: Response
): Promise<Response> => {
  let csvData = "";
  if (req.file && req.file.path) {
    const fs = require("fs");
    csvData = fs.readFileSync(req.file.path, "utf-8");
    try {
      fs.unlinkSync(req.file.path);
    } catch {}
  } else if (req.body && req.body.csvContent) {
    csvData = req.body.csvContent;
  } else if (typeof req.body === "string") {
    csvData = req.body;
  }

  if (!csvData) {
    throw new AppError("ERR_NO_CSV_DATA_PROVIDED", 400);
  }

  const result = await ImportGoogleContactsService(csvData);

  return res.status(200).json(result);
};

export const removeAll = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const count = await Contact.destroy({ where: {} });

  const io = getIO();
  io.emit("contact", {
    action: "refresh"
  });

  return res.status(200).json({ message: "All contacts deleted", count });
};

export const mergeDuplicates = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const result = await MergeDuplicateContactsService();
  return res.status(200).json(result);
};

export const deleteInvalidContacts = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const result = await DeleteInvalidContactsService();
  return res.status(200).json(result);
};

import { Request, Response } from "express";
import * as Yup from "yup";
import { getIO } from "../libs/socket";
import AppError from "../errors/AppError";

import ListQuickNotesService from "../services/QuickNoteService/ListQuickNotesService";
import CreateQuickNoteService from "../services/QuickNoteService/CreateQuickNoteService";
import ShowQuickNoteService from "../services/QuickNoteService/ShowQuickNoteService";
import UpdateQuickNoteService from "../services/QuickNoteService/UpdateQuickNoteService";
import DeleteQuickNoteService from "../services/QuickNoteService/DeleteQuickNoteService";

interface QuickNoteQuery {
  searchParam?: string;
  category?: string;
}

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { searchParam, category } = req.query as QuickNoteQuery;

  const { quickNotes, count } = await ListQuickNotesService({
    searchParam,
    category
  });

  return res.json({ quickNotes, count });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const newQuickNote = req.body;

  const schema = Yup.object().shape({
    title: Yup.string().required(),
    content: Yup.string().required(),
    category: Yup.string().nullable(),
    mediaUrl: Yup.string().nullable(),
    mediaType: Yup.string().nullable()
  });

  try {
    await schema.validate(newQuickNote);
  } catch (err) {
    throw new AppError(err.message);
  }

  const userId = req.user?.id ? Number(req.user.id) : undefined;

  const quickNote = await CreateQuickNoteService({
    ...newQuickNote,
    userId
  });

  const io = getIO();
  io.emit("quickNote", {
    action: "create",
    quickNote
  });

  return res.status(200).json(quickNote);
};

export const show = async (req: Request, res: Response): Promise<Response> => {
  const { quickNoteId } = req.params;

  const quickNote = await ShowQuickNoteService(quickNoteId);

  return res.status(200).json(quickNote);
};

export const update = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const quickNoteData = req.body;

  const schema = Yup.object().shape({
    title: Yup.string(),
    content: Yup.string(),
    category: Yup.string().nullable(),
    mediaUrl: Yup.string().nullable(),
    mediaType: Yup.string().nullable()
  });

  try {
    await schema.validate(quickNoteData);
  } catch (err) {
    throw new AppError(err.message);
  }

  const { quickNoteId } = req.params;

  const quickNote = await UpdateQuickNoteService({
    quickNoteData,
    quickNoteId
  });

  const io = getIO();
  io.emit("quickNote", {
    action: "update",
    quickNote
  });

  return res.status(200).json(quickNote);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { quickNoteId } = req.params;

  await DeleteQuickNoteService(quickNoteId);

  const io = getIO();
  io.emit("quickNote", {
    action: "delete",
    quickNoteId
  });

  return res.status(200).json({ message: "Quick Note deleted" });
};

export const mediaUpload = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const file = req.file as Express.Multer.File;
  if (!file) {
    throw new AppError("ERR_NO_FILE_UPLOADED");
  }

  const backendUrl = process.env.BACKEND_URL || "";
  const mediaUrl = `${backendUrl}/public/${file.filename}`;
  const mediaType = file.mimetype.startsWith("video")
    ? "video"
    : file.mimetype.startsWith("image")
    ? "image"
    : "document";

  return res.status(200).json({
    mediaUrl,
    mediaType,
    fileName: file.originalname
  });
};

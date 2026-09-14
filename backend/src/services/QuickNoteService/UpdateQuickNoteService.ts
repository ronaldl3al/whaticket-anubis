import QuickNote from "../../models/QuickNote";
import AppError from "../../errors/AppError";

interface QuickNoteData {
  title?: string;
  category?: string;
  content?: string;
  mediaUrl?: string;
  mediaType?: string;
}

interface Request {
  quickNoteData: QuickNoteData;
  quickNoteId: string | number;
}

const UpdateQuickNoteService = async ({
  quickNoteData,
  quickNoteId
}: Request): Promise<QuickNote> => {
  const quickNote = await QuickNote.findByPk(quickNoteId);

  if (!quickNote) {
    throw new AppError("ERR_NO_QUICK_NOTE_FOUND", 404);
  }

  await quickNote.update(quickNoteData);
  await quickNote.reload();

  return quickNote;
};

export default UpdateQuickNoteService;

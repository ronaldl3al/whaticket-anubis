import QuickNote from "../../models/QuickNote";
import AppError from "../../errors/AppError";

const ShowQuickNoteService = async (id: string | number): Promise<QuickNote> => {
  const quickNote = await QuickNote.findByPk(id);

  if (!quickNote) {
    throw new AppError("ERR_NO_QUICK_NOTE_FOUND", 404);
  }

  return quickNote;
};

export default ShowQuickNoteService;

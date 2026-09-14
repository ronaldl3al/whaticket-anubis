import QuickNote from "../../models/QuickNote";
import AppError from "../../errors/AppError";

const DeleteQuickNoteService = async (id: string | number): Promise<void> => {
  const quickNote = await QuickNote.findByPk(id);

  if (!quickNote) {
    throw new AppError("ERR_NO_QUICK_NOTE_FOUND", 404);
  }

  await quickNote.destroy();
};

export default DeleteQuickNoteService;

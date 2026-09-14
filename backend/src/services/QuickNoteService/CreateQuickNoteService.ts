import QuickNote from "../../models/QuickNote";

interface Request {
  title: string;
  category?: string;
  content: string;
  mediaUrl?: string;
  mediaType?: string;
  userId?: number;
}

const CreateQuickNoteService = async ({
  title,
  category = "General",
  content,
  mediaUrl,
  mediaType,
  userId
}: Request): Promise<QuickNote> => {
  const quickNote = await QuickNote.create({
    title,
    category,
    content,
    mediaUrl,
    mediaType,
    userId
  });

  return quickNote;
};

export default CreateQuickNoteService;

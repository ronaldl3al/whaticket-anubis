import AppError from "../../errors/AppError";
import QuickAnswer from "../../models/QuickAnswer";

interface Request {
  shortcut: string;
  message: string;
  mediaUrl?: string;
  mediaType?: string;
}

const CreateQuickAnswerService = async ({
  shortcut,
  message,
  mediaUrl,
  mediaType
}: Request): Promise<QuickAnswer> => {
  const nameExists = await QuickAnswer.findOne({
    where: { shortcut }
  });

  if (nameExists) {
    throw new AppError("ERR__SHORTCUT_DUPLICATED");
  }

  const quickAnswer = await QuickAnswer.create({
    shortcut,
    message,
    mediaUrl,
    mediaType
  });

  return quickAnswer;
};

export default CreateQuickAnswerService;

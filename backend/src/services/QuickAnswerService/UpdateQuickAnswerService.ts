import QuickAnswer from "../../models/QuickAnswer";
import AppError from "../../errors/AppError";

interface QuickAnswerData {
  shortcut?: string;
  message?: string;
  mediaUrl?: string;
  mediaType?: string;
}

interface Request {
  quickAnswerData: QuickAnswerData;
  quickAnswerId: string;
}

const UpdateQuickAnswerService = async ({
  quickAnswerData,
  quickAnswerId
}: Request): Promise<QuickAnswer> => {
  const { shortcut, message, mediaUrl, mediaType } = quickAnswerData;

  const quickAnswer = await QuickAnswer.findOne({
    where: { id: quickAnswerId },
    attributes: ["id", "shortcut", "message", "mediaUrl", "mediaType"]
  });

  if (!quickAnswer) {
    throw new AppError("ERR_NO_QUICK_ANSWERS_FOUND", 404);
  }
  await quickAnswer.update({
    shortcut,
    message,
    mediaUrl,
    mediaType
  });

  await quickAnswer.reload({
    attributes: ["id", "shortcut", "message", "mediaUrl", "mediaType"]
  });

  return quickAnswer;
};

export default UpdateQuickAnswerService;

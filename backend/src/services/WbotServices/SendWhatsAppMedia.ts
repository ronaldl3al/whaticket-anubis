import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import { whatsappProvider, ProviderMessage } from "../../providers/WhatsApp";

import formatBody from "../../helpers/Mustache";

import Message from "../../models/Message";
import CreateMessageService from "../MessageServices/CreateMessageService";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
  quotedMsg?: Message;
}

const SendWhatsAppMedia = async ({
  media,
  ticket,
  body,
  quotedMsg
}: Request): Promise<ProviderMessage> => {
  try {
    if (!ticket.whatsappId) {
      throw new AppError("ERR_TICKET_NO_WHATSAPP");
    }

    let chatId = `${ticket.contact.number}@${ticket.isGroup ? "g" : "c"}.us`;
    if (ticket.contact.lid) {
      chatId = ticket.contact.lid;
    } else if (
      ticket.contact.number.length >= 14 &&
      ticket.contact.number.startsWith("70")
    ) {
      chatId = `${ticket.contact.number}@lid`;
    }

    const hasBody = body
      ? formatBody(body as string, ticket.contact)
      : undefined;

    const mediaInput = {
      filename: media.filename,
      mimetype: media.mimetype,
      path: media.path
    };

    const mediaOptions = {
      caption: hasBody,
      sendAudioAsVoice: true,
      sendMediaAsDocument:
        media.mimetype.startsWith("image/") &&
        !/^.*\.(jpe?g|png|gif)?$/i.exec(media.filename),
      quotedMessageId: quotedMsg?.id,
      quotedMessageFromMe: quotedMsg?.fromMe
    };

    const sentMessage = await whatsappProvider.sendMedia(
      ticket.whatsappId,
      chatId,
      mediaInput,
      mediaOptions
    );

    await ticket.update({ lastMessage: body || media.filename });

    let mediaType = "document";
    const mime = media.mimetype || "";
    if (mime.startsWith("image/")) {
      mediaType = "image";
    } else if (mime.startsWith("video/")) {
      mediaType = "video";
    } else if (
      mime.includes("audio") ||
      mime.includes("ogg") ||
      mime.includes("opus") ||
      mime.includes("mp3")
    ) {
      mediaType = "audio";
    }

    try {
      await CreateMessageService({
        messageData: {
          id: sentMessage.id,
          ticketId: ticket.id,
          contactId: undefined,
          body: hasBody || media.filename,
          fromMe: true,
          read: true,
          mediaType,
          mediaUrl: media.filename,
          quotedMsgId: quotedMsg?.id,
          ack: 1
        }
      });
    } catch (saveErr) {
      console.error("Error creating outgoing media message record:", saveErr);
    }

    return sentMessage;
  } catch (err) {
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;

import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { whatsappProvider, ProviderMessage } from "../../providers/WhatsApp";

import formatBody from "../../helpers/Mustache";
import CreateMessageService from "../MessageServices/CreateMessageService";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
}

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<ProviderMessage> => {
  if (!ticket.whatsappId) {
    throw new AppError("ERR_TICKET_NO_WHATSAPP");
  }

  let chatId = "";
  if (ticket.contact.lid) {
    chatId = ticket.contact.lid;
  } else if (ticket.isGroup) {
    chatId = `${ticket.contact.number}@g.us`;
  } else {
    // If it's a long opaque ID from the recent bug, route it to @lid
    if (ticket.contact.number && ticket.contact.number.length >= 14 && ticket.contact.number.startsWith("70")) {
      chatId = `${ticket.contact.number}@lid`;
    } else {
      chatId = `${ticket.contact.number}@c.us`;
    }
  }

  try {
    const formattedBody = formatBody(body, ticket.contact);
    const sentMessage = await whatsappProvider.sendMessage(
      ticket.whatsappId,
      chatId,
      formattedBody,
      {
        quotedMessageId: quotedMsg?.id,
        quotedMessageFromMe: quotedMsg?.fromMe,
        linkPreview: false
      }
    );

    await ticket.update({ lastMessage: body });

    let createdMsg = null;
    try {
      createdMsg = await CreateMessageService({
        messageData: {
          id: sentMessage.id,
          ticketId: ticket.id,
          contactId: undefined,
          body: formattedBody,
          fromMe: true,
          read: true,
          mediaType: "chat",
          quotedMsgId: quotedMsg?.id,
          ack: 1
        }
      });
    } catch (saveErr) {
      console.error("Error creating outgoing message record:", saveErr);
    }

    return (createdMsg || sentMessage) as any;
  } catch (err) {
    console.error("DEBUG_SEND_ERROR:", err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;

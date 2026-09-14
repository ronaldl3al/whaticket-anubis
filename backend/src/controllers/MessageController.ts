import { Request, Response } from "express";

import SetTicketMessagesAsRead from "../helpers/SetTicketMessagesAsRead";
import { getIO } from "../libs/socket";
import Message from "../models/Message";

import ListMessagesService from "../services/MessageServices/ListMessagesService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import DeleteWhatsAppMessage from "../services/WbotServices/DeleteWhatsAppMessage";
import SendWhatsAppMedia from "../services/WbotServices/SendWhatsAppMedia";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";

type IndexQuery = {
  pageNumber: string;
};

type MessageData = {
  body: string;
  fromMe: boolean;
  read: boolean;
  quotedMsg?: Message;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { pageNumber } = req.query as IndexQuery;

  const { count, messages, ticket, hasMore } = await ListMessagesService({
    pageNumber,
    ticketId
  });

  SetTicketMessagesAsRead(ticket);

  return res.json({ count, messages, ticket, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { body, quotedMsg }: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  let parsedQuotedMsg = quotedMsg;
  if (typeof quotedMsg === "string") {
    try {
      parsedQuotedMsg = JSON.parse(quotedMsg);
    } catch (e) {
      parsedQuotedMsg = undefined;
    }
  }

  const ticket = await ShowTicketService(ticketId);

  SetTicketMessagesAsRead(ticket);

  let result: any = null;
  if (medias) {
    result = await Promise.all(
      medias.map(async (media: Express.Multer.File) => {
        return await SendWhatsAppMedia({ media, ticket, quotedMsg: parsedQuotedMsg });
      })
    );
  } else {
    result = await SendWhatsAppMessage({ body, ticket, quotedMsg: parsedQuotedMsg });
  }

  return res.json(result);
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { messageId } = req.params;

  const message = await DeleteWhatsAppMessage(messageId);

  const io = getIO();
  io.to(message.ticketId.toString()).emit("appMessage", {
    action: "update",
    message
  });

  return res.send();
};

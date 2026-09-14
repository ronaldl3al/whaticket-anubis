import { getIO } from "../libs/socket";
import Message from "../models/Message";
import Ticket from "../models/Ticket";
import { logger } from "../utils/logger";
import { whatsappProvider } from "../providers/WhatsApp";

const SetTicketMessagesAsRead = async (ticket: Ticket): Promise<void> => {
  let unreadIds: string[] = [];
  try {
    const unreadMsgs = await Message.findAll({
      where: {
        ticketId: ticket.id,
        read: false,
        fromMe: false
      },
      attributes: ["id"]
    });
    unreadIds = unreadMsgs.map(m => m.id);
  } catch {}

  await Message.update(
    { read: true },
    {
      where: {
        ticketId: ticket.id,
        read: false
      }
    }
  );

  await ticket.update({ unreadMessages: 0 });

  try {
    if (ticket.whatsappId) {
      const chatId = ticket.contact.lid
        ? ticket.contact.lid
        : `${ticket.contact.number}@${ticket.isGroup ? "g" : "c"}.us`;

      await whatsappProvider.sendSeen(
        ticket.whatsappId,
        chatId,
        unreadIds
      );
    }
  } catch (err) {
    logger.warn(
      `Could not mark messages as read. Maybe whatsapp session disconnected? Err: ${err}`
    );
  }

  const io = getIO();
  io.to(ticket.status).to("notification").emit("ticket", {
    action: "updateUnread",
    ticketId: ticket.id
  });
};

export default SetTicketMessagesAsRead;

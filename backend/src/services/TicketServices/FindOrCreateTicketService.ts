import { subHours } from "date-fns";
import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import ShowTicketService from "./ShowTicketService";

const FindOrCreateTicketService = async (
  contact: Contact,
  whatsappId: number,
  unreadMessages: number,
  groupContact?: Contact
): Promise<Ticket> => {
  const targetContactId = groupContact ? groupContact.id : contact.id;

  let ticket = await Ticket.findOne({
    where: {
      status: {
        [Op.or]: ["open", "pending"]
      },
      contactId: targetContactId
    },
    order: [["updatedAt", "DESC"]]
  });

  if (ticket) {
    const newUnread = unreadMessages === 0 ? 0 : ((ticket.unreadMessages || 0) + unreadMessages);
    await ticket.update({
      unreadMessages: newUnread,
      whatsappId: whatsappId || ticket.whatsappId
    });
  }

  if (!ticket) {
    ticket = await Ticket.findOne({
      where: {
        contactId: targetContactId
      },
      order: [["updatedAt", "DESC"]]
    });

    if (ticket) {
      await ticket.update({
        status: "open",
        unreadMessages,
        whatsappId: whatsappId || ticket.whatsappId
      });
    }
  }

  if (!ticket) {
    ticket = await Ticket.create({
      contactId: targetContactId,
      status: "open",
      isGroup: !!groupContact,
      unreadMessages,
      whatsappId
    });
  }

  ticket = await ShowTicketService(ticket.id);

  return ticket;
};

export default FindOrCreateTicketService;

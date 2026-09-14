import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Whatsapp from "../../models/Whatsapp";
import GetProfilePicUrl from "../WbotServices/GetProfilePicUrl";

const ShowTicketService = async (id: string | number): Promise<Ticket> => {
  const ticket = await Ticket.findByPk(id, {
    include: [
      {
        model: Contact,
        as: "contact",
        attributes: ["id", "name", "number", "lid", "profilePicUrl"],
        include: ["extraInfo"]
      },
      {
        model: User,
        as: "user",
        attributes: ["id", "name"]
      },
      {
        model: Queue,
        as: "queue",
        attributes: ["id", "name", "color"]
      },
      {
        model: Whatsapp,
        as: "whatsapp",
        attributes: ["name"]
      }
    ]
  });

  if (!ticket) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  if (ticket.contact && !ticket.contact.profilePicUrl && ticket.contact.number) {
    try {
      const url = await GetProfilePicUrl(ticket.contact.number);
      if (url) {
        await ticket.contact.update({ profilePicUrl: url });
        ticket.contact.profilePicUrl = url;
      }
    } catch (e) {
      // Ignore failure to fetch profile pic
    }
  }

  return ticket;
};

export default ShowTicketService;

import Contact from "../../models/Contact";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import { cleanDigits, isLid, isRealPhoneNumber } from "../../helpers/PhoneNumberUtils";

interface Response {
  deletedCount: number;
}

const DeleteInvalidContactsService = async (): Promise<Response> => {
  const allContacts = await Contact.findAll();

  let deletedCount = 0;
  const io = getIO();

  for (const contact of allContacts) {
    if (contact.isGroup) continue;

    const rawNumber = contact.number;
    const digits = cleanDigits(rawNumber);

    const isInvalid =
      !rawNumber ||
      isLid(rawNumber) ||
      !isRealPhoneNumber(rawNumber) ||
      digits.length < 8 ||
      digits.length > 15 ||
      rawNumber.includes("@lid");

    if (isInvalid) {
      try {
        await contact.destroy();
        deletedCount++;
        io.emit("contact", {
          action: "delete",
          contactId: contact.id
        });
      } catch (err) {
        logger.error(`Error deleting invalid contact id ${contact.id}: ${err}`);
      }
    }
  }

  if (deletedCount > 0) {
    io.emit("contact", { action: "refresh" });
  }

  logger.info(`[CLEAN_INVALID] Deleted ${deletedCount} contacts with invalid/weird numbers.`);

  return { deletedCount };
};

export default DeleteInvalidContactsService;

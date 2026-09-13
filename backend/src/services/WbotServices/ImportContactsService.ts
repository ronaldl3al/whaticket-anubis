import { Op } from "sequelize";
import GetDefaultWhatsApp from "../../helpers/GetDefaultWhatsApp";
import { whatsappProvider } from "../../providers/WhatsApp";
import Contact from "../../models/Contact";
import { logger } from "../../utils/logger";
import { getIO } from "../../libs/socket";
import {
  cleanDigits,
  isLid,
  isRealPhoneNumber,
  normalizePhoneNumber,
  isValidContactName
} from "../../helpers/PhoneNumberUtils";

const ImportContactsService = async (
  userId: number
): Promise<{ total: number; updatedCount: number; createdCount: number }> => {
  const defaultWhatsapp = await GetDefaultWhatsApp(userId);

  let phoneContacts: any[] = [];

  try {
    phoneContacts = await whatsappProvider.getContacts(defaultWhatsapp.id);
  } catch (err) {
    logger.error(`Could not get whatsapp contacts from phone. Err: ${err}`);
  }

  let updatedCount = 0;
  let createdCount = 0;

  if (phoneContacts && Array.isArray(phoneContacts)) {
    const io = getIO();
    for (const { number: rawNumber, name: rawName } of phoneContacts) {
      if (!rawNumber) continue;

      if (isLid(rawNumber)) continue; // Skip raw LID entries in phone contact import

      const cleanNumber = normalizePhoneNumber(rawNumber);
      if (!cleanNumber || !isRealPhoneNumber(cleanNumber)) continue;

      const isValidName = isValidContactName(rawName, cleanNumber);
      const finalName = isValidName ? rawName.trim() : cleanNumber;

      const orConditions: any[] = [
        { number: cleanNumber }
      ];
      if (cleanNumber.length >= 8) {
        orConditions.push({ number: { [Op.like]: `%${cleanNumber.slice(-8)}` } });
      }

      try {
        const numberExists = await Contact.findOne({
          where: { [Op.or]: orConditions }
        });

        if (numberExists) {
          const updateData: any = {};
          if (isValidName && numberExists.name !== finalName) {
            updateData.name = finalName;
          } else if (!isValidName && (!isValidContactName(numberExists.name, numberExists.number) || isLid(numberExists.name))) {
            updateData.name = cleanNumber;
          }

          if (isRealPhoneNumber(cleanNumber) && (!isRealPhoneNumber(numberExists.number) || isLid(numberExists.number))) {
            updateData.number = cleanNumber;
          }

          if (Object.keys(updateData).length > 0) {
            await numberExists.update(updateData);
            updatedCount++;
            io.emit("contact", { action: "update", contact: numberExists });
          }
        } else {
          const created = await Contact.create({
            number: cleanNumber,
            name: finalName,
            isGroup: false
          });
          createdCount++;
          io.emit("contact", { action: "create", contact: created });
        }
      } catch (e) {
        logger.error({ info: "Error importing contact from whatsapp", err: e, cleanNumber });
      }
    }
  }

  logger.info(
    `[WSP_IMPORT] Finished importing: ${createdCount} created, ${updatedCount} updated, ${phoneContacts?.length || 0} total.`
  );

  return {
    total: phoneContacts?.length || 0,
    updatedCount,
    createdCount
  };
};

export default ImportContactsService;

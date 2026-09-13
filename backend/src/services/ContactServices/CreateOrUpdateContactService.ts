import { Op } from "sequelize";
import { getIO } from "../../libs/socket";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import { logger } from "../../utils/logger";
import {
  cleanDigits,
  isLid,
  isRealPhoneNumber,
  normalizePhoneNumber,
  isValidContactName
} from "../../helpers/PhoneNumberUtils";
import { resolveLidFromStores } from "../../providers/WhatsApp/Implementations/whaileys";

interface ExtraInfo {
  name: string;
  value: string;
}

interface Request {
  name: string;
  number: string;
  lid?: string;
  isGroup: boolean;
  email?: string;
  profilePicUrl?: string;
  extraInfo?: ExtraInfo[];
  isRegisteredName?: boolean;
}

const emitContact = (action: "update" | "create", contact: Contact) => {
  const io = getIO();

  io.emit("contact", { action, contact });
};

const CreateOrUpdateContactService = async ({
  name,
  number: rawNumber,
  lid: inputLid,
  profilePicUrl,
  isGroup,
  email = "",
  extraInfo = [],
  isRegisteredName = false
}: Request): Promise<Contact> => {
  let lid = inputLid;
  const isInputLid = isLid(rawNumber);
  let resolvedNumber = rawNumber;

  if (isInputLid) {
    const cleanLid = cleanDigits(rawNumber);
    if (!lid) lid = `${cleanLid}@lid`;

    const fromStore = resolveLidFromStores(cleanLid);
    if (fromStore?.phone) {
      resolvedNumber = fromStore.phone;
    }
  }

  const number = isGroup ? resolvedNumber : normalizePhoneNumber(resolvedNumber);
  if (!number && !lid) throw new Error("Either number or lid must be provided");

  const hasRegisteredName = isRegisteredName && isValidContactName(name, number, lid);
  const validName = hasRegisteredName
    ? name.trim()
    : isValidContactName(name, number, lid)
    ? name.trim()
    : isRealPhoneNumber(number)
    ? number
    : number || lid || "";

  const orConditions: any[] = [];
  if (number) {
    orConditions.push({ number });
    if (number.length >= 8) {
      orConditions.push({ number: { [Op.like]: `%${number.slice(-8)}` } });
    }
  }

  const [contactByNumber, contactByLid] = await Promise.all([
    orConditions.length > 0 ? Contact.findOne({ where: { [Op.or]: orConditions } }) : null,
    lid ? Contact.findOne({ where: { lid } }) : null
  ]);

  const shouldMerge =
    contactByNumber && contactByLid && contactByNumber.id !== contactByLid.id;

  if (shouldMerge) {
    await Ticket.update(
      { contactId: contactByNumber.id },
      { where: { contactId: contactByLid.id } }
    );

    await contactByLid.destroy();

    const mergeUpdate: any = {
      lid: contactByLid.lid,
      profilePicUrl: profilePicUrl || contactByNumber.profilePicUrl
    };
    const shouldUpdateName = (currentName?: string): boolean => {
      if (!validName || validName === number || validName === lid) return false;
      if (isRegisteredName) return true;
      return (
        !currentName ||
        currentName === number ||
        currentName === lid ||
        /^[.\-_*~,#@!?:;'"\\/\s]+$/.test(currentName)
      );
    };

    if (shouldUpdateName(contactByNumber.name)) {
      mergeUpdate.name = validName;
    }
    await contactByNumber.update(mergeUpdate);

    logger.info({
      info: "Merged contacts by number and lid",
      primaryContactId: contactByNumber.id,
      mergedContactId: contactByLid.id
    });

    emitContact("update", contactByNumber);

    return contactByNumber;
  }

  const shouldUpdateName = (currentName?: string): boolean => {
    if (!validName || validName === number || validName === lid) return false;
    if (isRegisteredName) return true;
    return (
      !currentName ||
      currentName === number ||
      currentName === lid ||
      /^[.\-_*~,#@!?:;'"\\/\s]+$/.test(currentName)
    );
  };

  if (contactByNumber) {
    const updateData: any = {
      lid: lid || contactByNumber.lid,
      profilePicUrl: profilePicUrl || contactByNumber.profilePicUrl
    };
    if (
      isRealPhoneNumber(number) &&
      (!isRealPhoneNumber(contactByNumber.number) || isLid(contactByNumber.number))
    ) {
      updateData.number = number;
    }
    if (shouldUpdateName(contactByNumber.name)) {
      updateData.name = validName;
    }
    await contactByNumber.update(updateData);

    emitContact("update", contactByNumber);

    return contactByNumber;
  }

  if (contactByLid) {
    const updateData: any = {
      profilePicUrl: profilePicUrl || contactByLid.profilePicUrl
    };
    if (isRealPhoneNumber(number) || !contactByLid.number) {
      updateData.number = number;
    }
    if (shouldUpdateName(contactByLid.name)) {
      updateData.name = validName;
    }
    await contactByLid.update(updateData);

    emitContact("update", contactByLid);
    return contactByLid;
  }

  const created = await Contact.create({
    name: validName,
    number,
    lid,
    profilePicUrl,
    email,
    isGroup,
    extraInfo
  });

  emitContact("create", created);
  return created;
};

export default CreateOrUpdateContactService;

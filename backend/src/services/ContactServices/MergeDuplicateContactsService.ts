import { Op } from "sequelize";
import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import ContactCustomField from "../../models/ContactCustomField";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import {
  cleanDigits,
  isLid,
  isRealPhoneNumber,
  normalizePhoneNumber,
  isValidContactName
} from "../../helpers/PhoneNumberUtils";
import { resolveLidFromStores } from "../../providers/WhatsApp/Implementations/whaileys";

export interface MergeReport {
  totalScanned: number;
  duplicatesMerged: number;
  lidsResolved: number;
  remainingContacts: number;
}

export const MergeDuplicateContactsService = async (): Promise<MergeReport> => {
  const io = getIO();
  const allContacts = await Contact.findAll({
    include: [{ model: ContactCustomField, as: "extraInfo" }],
    order: [["id", "ASC"]]
  });

  const totalScanned = allContacts.length;
  let duplicatesMerged = 0;
  let lidsResolved = 0;

  logger.info(`[MERGE] Starting duplicate and LID audit across ${totalScanned} contacts...`);

  // Step 1: Resolve standalone LID numbers in Contact.number if possible
  for (const contact of allContacts) {
    if (contact.isGroup) continue;

    const currentNumber = contact.number;
    if (isLid(currentNumber)) {
      const cleanLidDigits = cleanDigits(currentNumber);
      const targetLidJid = `${cleanLidDigits}@lid`;

      // 1. Check if another contact in DB has this LID in its lid column and a real phone
      const matchInDb = allContacts.find(
        c =>
          c.id !== contact.id &&
          (c.lid === targetLidJid || cleanDigits(c.lid) === cleanLidDigits) &&
          isRealPhoneNumber(c.number)
      );

      let realPhone = matchInDb ? normalizePhoneNumber(matchInDb.number) : undefined;
      let registeredName =
        matchInDb && isValidContactName(matchInDb.name, matchInDb.number, matchInDb.lid)
          ? matchInDb.name
          : undefined;

      // 2. If not found in DB, check WhatsApp stores
      if (!realPhone) {
        const fromStore = resolveLidFromStores(cleanLidDigits);
        if (fromStore?.phone) {
          realPhone = normalizePhoneNumber(fromStore.phone);
          if (fromStore.name && isValidContactName(fromStore.name, realPhone)) {
            registeredName = fromStore.name;
          }
        }
      }

      if (realPhone) {
        const existingRealContact = allContacts.find(
          c => c.id !== contact.id && normalizePhoneNumber(c.number) === realPhone
        );

        if (!existingRealContact) {
          contact.number = realPhone;
          if (!contact.lid) {
            contact.lid = targetLidJid;
          }
          if (registeredName) {
            contact.name = registeredName;
          } else if (!isValidContactName(contact.name, contact.number, contact.lid)) {
            contact.name = realPhone;
          }
          await contact.save();
          io.emit("contact", { action: "update", contact });
          lidsResolved++;
          logger.info(
            `[MERGE] Converted standalone LID contact id=${contact.id} (${cleanLidDigits}) to real phone ${realPhone}`
          );
        }
      }
    }
  }

  // Step 2: Reload contacts and build grouping map
  const currentContacts = await Contact.findAll({
    include: [{ model: ContactCustomField, as: "extraInfo" }],
    order: [["id", "ASC"]]
  });

  const groups = new Map<string, Contact[]>();

  for (const contact of currentContacts) {
    if (contact.isGroup) continue;

    const norm = normalizePhoneNumber(contact.number);
    let groupKey: string;

    if (isLid(contact.number)) {
      const cleanLidDigits = cleanDigits(contact.number);
      const fromStore = resolveLidFromStores(cleanLidDigits);
      if (fromStore?.phone) {
        groupKey = `PHONE:${normalizePhoneNumber(fromStore.phone)}`;
      } else {
        const matched = currentContacts.find(
          c =>
            c.id !== contact.id &&
            cleanDigits(c.lid) === cleanLidDigits &&
            isRealPhoneNumber(c.number)
        );
        if (matched) {
          groupKey = `PHONE:${normalizePhoneNumber(matched.number)}`;
        } else {
          groupKey = `LID:${cleanLidDigits}`;
        }
      }
    } else if (norm) {
      groupKey = `PHONE:${norm}`;
    } else {
      groupKey = `ID:${contact.id}`;
    }

    const list = groups.get(groupKey) || [];
    list.push(contact);
    groups.set(groupKey, list);
  }

  // Step 3: Process duplicate groups
  for (const [key, groupList] of groups.entries()) {
    if (groupList.length <= 1) continue;

    // Pick Master Contact
    let bestScore = -Infinity;
    let master: Contact = groupList[0];

    for (const c of groupList) {
      let score = 0;
      const numDigits = cleanDigits(c.number);
      if (isRealPhoneNumber(c.number)) {
        score += 20;
        if (numDigits.startsWith("58")) score += 10;
      }
      if (isValidContactName(c.name, c.number, c.lid)) score += 5;
      if (c.profilePicUrl) score += 2;
      if (c.email) score += 1;
      score -= c.id / 10000;

      if (score > bestScore) {
        bestScore = score;
        master = c;
      }
    }

    const duplicates = groupList.filter(c => c.id !== master.id);

    for (const dup of duplicates) {
      logger.info(
        `[MERGE] Merging duplicate contact id=${dup.id} (${dup.name} / ${dup.number}) into master id=${master.id} (${master.name} / ${master.number})`
      );

      // Reassign tickets
      await Ticket.update(
        { contactId: master.id },
        { where: { contactId: dup.id } }
      );

      // Reassign messages
      await Message.update(
        { contactId: master.id },
        { where: { contactId: dup.id } }
      );

      // Merge custom fields
      if (dup.extraInfo && Array.isArray(dup.extraInfo)) {
        for (const field of dup.extraInfo) {
          const masterHasField = master.extraInfo?.some(
            mf => mf.name.toLowerCase() === field.name.toLowerCase()
          );
          if (!masterHasField) {
            await field.update({ contactId: master.id });
          } else {
            await field.destroy();
          }
        }
      }

      // Preserve attributes
      if (!master.lid && dup.lid) {
        master.lid = dup.lid;
      }
      if (!master.profilePicUrl && dup.profilePicUrl) {
        master.profilePicUrl = dup.profilePicUrl;
      }
      if (!master.email && dup.email) {
        master.email = dup.email;
      }
      if (
        !isValidContactName(master.name, master.number, master.lid) &&
        isValidContactName(dup.name, dup.number, dup.lid)
      ) {
        master.name = dup.name;
      }

      // Delete duplicate
      await dup.destroy();
      io.emit("contact", { action: "delete", contactId: dup.id });
      duplicatesMerged++;
    }

    // Standardize master
    const normalizedMasterNumber = normalizePhoneNumber(master.number);
    if (isRealPhoneNumber(normalizedMasterNumber) && master.number !== normalizedMasterNumber) {
      master.number = normalizedMasterNumber;
    }

    // Unregistered contacts display phone number
    if (!isValidContactName(master.name, master.number, master.lid)) {
      master.name = master.number;
    }

    await master.save();
    io.emit("contact", { action: "update", contact: master });
  }

  // Step 4: Final pass on remaining contacts to standardize number and name
  const remaining = await Contact.findAll();
  for (const c of remaining) {
    if (c.isGroup) continue;
    let changed = false;

    if (!isLid(c.number)) {
      const norm = normalizePhoneNumber(c.number);
      if (norm && norm !== c.number) {
        const conflict = remaining.find(o => o.id !== c.id && o.number === norm);
        if (!conflict) {
          c.number = norm;
          changed = true;
        }
      }
    }

    // If contact is not registered with a custom name, strictly show phone number
    if (!isValidContactName(c.name, c.number, c.lid)) {
      if (c.name !== c.number) {
        c.name = c.number;
        changed = true;
      }
    }

    if (changed) {
      await c.save();
      io.emit("contact", { action: "update", contact: c });
    }
  }

  logger.info(
    `[MERGE] Completed: ${duplicatesMerged} duplicates merged, ${lidsResolved} LIDs converted. Remaining: ${remaining.length - duplicatesMerged}`
  );

  return {
    totalScanned,
    duplicatesMerged,
    lidsResolved,
    remainingContacts: remaining.length - duplicatesMerged
  };
};

export default MergeDuplicateContactsService;

import { Op } from "sequelize";
import Contact from "../../models/Contact";
import { getIO } from "../../libs/socket";
import { logger } from "../../utils/logger";
import {
  isLid,
  isRealPhoneNumber,
  normalizePhoneNumber,
  isValidContactName
} from "../../helpers/PhoneNumberUtils";
import { resolveLidFromStores } from "../../providers/WhatsApp/Implementations/whaileys";

const GOOGLE_CSV_HEADER =
  "First Name,Middle Name,Last Name,Phonetic First Name,Phonetic Middle Name,Phonetic Last Name,Name Prefix,Name Suffix,Nickname,File As,Organization Name,Organization Title,Organization Department,Birthday,Notes,Photo,Labels,Phone 1 - Label,Phone 1 - Value";

const escapeCsv = (str: string | null | undefined): string => {
  if (!str) return "";
  const cleaned = String(str).replace(/"/g, '""');
  if (cleaned.includes(",") || cleaned.includes('"') || cleaned.includes("\n")) {
    return `"${cleaned}"`;
  }
  return cleaned;
};

export const ExportGoogleContactsService = async (
  filterType: "all" | "unregistered" = "all"
): Promise<string> => {
  const contacts = await Contact.findAll({
    order: [["name", "ASC"]]
  });

  const lines: string[] = [GOOGLE_CSV_HEADER];

  for (const contact of contacts) {
    if (contact.isGroup) continue;

    let phone = contact.number ? contact.number.replace(/\D/g, "") : "";
    if (isLid(phone)) {
      const fromStore = resolveLidFromStores(phone);
      if (fromStore?.phone) {
        phone = fromStore.phone;
      } else {
        continue;
      }
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone || !isRealPhoneNumber(normalizedPhone)) continue;

    const isUnregistered = !isValidContactName(contact.name, normalizedPhone, contact.lid);

    if (filterType === "unregistered" && !isUnregistered) {
      continue;
    }

    const phoneDisplay = `+${normalizedPhone}`;
    const firstName = isUnregistered ? normalizedPhone : contact.name;

    const row = [
      escapeCsv(firstName), // First Name
      "", // Middle Name
      "", // Last Name
      "", // Phonetic First Name
      "", // Phonetic Middle Name
      "", // Phonetic Last Name
      "", // Name Prefix
      "", // Name Suffix
      "", // Nickname
      "", // File As
      "", // Organization Name
      "", // Organization Title
      "", // Organization Department
      "", // Birthday
      escapeCsv(isUnregistered ? "Unregistered WhatsApp" : "Whaticket"), // Notes
      "", // Photo
      escapeCsv("* myContacts"), // Labels
      "Mobile", // Phone 1 - Label
      escapeCsv(phone) // Phone 1 - Value
    ];

    lines.push(row.join(","));
  }

  return lines.join("\r\n");
};

const parseCsvLine = (line: string): string[] => {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
};

export const ImportGoogleContactsService = async (
  csvData: string
): Promise<{ createdCount: number; updatedCount: number; total: number }> => {
  const lines = csvData
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { createdCount: 0, updatedCount: 0, total: 0 };
  }

  const cleanHeader = parseCsvLine(lines[0]).map(h =>
    h.replace(/^\uFEFF/, "").trim()
  );

  let firstNameIdx = cleanHeader.findIndex(h =>
    /first\s*name/i.test(h) || /^nombre/i.test(h)
  );
  let middleNameIdx = cleanHeader.findIndex(h => /middle\s*name/i.test(h));
  let lastNameIdx = cleanHeader.findIndex(h =>
    /last\s*name/i.test(h) || /^apellido/i.test(h)
  );

  // Priority 1: Match "Phone 1 - Value" specifically (avoids matching "Phone 1 - Label"!)
  let phoneIdx = cleanHeader.findIndex(
    h => /value/i.test(h) && /phone|tel/i.test(h)
  );

  // Priority 2: Match column with "phone" that does NOT have "label" or "type"
  if (phoneIdx === -1) {
    phoneIdx = cleanHeader.findIndex(
      h =>
        /phone|tel[eé]fono|celular|mobile/i.test(h) &&
        !/label|type|etiqueta|tipo/i.test(h)
    );
  }

  // Priority 3: Fallback to last column
  if (phoneIdx === -1) {
    phoneIdx = cleanHeader.length - 1;
  }

  if (firstNameIdx === -1) firstNameIdx = 0;
  if (lastNameIdx === -1) lastNameIdx = 2;

  let createdCount = 0;
  let updatedCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (!row || row.length === 0) continue;

    const firstName = row[firstNameIdx] || "";
    const middleName = middleNameIdx !== -1 ? row[middleNameIdx] || "" : "";
    const lastName = lastNameIdx !== -1 ? row[lastNameIdx] || "" : "";

    const fullName = [firstName, middleName, lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    // Try targeted column first
    let rawPhone = row[phoneIdx] || "";

    // If targeted column does not have at least 7 digits, search the entire row
    if (rawPhone.replace(/\D/g, "").length < 7) {
      for (let c = row.length - 1; c >= 0; c--) {
        const digits = (row[c] || "").replace(/\D/g, "");
        if (digits.length >= 7) {
          rawPhone = row[c];
          break;
        }
      }
    }

    if (!rawPhone) continue;

    // Handle multiple numbers separated by ':::' or '/'
    const phoneCandidates = rawPhone.split(/:::|\//);

    for (const cand of phoneCandidates) {
      const cleanNumber = cand.replace(/\D/g, "");
      if (!cleanNumber || cleanNumber.length < 7) continue;

      try {
        const last8 = cleanNumber.slice(-8);
        const orConditions: any[] = [
          { number: cleanNumber },
          { number: { [Op.like]: `%${last8}` } }
        ];
        if (cleanNumber.length === 10 && cleanNumber.startsWith("4")) {
          orConditions.push({ number: `58${cleanNumber}` });
        }

        const existing = await Contact.findOne({
          where: { [Op.or]: orConditions }
        });

        if (existing) {
          if (fullName && existing.name !== fullName) {
            await existing.update({ name: fullName });
            updatedCount++;
            getIO().emit("contact", { action: "update", contact: existing });
          }
        } else {
          const finalNum =
            cleanNumber.length === 10 && cleanNumber.startsWith("4")
              ? `58${cleanNumber}`
              : cleanNumber;

          const created = await Contact.create({
            name: fullName || finalNum,
            number: finalNum,
            isGroup: false
          });
          createdCount++;
          getIO().emit("contact", { action: "create", contact: created });
        }
      } catch (err) {
        logger.error({ info: "Error importing google contact row", err, cleanNumber });
      }
    }
  }

  logger.info(
    `[GOOGLE_SYNC] Processed: ${createdCount} created, ${updatedCount} updated.`
  );

  return {
    createdCount,
    updatedCount,
    total: createdCount + updatedCount
  };
};

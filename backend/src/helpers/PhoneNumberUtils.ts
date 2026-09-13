/**
 * Utilities for WhatsApp Phone Number formatting and LID resolution
 */

export const cleanDigits = (val?: string | null): string => {
  if (!val) return "";
  return String(val).replace(/\D/g, "");
};

/**
 * Checks if a JID or number string is a WhatsApp LID (Local Identifier).
 * WhatsApp LIDs are 14-16 digits, typically starting with 10, 11, or 12.
 */
export const isLid = (val?: string | null): boolean => {
  if (!val) return false;
  const str = String(val).trim();
  if (str.includes("@lid")) return true;
  const digits = cleanDigits(str);
  return digits.length >= 14 && digits.length <= 16 && /^1[0-2]/.test(digits);
};

/**
 * Checks if a string represents a real mobile or landline phone number (not a LID).
 */
export const isRealPhoneNumber = (val?: string | null): boolean => {
  if (!val) return false;
  if (isLid(val)) return false;
  const digits = cleanDigits(val);
  return digits.length >= 8 && digits.length <= 13;
};

/**
 * Normalizes phone numbers to standard international format (E.164 without leading '+').
 * Specifically handles Venezuelan formats:
 * - 04242849560 (11 digits, starts with 04) -> 584242849560
 * - 4242849560 (10 digits, starts with 4)  -> 584242849560
 * - 584242849560 (12 digits, starts with 58) -> 584242849560
 */
export const normalizePhoneNumber = (val?: string | null): string => {
  if (!val) return "";
  const digits = cleanDigits(val);
  if (!digits) return "";

  // If it's a LID, return original digits without modifying prefix
  if (isLid(val)) {
    return digits;
  }

  // Venezuelan 11 digits: 0412..., 0414..., 0424..., 0416..., 0426...
  if (digits.length === 11 && digits.startsWith("04")) {
    return `58${digits.slice(1)}`;
  }

  // Venezuelan 10 digits: 412..., 414..., 424..., 416..., 426...
  if (digits.length === 10 && digits.startsWith("4")) {
    return `58${digits}`;
  }

  // Already 12 digits starting with 58
  if (digits.length === 12 && digits.startsWith("58")) {
    return digits;
  }

  return digits;
};

/**
 * Validates whether a contact name is a real custom name saved in address book,
 * or just a placeholder (number, LID, punctuation).
 */
export const isValidContactName = (
  name?: string | null,
  number?: string | null,
  lid?: string | null
): boolean => {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed.length === 0) return false;

  // Reject punctuation-only names
  if (/^[.\-_*~,#@!?:;'"\\/\s]+$/.test(trimmed)) return false;

  const cleanNum = cleanDigits(number);
  const cleanLidVal = cleanDigits(lid);
  const cleanNameVal = cleanDigits(trimmed);

  // If the name is purely numeric or phone-like (e.g. +58 424..., 0424..., 105364...)
  if (/^\+?\d[\d\s\-().]{5,}$/.test(trimmed)) {
    const normName = normalizePhoneNumber(cleanNameVal);
    const normNum = normalizePhoneNumber(cleanNum);
    if (normName === normNum || cleanNameVal === cleanNum) return false;
    // Any valid phone number or LID used as a name is not a real contact name
    if (isRealPhoneNumber(cleanNameVal) || isLid(cleanNameVal)) return false;
  }

  // Reject if name equals the number or clean number
  if (number && (trimmed === number || cleanNameVal === cleanNum)) return false;

  // Reject if normalized name matches normalized number
  if (number && normalizePhoneNumber(cleanNameVal) === normalizePhoneNumber(cleanNum)) return false;

  // Reject if name equals the LID
  if (lid && (trimmed === lid || cleanNameVal === cleanLidVal)) return false;

  // Reject if name itself is a LID (e.g. 105364137758858)
  if (isLid(trimmed)) return false;

  return true;
};

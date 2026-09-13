import { readFileSync } from "fs";

import pino from "pino";
import makeWASocket, {
  UserFacingSocketConfig,
  DisconnectReason,
  WASocket,
  AuthenticationCreds,
  initAuthCreds,
  isJidUser,
  isLidUser,
  isJidGroup,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  BufferJSON,
  WAMessage,
  WAMessageKey,
  downloadMediaMessage,
  getContentType,
  jidNormalizedUser,
  jidDecode,
  makeInMemoryStore,
  SignalDataSet,
  AnyMessageContent,
  proto,
  Browsers,
  fetchLatestWaWebVersion,
  WAVersion,
  MessageRetryMap
} from "whaileys";
import { LRUCache } from "lru-cache";
import { Boom } from "@hapi/boom";
import { HttpsProxyAgent } from "https-proxy-agent";
import NodeCache from "node-cache";
import { resolve } from "path";
import { Op } from "sequelize";
import Whatsapp from "../../../models/Whatsapp";
import Contact from "../../../models/Contact";
import Message from "../../../models/Message";
import Ticket from "../../../models/Ticket";
import WppKey from "../../../models/WppKey";
import { getIO } from "../../../libs/socket";
import { logger } from "../../../utils/logger";
import AppError from "../../../errors/AppError";
import StoreWppSessionKeys from "../../../services/WppKeyServices/StoreWppSessionKeys";
import GetWppSessionKeys from "../../../services/WppKeyServices/GetWppSessionKeys";
import { getRedisClient } from "../../../libs/redisStore";
import {
  SendMessageOptions,
  ProviderMessage,
  ProviderMediaInput,
  SendMediaOptions,
  ProviderContact,
  MessageType,
  MessageAck
} from "../types";
import { WhatsappProvider } from "../whatsappProvider";
import { sleep } from "../../../utils/sleep";
import {
  handleMessage,
  handleMessageAck,
  ContactPayload,
  MessagePayload,
  MediaPayload,
  WhatsappContextPayload
} from "../../../handlers/handleWhatsappEvents";
import {
  cleanDigits,
  isLid,
  isRealPhoneNumber,
  normalizePhoneNumber,
  isValidContactName
} from "../../../helpers/PhoneNumberUtils";

type WALogger = NonNullable<Parameters<typeof makeInMemoryStore>[0]["logger"]>;

const whaileyLogger = pino({
  level: process.env.WHAILEYS_LOG_LEVEL || "silent"
}) as unknown as WALogger;

type Store = ReturnType<typeof makeInMemoryStore>;

interface Session extends WASocket {
  id: number;
  store?: Store;
}

const sessions = new Map<number, Session>();
const stores = new Map<number, Store>();

export const resolveLidFromStores = (
  lidOrNumber: string
): { phone?: string; name?: string } | undefined => {
  const clean = cleanDigits(lidOrNumber);
  if (!clean) return undefined;

  for (const store of stores.values()) {
    if (!store?.contacts) continue;
    for (const c of Object.values(store.contacts) as any[]) {
      if (!c) continue;
      const cLid = cleanDigits(c.lid);
      const cId = c.id || "";
      const cIdDigits = cleanDigits(cId);

      const isMatch =
        (cLid && cLid === clean) ||
        (cId.includes("@lid") && cIdDigits === clean);

      if (isMatch) {
        if (cId.includes("@s.whatsapp.net")) {
          const phone = cleanDigits(cId);
          if (isRealPhoneNumber(phone)) {
            return { phone, name: c.name || c.verifiedName };
          }
        }
        if (c.phoneNumber) {
          const phone = cleanDigits(c.phoneNumber);
          if (isRealPhoneNumber(phone)) {
            return { phone, name: c.name || c.verifiedName };
          }
        }
      }

      if (cLid && cLid === clean && cId && !cId.includes("@lid")) {
        const phone = cleanDigits(cId);
        if (isRealPhoneNumber(phone)) {
          return { phone, name: c.name || c.verifiedName };
        }
      }
    }
  }
  return undefined;
};

const msgRetryCounterLRU = new LRUCache<string, number>({
  max: 5000,
  ttl: 600 * 1000,
  allowStale: false,
  updateAgeOnGet: true
});

const msgRetryCounterMap = new Proxy<MessageRetryMap>({} as MessageRetryMap, {
  get(target, prop) {
    if (typeof prop === "string") {
      return msgRetryCounterLRU.get(prop);
    }
    return Reflect.get(target, prop);
  },
  set(target, prop, value) {
    if (typeof prop === "string" && typeof value === "number") {
      msgRetryCounterLRU.set(prop, value);
      return true;
    }
    return Reflect.set(target, prop, value);
  },
  deleteProperty(target, prop) {
    if (typeof prop === "string") {
      msgRetryCounterLRU.delete(prop);
      return true;
    }
    return Reflect.deleteProperty(target, prop);
  },
  has(target, prop) {
    if (typeof prop === "string") {
      return msgRetryCounterLRU.has(prop);
    }
    return Reflect.has(target, prop);
  },
  ownKeys() {
    return Array.from(msgRetryCounterLRU.keys());
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === "string" && msgRetryCounterLRU.has(prop)) {
      return {
        configurable: true,
        enumerable: true,
        value: msgRetryCounterLRU.get(prop)
      };
    }
    return undefined;
  }
});

const msgCacheLRU = new LRUCache<string, string>({
  max: 5000,
  ttl: 600 * 1000,
  allowStale: false,
  updateAgeOnGet: true
});

const sentMessagesCache = new NodeCache({
  stdTTL: 60,
  useClones: false
});

const normalizeJid = (jid: string): string => {
  if (!jid) return jid;
  if (!jid.includes("@")) return `${jid}@s.whatsapp.net`;
  return jid.replace(/@c\.us$/i, "@s.whatsapp.net");
};

const msgCache = {
  get: (key: WAMessageKey): proto.IMessage | undefined => {
    const { id } = key;
    if (!id) return undefined;
    const data = msgCacheLRU.get(id);
    if (data) {
      try {
        const msg = JSON.parse(data);
        return msg?.message;
      } catch {
        return undefined;
      }
    }
    return undefined;
  },
  save: (msg: WAMessage) => {
    const { id } = msg.key;
    if (!id) return;
    try {
      msgCacheLRU.set(id, JSON.stringify(msg));
    } catch (e) {
      logger.debug({ info: "Error caching message", messageId: id, err: e });
    }
  }
};

const clearSessionKeys = async (sessionId: number): Promise<void> => {
  try {
    await WppKey.destroy({ where: { connectionId: sessionId } });
    logger.info({ info: "Cleared WppKey database session keys", sessionId });
  } catch (err) {
    logger.error({ info: "Error clearing WppKey database session keys", sessionId, err });
  }

  const client = getRedisClient();
  if (!client) return;

  try {
    const match = `wpp:${sessionId}:*`;

    const scanAndDelete = async (cursor: string): Promise<void> => {
      const [nextCursor, keys] = await client.scan(
        cursor,
        "MATCH",
        match,
        "COUNT",
        100
      );

      if (keys.length > 0) {
        await client.del(keys);
      }

      if (nextCursor !== "0") {
        await scanAndDelete(nextCursor);
      }
    };

    await scanAndDelete("0");

    logger.info({ info: "Cleared Redis session keys", sessionId });
  } catch (err) {
    logger.error({ info: "Error clearing Redis session keys", sessionId, err });
  }
};

const assertUnique = (sessionId: number) => {
  const wbot = sessions.get(sessionId);

  if (wbot) {
    wbot.ev.removeAllListeners("connection.update");
    sessions.delete(sessionId);
    stores.delete(sessionId);

    wbot.end(undefined);
  }
};

const saveSessionCreds = async (
  whatsapp: Whatsapp,
  creds: AuthenticationCreds
) => {
  try {
    const isPaired = Boolean(creds?.me?.id);
    const updateData: any = {
      session: JSON.stringify(creds, BufferJSON.replacer)
    };
    if (isPaired) {
      updateData.status = "CONNECTED";
      updateData.qrcode = "";
      updateData.retries = 0;
    }
    await whatsapp.update(updateData);

    logger.debug({
      info: "Creds saved to database",
      whatsappId: whatsapp.id,
      isPaired
    });
  } catch (err) {
    logger.error({
      info: "Error saving creds to database",
      whatsappId: whatsapp.id,
      err
    });
  }
};

const credsDebounceTimers = new Map<number, NodeJS.Timeout>();
const pendingCredsSaves = new Map<
  number,
  { whatsapp: Whatsapp; creds: AuthenticationCreds }
>();

const flushPendingCredsSave = async (sessionId: number): Promise<void> => {
  const existingTimer = credsDebounceTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    credsDebounceTimers.delete(sessionId);
  }

  const pending = pendingCredsSaves.get(sessionId);
  if (pending) {
    pendingCredsSaves.delete(sessionId);
    await saveSessionCreds(pending.whatsapp, pending.creds);
  }
};

const debouncedSaveCreds = (
  whatsapp: Whatsapp,
  creds: AuthenticationCreds,
  delayMs = 1000
) => {
  const sessionId = whatsapp.id;

  const existingTimer = credsDebounceTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  pendingCredsSaves.set(sessionId, { whatsapp, creds });

  const timer = setTimeout(() => {
    credsDebounceTimers.delete(sessionId);
    pendingCredsSaves.delete(sessionId);
    saveSessionCreds(whatsapp, creds);
  }, delayMs);

  credsDebounceTimers.set(sessionId, timer);
};

const useSessionAuthState = async (whatsapp: Whatsapp) => {
  const sessionId = whatsapp.id;

  const creds = whatsapp.session
    ? JSON.parse(whatsapp.session, BufferJSON.reviver)
    : initAuthCreds();

  return {
    state: {
      creds: creds as AuthenticationCreds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const deviceId = jidDecode(creds?.me?.id)?.device || 1;

          const data = await GetWppSessionKeys({
            connectionId: sessionId,
            deviceId,
            type,
            ids
          });

          return data;
        },
        set: async (data: SignalDataSet) => {
          const deviceId = jidDecode(creds?.me?.id)?.device || 1;

          try {
            const promises: Promise<void>[] = [];

            Object.entries(data).forEach(([category, categoryData]) => {
              if (!categoryData) return;
              Object.entries(categoryData).forEach(([id, value]) => {
                promises.push(
                  StoreWppSessionKeys({
                    connectionId: sessionId,
                    deviceId,
                    type: category,
                    id,
                    value
                  })
                );
              });
            });

            await Promise.all(promises);
          } catch (err) {
            logger.error({
              info: "Error setting keys",
              sessionId,
              err
            });
          }
        }
      }
    }
  };
};

const getRealMessage = (msg: WAMessage) => {
  let content = msg.message;
  if (!content) return undefined;
  if (content.ephemeralMessage) {
    content = content.ephemeralMessage.message;
  }
  if (content?.viewOnceMessage) {
    content = content.viewOnceMessage.message;
  }
  if (content?.viewOnceMessageV2) {
    content = content.viewOnceMessageV2.message;
  }
  if (content?.viewOnceMessageV2Extension) {
    content = content.viewOnceMessageV2Extension.message;
  }
  if (content?.documentWithCaptionMessage) {
    content = content.documentWithCaptionMessage.message;
  }
  return content;
};

const mapMessageType = (msg: WAMessage): MessageType => {
  const content = getRealMessage(msg);
  const messageType = getContentType(content || undefined);

  if (messageType === "audioMessage" && content?.audioMessage?.ptt) {
    return "ptt";
  }

  const typeMap: Record<string, MessageType> = {
    conversation: "chat",
    extendedTextMessage: "chat",
    imageMessage: "image",
    videoMessage: "video",
    audioMessage: "audio",
    documentMessage: "document",
    stickerMessage: "sticker",
    locationMessage: "location",
    contactMessage: "vcard",
    contactsArrayMessage: "vcard"
  };

  return typeMap[messageType || ""] || "chat";
};

const getMessageBody = (msg: WAMessage): string => {
  try {
    const content = getRealMessage(msg);
    const messageType = getContentType(content || undefined);

    if (messageType === "conversation") {
      return content?.conversation || "";
    }

    if (messageType === "extendedTextMessage") {
      return content?.extendedTextMessage?.text || "";
    }

    if (messageType === "imageMessage") {
      return content?.imageMessage?.caption || "";
    }

    if (messageType === "videoMessage") {
      return content?.videoMessage?.caption || "";
    }

    if (messageType === "documentMessage") {
      return content?.documentMessage?.caption || "";
    }

    if (messageType === "contactMessage") {
      return content?.contactMessage?.vcard || "";
    }

    if (messageType === "contactsArrayMessage") {
      const contacts = content?.contactsArrayMessage?.contacts || [];
      return contacts.map(c => c.vcard).join("\n");
    }

    if (messageType === "locationMessage") {
      const location = content?.locationMessage;
      if (!location) return "";

      const gmapsUrl = `https://maps.google.com/maps?q=${location.degreesLatitude}%2C${location.degreesLongitude}&z=17&hl=pt-BR`;
      const description =
        location.name ||
        `${location.degreesLatitude}, ${location.degreesLongitude}`;

      return `${gmapsUrl}|${description}`;
    }

    if (content?.templateMessage) {
      const tm = content.templateMessage;
      return (
        tm.hydratedTemplate?.hydratedContentText ||
        tm.hydratedFourRowTemplate?.hydratedContentText ||
        ""
      );
    }

    if (content?.interactiveMessage) {
      return content.interactiveMessage.body?.text || "";
    }

    if (content?.buttonsResponseMessage) {
      return (
        content.buttonsResponseMessage.selectedDisplayText ||
        content.buttonsResponseMessage.selectedButtonId ||
        ""
      );
    }

    if (content?.listResponseMessage) {
      return (
        content.listResponseMessage.title ||
        content.listResponseMessage.description ||
        ""
      );
    }

    if (content?.templateButtonReplyMessage) {
      return content.templateButtonReplyMessage.selectedDisplayText || "";
    }

    return "";
  } catch (err) {
    logger.error({ info: "Error getting message body", err });
    return "";
  }
};

const getQuotedMessageId = (msg: WAMessage): string | undefined => {
  const content = getRealMessage(msg);
  const quotedMessageId =
    content?.extendedTextMessage?.contextInfo?.stanzaId ||
    content?.imageMessage?.contextInfo?.stanzaId ||
    content?.videoMessage?.contextInfo?.stanzaId ||
    content?.documentMessage?.contextInfo?.stanzaId ||
    undefined;

  return quotedMessageId;
};

const hasMedia = (msg: WAMessage): boolean => {
  const content = getRealMessage(msg);
  const messageType = getContentType(content || undefined);
  return [
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage"
  ].includes(messageType || "");
};

const mapMessageAck = (status: number | null | undefined): MessageAck => {
  if (status === null || status === undefined) return 0;
  if (status >= 4) return 4;
  if (status >= 3) return 3;
  if (status >= 2) return 2;
  if (status >= 1) return 1;
  return 0;
};

const shouldHandleMessage = (msg: WAMessage): boolean => {
  const content = getRealMessage(msg);
  const messageType = getContentType(content || undefined);
  const validTypes = [
    "conversation",
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "documentMessage",
    "stickerMessage",
    "locationMessage",
    "contactMessage",
    "contactsArrayMessage",
    "templateMessage",
    "interactiveMessage",
    "buttonsResponseMessage",
    "listResponseMessage",
    "templateButtonReplyMessage"
  ];

  if (!validTypes.includes(messageType || "")) return false;

  const body = getMessageBody(msg);
  if (body && /\u200e/.test(body[0])) return false;

  if (!msg.key.fromMe) return true;

  const allowedFromMeTypes = [
    "locationMessage",
    "conversation",
    "extendedTextMessage",
    "contactMessage",
    "templateMessage",
    "interactiveMessage"
  ];

  return hasMedia(msg) || allowedFromMeTypes.includes(messageType || "");
};

const convertToMessagePayload = (msg: WAMessage): MessagePayload => {
  const fromJid = msg.key.remoteJid || "";
  const toJid = msg.key.fromMe ? fromJid : msg.key.participant || fromJid;
  const fromMe = msg.key.fromMe || false;

  return {
    id: msg.key.id || "",
    body: getMessageBody(msg),
    fromMe,
    hasMedia: hasMedia(msg),
    type: mapMessageType(msg),
    timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : Date.now(),
    from: fromJid,
    to: toJid,
    hasQuotedMsg: Boolean(getQuotedMessageId(msg)),
    quotedMsgId: getQuotedMessageId(msg),
    ack: fromMe ? 1 : 0
  };
};

type ExtendedKey = WAMessageKey &
  Partial<{
    senderPn: string;
    sender_pn: string;
    participantPn: string;
    participant_pn: string;
    peerRecipientPn: string;
    peer_recipient_pn: string;
    senderLid: string;
    sender_lid: string;
    participantLid: string;
    participant_lid: string;
    recipientLid: string;
    recipient_lid: string;
  }>;

type ExtendedContext = proto.IContextInfo &
  Partial<{
    senderLid: string;
    sender_lid: string;
    participantLid: string;
    participant_lid: string;
    recipientLid: string;
    recipient_lid: string;
    senderPn: string;
    sender_pn: string;
    participantPn: string;
    participant_pn: string;
    peerRecipientPn: string;
    peer_recipient_pn: string;
  }>;

const convertToContactPayload = async (
  jid: string,
  msg: WAMessage,
  wbot: Session
): Promise<ContactPayload> => {
  const keyExt = (msg.key || {}) as ExtendedKey;
  const content = getRealMessage(msg) || {};
  const ctx = (content?.extendedTextMessage?.contextInfo ||
    content?.imageMessage?.contextInfo ||
    content?.videoMessage?.contextInfo ||
    content?.documentMessage?.contextInfo ||
    content?.audioMessage?.contextInfo ||
    content?.stickerMessage?.contextInfo ||
    undefined) as ExtendedContext | undefined;

  let resolvedJid = jid || "";

  const lidCandidates: (string | undefined)[] = [
    keyExt.senderLid,
    keyExt.participantLid,
    keyExt.recipientLid,
    ctx?.senderLid,
    ctx?.participantLid,
    ctx?.recipientLid,
    keyExt.sender_lid,
    keyExt.participant_lid,
    keyExt.recipient_lid,
    ctx?.sender_lid,
    ctx?.participant_lid,
    ctx?.recipient_lid,
    (keyExt.senderPn || keyExt.sender_pn)?.includes("@lid")
      ? keyExt.senderPn || keyExt.sender_pn
      : undefined,
    (keyExt.participantPn || keyExt.participant_pn)?.includes("@lid")
      ? keyExt.participantPn || keyExt.participant_pn
      : undefined,
    (keyExt.peerRecipientPn || keyExt.peer_recipient_pn)?.includes("@lid")
      ? keyExt.peerRecipientPn || keyExt.peer_recipient_pn
      : undefined
  ];

  const lid = lidCandidates.find(
    cand => typeof cand === "string" && cand.includes("@lid")
  );

  const pnCandidates: (string | undefined)[] = [
    keyExt.senderPn || keyExt.sender_pn,
    keyExt.participantPn || keyExt.participant_pn,
    keyExt.peerRecipientPn || keyExt.peer_recipient_pn
  ];

  let preferPn = pnCandidates.find(
    v => typeof v === "string" && /@s\.whatsapp\.net$/i.test(v)
  );

  let recoveredContact;
  if (wbot.store?.contacts && resolvedJid.includes("@lid")) {
    recoveredContact = Object.values(wbot.store.contacts).find(
      c => c.lid === resolvedJid || c.id === resolvedJid || (lid && (c.lid === lid || c.id === lid))
    );
    if (!preferPn && recoveredContact?.id?.includes("@s.whatsapp.net")) {
      preferPn = recoveredContact.id;
    }
  }

  if (resolvedJid.endsWith("@lid") && preferPn) {
    resolvedJid = preferPn;
  } else if (
    resolvedJid &&
    !resolvedJid.endsWith("@s.whatsapp.net") &&
    !resolvedJid.endsWith("@g.us") &&
    preferPn
  ) {
    resolvedJid = preferPn;
  }

  const safeNormalized = (value?: string) => {
    if (!value) return "";
    try {
      return jidNormalizedUser(value);
    } catch {
      return value;
    }
  };

  const normalizedJid = safeNormalized(resolvedJid);

  let contactInfo =
    wbot.store?.contacts?.[resolvedJid] ||
    wbot.store?.contacts?.[normalizedJid] ||
    recoveredContact;

  const chatInfo =
    wbot.store?.chats?.get?.(resolvedJid) ||
    wbot.store?.chats?.get?.(normalizedJid);

  let profilePicUrl: string | undefined;

  if (normalizedJid) {
    try {
      const url = await wbot.profilePictureUrl(normalizedJid, "image");
      profilePicUrl = url || undefined;
    } catch (err) {
      logger.debug({
        info: "Could not get profile picture",
        jid: normalizedJid,
        err
      });
    }
  }

  if (isJidGroup(resolvedJid)) {
    const groupNumber = normalizedJid.split("@")[0];
    const groupName =
      contactInfo?.name ||
      contactInfo?.notify ||
      chatInfo?.name ||
      (chatInfo as { subject?: string } | undefined)?.subject ||
      groupNumber;

    if (!contactInfo && (!groupName || groupName === groupNumber)) {
      try {
        const meta = await wbot.groupMetadata(normalizedJid);
        const metaName = typeof meta?.subject === "string" ? meta.subject : "";
        if (metaName) {
          return {
            name: metaName,
            number: groupNumber,
            isGroup: true,
            profilePicUrl
          };
        }
      } catch {
        /* ignore */
      }
    }

    return {
      name: groupName,
      number: groupNumber,
      isGroup: true,
      profilePicUrl
    };
  }

  const decoded = jidDecode(resolvedJid);

  const sessionPushName = wbot.user?.name?.trim().toLowerCase();
  const incomingPushName = msg.pushName?.trim();
  const pushName =
    incomingPushName &&
    sessionPushName &&
    incomingPushName.toLowerCase() === sessionPushName
      ? undefined
      : incomingPushName;

  let resolvedPhoneNumber =
    (isJidUser(resolvedJid) && decoded?.user) ||
    jidDecode(preferPn || "")?.user ||
    "";

  if (!resolvedPhoneNumber && isLidUser(resolvedJid)) {
    const fromStore = resolveLidFromStores(decoded?.user || normalizedJid);
    if (fromStore?.phone) {
      resolvedPhoneNumber = fromStore.phone;
    }
  }

  const rawUser = decoded?.user || normalizedJid.split("@")[0];
  const finalNumber = normalizePhoneNumber(resolvedPhoneNumber || rawUser);
  const lidValue =
    isLidUser(resolvedJid) && decoded?.user ? `${decoded.user}@lid` : lid;

  let dbContactName = "";
  try {
    const orConditions: any[] = [];
    if (finalNumber) {
      orConditions.push({ number: finalNumber });
      if (finalNumber.length >= 8) {
        orConditions.push({ number: { [Op.like]: `%${finalNumber.slice(-8)}` } });
      }
    }
    if (lidValue) {
      orConditions.push({ lid: lidValue });
    }

    if (orConditions.length > 0) {
      const existingDb = await Contact.findOne({
        where: { [Op.or]: orConditions }
      });
      if (
        existingDb &&
        isValidContactName(existingDb.name, finalNumber, lidValue)
      ) {
        dbContactName = existingDb.name;
      }
    }
  } catch {}

  const registeredName = isValidContactName(contactInfo?.name, finalNumber, lidValue)
    ? contactInfo?.name?.trim() || ""
    : "";
  const dbRegisteredName = (isValidContactName(dbContactName, finalNumber, lidValue) && !isRealPhoneNumber(dbContactName))
    ? dbContactName
    : "";

  // Strictly prioritize registered address book name.
  // If not registered in phonebook, strictly fallback to clean phone number (never pushName, never LID)
  const name =
    registeredName ||
    dbRegisteredName ||
    (isRealPhoneNumber(finalNumber) ? finalNumber : (finalNumber || ""));

  return {
    name,
    number: finalNumber,
    lid: lidValue,
    isGroup: false,
    profilePicUrl
  };
};

const convertToMediaPayload = async (
  msg: WAMessage,
  wbot: Session
): Promise<MediaPayload | undefined> => {
  if (!hasMedia(msg)) return undefined;

  try {
    const content = getRealMessage(msg);
    if (!content) return undefined;

    const messageType = getContentType(content || undefined);
    if (!messageType) return undefined;

    const mediaMessage = content[messageType];
    if (!mediaMessage || typeof mediaMessage !== 'object') return undefined;

    let mediaTypeStr = messageType.replace("Message", "");
    if (mediaTypeStr === "documentWithCaption") mediaTypeStr = "document";

    const { downloadContentFromMessage } = require("whaileys");
    const stream = await downloadContentFromMessage(
      mediaMessage,
      mediaTypeStr as any
    );

    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const getExtension = (mimetype: string, fallback: string): string =>
      mimetype.split("/")[1]?.split(";")[0] || fallback;

    if (messageType === "imageMessage") {
      const mimetype = content?.imageMessage?.mimetype || "image/jpeg";
      return {
        filename: `image-${Date.now()}.${getExtension(mimetype, "jpg")}`,
        mimetype,
        data: buffer.toString("base64")
      };
    }

    if (messageType === "videoMessage") {
      const mimetype = content?.videoMessage?.mimetype || "video/mp4";
      return {
        filename: `video-${Date.now()}.${getExtension(mimetype, "mp4")}`,
        mimetype,
        data: buffer.toString("base64")
      };
    }

    if (messageType === "audioMessage") {
      const mimetype =
        content?.audioMessage?.mimetype || "audio/ogg; codecs=opus";
      return {
        filename: `audio-${Date.now()}.ogg`,
        mimetype,
        data: buffer.toString("base64")
      };
    }

    if (messageType === "documentMessage") {
      const docMsg = content?.documentMessage;
      const mimetype = docMsg?.mimetype || "application/octet-stream";
      const ext = getExtension(mimetype, "bin");
      return {
        filename: docMsg?.title || `document-${Date.now()}.${ext}`,
        mimetype,
        data: buffer.toString("base64")
      };
    }

    if (messageType === "stickerMessage") {
      const mimetype = content?.stickerMessage?.mimetype || "image/webp";
      return {
        filename: `sticker-${Date.now()}.webp`,
        mimetype,
        data: buffer.toString("base64")
      };
    }

    return {
      filename: "",
      mimetype: "",
      data: buffer.toString("base64")
    };
  } catch (err) {
    logger.error({
      info: "Error downloading media",
      err,
      messageId: msg.key.id
    });

    return undefined;
  }
};

const getMessageData = async (
  msg: WAMessage,
  wbot: Session
): Promise<{
  messagePayload: MessagePayload;
  contactPayload: ContactPayload;
  contextPayload: WhatsappContextPayload;
  mediaPayload: MediaPayload | undefined;
}> => {
  const remoteJid = msg.key.remoteJid || "";
  const isGroup = isJidGroup(remoteJid);

  let contactJid = remoteJid;
  let groupContact;

  if (!msg.key.fromMe && isGroup && msg.key.participant) {
    contactJid = msg.key.participant;
    groupContact = await convertToContactPayload(remoteJid, msg, wbot);
  }

  const contactPayload = await convertToContactPayload(contactJid, msg, wbot);
  const messagePayload = convertToMessagePayload(msg);
  const mediaPayload = await convertToMediaPayload(msg, wbot);

  const contextPayload: WhatsappContextPayload = {
    whatsappId: wbot.id,
    unreadMessages: 0,
    groupContact
  };

  return {
    messagePayload,
    contactPayload,
    contextPayload,
    mediaPayload
  };
};

const getWbot = (sessionId: number): Session => {
  const wbot = sessions.get(sessionId);

  if (!wbot) {
    throw new AppError("ERR_WAPP_NOT_INITIALIZED");
  }

  return wbot;
};

const removeSession = async (whatsappId: number): Promise<void> => {
  await flushPendingCredsSave(whatsappId);

  const wbot = sessions.get(whatsappId);
  if (wbot) {
    wbot.ev.removeAllListeners("connection.update");
    wbot.ev.removeAllListeners("creds.update");
    wbot.ev.removeAllListeners("messages.upsert");
    wbot.ev.removeAllListeners("messages.update");
    wbot.ev.removeAllListeners("message-receipt.update");
    wbot.ev.removeAllListeners("presence.update");
    wbot.ev.removeAllListeners("groups.upsert");
    wbot.ev.removeAllListeners("groups.update");
    wbot.ev.removeAllListeners("group-participants.update");
    wbot.ev.removeAllListeners("contacts.upsert");
    wbot.ev.removeAllListeners("contacts.update");
    wbot.ev.removeAllListeners("chats.upsert");
    wbot.ev.removeAllListeners("chats.update");
    wbot.ev.removeAllListeners("chats.delete");
    wbot.ev.removeAllListeners("blocklist.set");
    wbot.ev.removeAllListeners("blocklist.update");

    try {
      wbot.end(undefined);
    } catch (e) {
      logger.debug({ info: "Error ending wbot", err: e });
    }

    try {
      wbot.ws?.removeAllListeners?.();
      await wbot.ws?.close?.();
    } catch (e) {
      logger.debug({ info: "Error closing websocket", err: e });
    }
  }

  sessions.delete(whatsappId);
  stores.delete(whatsappId);
  clearSessionKeys(whatsappId).catch(() => {});
};

const init = async (whatsapp: Whatsapp): Promise<void> => {
  const sessionId = whatsapp.id;
  const io = getIO();

  try {
    const { state } = await useSessionAuthState(whatsapp);
  const store = makeInMemoryStore({ logger: whaileyLogger });
  stores.set(sessionId, store);

  const storeFilePath = resolve(__dirname, "..", "..", "..", "..", `baileys_store_${sessionId}.json`);
  try {
    store.readFromFile(storeFilePath);
    logger.info(`[STORE] Loaded Baileys store from ${storeFilePath}`);
  } catch {}

  setInterval(() => {
    try {
      store.writeToFile(storeFilePath);
    } catch {}
  }, 20000);

  let waVersionToUse: WAVersion | undefined;

  if (process.env.WA_SOCKET_VERSION) {
    try {
      const parsed = JSON.parse(process.env.WA_SOCKET_VERSION) as number[];
      if (Array.isArray(parsed) && parsed.length >= 3) {
        waVersionToUse = parsed as WAVersion;
        logger.info({
          info: "Using WA_SOCKET_VERSION from env",
          version: waVersionToUse.join(".")
        });
      }
    } catch {
      logger.warn({
        info: "Failed to parse WA_SOCKET_VERSION, fetching latest"
      });
    }
  }

  if (!waVersionToUse) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout fetching WA Web version")), 3000)
      );
      const fetchedVersionData: any = await Promise.race([
        fetchLatestWaWebVersion({}),
        timeoutPromise
      ]);
      if (fetchedVersionData?.version) {
        waVersionToUse = fetchedVersionData.version;
        logger.info({
          info: "Using latest WA Web version",
          version: waVersionToUse ? waVersionToUse.join(".") : ""
        });
      }
    } catch (e) {
      logger.warn({ info: "Failed to fetch latest WA version or timed out, using default" });
    }
  }

  const connOptions: UserFacingSocketConfig = {
    logger: whaileyLogger,
    browser: Browsers.ubuntu("Chrome"),
    emitOwnEvents: true,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(
        state.keys,
        whaileyLogger,
        new NodeCache({
          useClones: false,
          stdTTL: 60 * 60,
          checkperiod: 60 * 5
        })
      )
    },
    shouldSyncHistoryMessage: () => true,
    shouldIgnoreJid: jid => {
      if (typeof jid !== "string") return false;
      return (
        isJidBroadcast(jid) ||
        jid?.endsWith("newsletter") ||
        jid === "status@broadcast"
      );
    },
    syncFullHistory: false,
    version: waVersionToUse,
    msgRetryCounterMap,
    markOnlineOnConnect: false,
    fireInitQueries: true,
    generateHighQualityLinkPreview: true,
    linkPreviewImageThumbnailWidth: 192,
    defaultQueryTimeoutMs: 60_000,
    connectTimeoutMs: 25_000,
    retryRequestDelayMs: 500,
    transactionOpts: { maxCommitRetries: 10, delayBetweenTriesMs: 3000 },
    sentMessagesCache,
    getMessage: async (key: WAMessageKey) => {
      const cached = msgCache.get(key);
      if (cached) return cached;

      const msg = store.messages[key.remoteJid!]?.get(key.id!);
      if (msg?.message) return msg.message;

      return undefined;
    }
  };

  const proxyAddress = process.env.PROXY_ADDRESS || "";
  if (proxyAddress) {
    const proxyAuth = process.env.PROXY_AUTH || "";
    const proxyUrl = proxyAuth
      ? `http://${proxyAuth}@${proxyAddress}`
      : `http://${proxyAddress}`;

    connOptions.agent = new HttpsProxyAgent(proxyUrl);
    connOptions.fetchAgent = new HttpsProxyAgent(proxyUrl);
  }

  assertUnique(sessionId);

  const wbot = makeWASocket(connOptions) as Session;
  wbot.id = sessionId;
  wbot.store = store;

  store.bind(wbot.ev);

  sessions.set(sessionId, wbot);

  wbot.ev.on("creds.update", () => {
    debouncedSaveCreds(whatsapp, state.creds);
  });

  const syncContacts = async (contacts: any[]) => {
    try {
      let synced = 0;
      for (const contact of contacts) {
        if (!contact.id) continue;
        const rawId = contact.id;
        const isGroup = isJidGroup(rawId);
        const isUser = isJidUser(rawId);
        const isLidContact = isLidUser(rawId) || isLid(rawId);

        if (!isGroup && !isUser && !isLidContact) continue;

        const normalizedJid = jidNormalizedUser(rawId);
        const userPart = normalizedJid.split("@")[0];
        let cleanNumber = cleanDigits(userPart) || userPart;
        let lid = isLidContact ? normalizedJid : contact.lid;

        if (isLidContact) {
          let realPhone: string | undefined;
          if (contact.phoneNumber) {
            realPhone = cleanDigits(contact.phoneNumber);
          }
          if (!realPhone) {
            const fromStore = resolveLidFromStores(userPart);
            if (fromStore?.phone) realPhone = fromStore.phone;
          }
          if (realPhone) {
            cleanNumber = normalizePhoneNumber(realPhone);
          }
        } else {
          cleanNumber = normalizePhoneNumber(cleanNumber);
        }

        if (!cleanNumber && !lid) continue;

        const registeredName = isValidContactName(contact.name, cleanNumber, lid)
          ? contact.name.trim()
          : "";

        const orConditions: any[] = [];
        if (cleanNumber) {
          orConditions.push({ number: cleanNumber });
          if (cleanNumber.length >= 8) {
            orConditions.push({ number: { [Op.like]: `%${cleanNumber.slice(-8)}` } });
          }
        }
        if (lid) {
          orConditions.push({ lid });
        }

        const existing = await Contact.findOne({
          where: { [Op.or]: orConditions }
        });

        if (existing) {
          const updateData: any = {};

          if (registeredName && existing.name !== registeredName) {
            updateData.name = registeredName;
          } else if (!registeredName) {
            const existingIsPlaceholder =
              !existing.name ||
              existing.name === existing.number ||
              existing.name === existing.lid ||
              !isValidContactName(existing.name, existing.number, existing.lid);

            if (existingIsPlaceholder && existing.name !== cleanNumber && isRealPhoneNumber(cleanNumber)) {
              updateData.name = cleanNumber;
            }
          }

          if (
            isRealPhoneNumber(cleanNumber) &&
            (!isRealPhoneNumber(existing.number) || isLid(existing.number))
          ) {
            updateData.number = cleanNumber;
          }

          if (lid && existing.lid !== lid) {
            updateData.lid = lid;
          }

          if (Object.keys(updateData).length > 0) {
            await existing.update(updateData);
            getIO().emit("contact", { action: "update", contact: existing });
          }
        } else {
          const bestName = registeredName || (isRealPhoneNumber(cleanNumber) ? cleanNumber : (cleanNumber || userPart));
          const created = await Contact.create({
            name: bestName,
            number: cleanNumber || userPart,
            lid,
            isGroup
          });
          getIO().emit("contact", { action: "create", contact: created });
        }
        synced++;
      }
      if (synced > 0) {
        logger.info(`[SYNC] Successfully synced ${synced} contacts from WhatsApp phonebook.`);
      }
    } catch (err) {
      logger.error({ err }, "Error syncing contacts");
    }
  };

  const syncChats = async (chatsList: any[]) => {
    try {
      let syncedChats = 0;
      for (const chat of chatsList) {
        if (!chat || !chat.id) continue;
        const rawJid = chat.id;
        if (isJidBroadcast(rawJid) || rawJid.endsWith("newsletter")) continue;

        const normalizedJid = jidNormalizedUser(rawJid);
        const isGroup = isJidGroup(rawJid);
        const isLidChat = isLidUser(rawJid) || isLid(rawJid);
        const userPart = normalizedJid.split("@")[0];
        let cleanNumber = cleanDigits(userPart) || userPart;
        let resolvedLid = isLidChat ? normalizedJid : undefined;

        if (isLidChat) {
          const fromStore = resolveLidFromStores(userPart);
          if (fromStore?.phone) {
            cleanNumber = normalizePhoneNumber(fromStore.phone);
          }
        } else {
          cleanNumber = normalizePhoneNumber(cleanNumber);
        }

        if (!cleanNumber && !isLidChat) continue;

        const whereContact: any = {};
        if (resolvedLid) {
          whereContact.lid = resolvedLid;
        } else if (cleanNumber) {
          const orList: any[] = [{ number: cleanNumber }];
          if (cleanNumber.length >= 8) {
            orList.push({ number: { [Op.like]: `%${cleanNumber.slice(-8)}` } });
          }
          whereContact[Op.or] = orList;
        }

        let contact = await Contact.findOne({ where: whereContact });
        if (!contact) {
          const isRegistered = isValidContactName(chat.name, cleanNumber, resolvedLid);
          const chatName = isRegistered ? chat.name.trim() : (isRealPhoneNumber(cleanNumber) ? cleanNumber : (cleanNumber || rawJid));
          contact = await Contact.create({
            name: chatName,
            number: cleanNumber || userPart,
            lid: resolvedLid,
            isGroup
          });
          getIO().emit("contact", { action: "create", contact });
        }

        let ticket = await Ticket.findOne({
          where: { contactId: contact.id },
          order: [["updatedAt", "DESC"]]
        });

        const unreadCount = Number(chat.unreadCount || 0);
        const tsRaw = chat.conversationTimestamp ? Number(chat.conversationTimestamp) : null;
        const chatDate = tsRaw ? new Date(tsRaw > 1000000000000 ? tsRaw : tsRaw * 1000) : new Date();

        if (!ticket) {
          ticket = await Ticket.create({
            contactId: contact.id,
            whatsappId: sessionId,
            status: unreadCount > 0 ? "pending" : "closed",
            unreadMessages: unreadCount,
            isGroup,
            lastMessage: "",
            updatedAt: chatDate
          });
        }

        // If chat has messages attached in history sync
        if (chat.messages && Array.isArray(chat.messages) && chat.messages.length > 0) {
          for (const item of chat.messages) {
            const m = item.message || item;
            if (m && m.key?.id) {
              const exists = await Message.findByPk(m.key.id);
              if (!exists) {
                const body = getMessageBody(m) || "";
                const rawTs = Number(m.messageTimestamp);
                const mDate = rawTs ? new Date(rawTs > 1000000000000 ? rawTs : rawTs * 1000) : chatDate;
                await Message.create({
                  id: m.key.id,
                  ticketId: ticket.id,
                  contactId: m.key.fromMe ? null : contact.id,
                  body,
                  fromMe: Boolean(m.key.fromMe),
                  read: true,
                  mediaType: mapMessageType(m) || "chat",
                  mediaUrl: null,
                  ack: m.status ? mapMessageAck(m.status) : 0,
                  createdAt: mDate,
                  updatedAt: mDate
                });
                if (body) {
                  await ticket.update({ lastMessage: body, updatedAt: mDate });
                }
              }
            }
          }
        }

        syncedChats++;
      }
      if (syncedChats > 0) {
        logger.info(`[SYNC] Synced ${syncedChats} chats from WhatsApp.`);
      }
    } catch (err) {
      logger.error({ err }, "Error syncing chats");
    }
  };

  wbot.ev.on("contacts.upsert", async (newContacts: any[]) => {
    if (wbot.store?.contacts && Array.isArray(newContacts)) {
      for (const c of newContacts) {
        if (c?.id) {
          wbot.store.contacts[c.id] = Object.assign(wbot.store.contacts[c.id] || {}, c);
        }
      }
    }
    await syncContacts(newContacts);
  });

  wbot.ev.on("contacts.update", async (updates: any[]) => {
    if (wbot.store?.contacts && Array.isArray(updates)) {
      for (const u of updates) {
        if (u?.id) {
          wbot.store.contacts[u.id] = Object.assign(wbot.store.contacts[u.id] || {}, u);
        }
      }
    }
    await syncContacts(updates);
  });

  wbot.ev.on("chats.upsert", async (newChats: any[]) => {
    await syncChats(newChats);
  });

  (wbot.ev as any).on("chats.set", async ({ chats: newChats }: any) => {
    if (newChats && newChats.length > 0) {
      await syncChats(newChats);
    }
  });

  (wbot.ev as any).on("messages.pdo-response", async ({ messages: pdoMessages }: any) => {
    if (pdoMessages && pdoMessages.length > 0) {
      logger.info(`[SYNC] Received ${pdoMessages.length} messages from PDO response.`);
      wbot.ev.emit("messaging-history.set", {
        chats: [],
        contacts: [],
        messages: pdoMessages,
        isLatest: false
      });
    }
  });

  wbot.ev.on("messaging-history.set", async ({ chats, contacts, messages }: any) => {
    if (contacts && contacts.length > 0) {
      if (wbot.store?.contacts && Array.isArray(contacts)) {
        for (const c of contacts) {
          if (c?.id) {
            wbot.store.contacts[c.id] = Object.assign(wbot.store.contacts[c.id] || {}, c);
          }
        }
      }
      await syncContacts(contacts);
    }
    if (chats && chats.length > 0) {
      await syncChats(chats);
    }
    if (messages && messages.length > 0) {
      try {
        let syncedToTickets = 0;
        const ticketUpdates = new Map<number, { lastMessage: string; timestamp: Date }>();

        for (const msg of messages) {
          try {
            if (!msg.message || !shouldHandleMessage(msg)) continue;
            const rawJid = msg.key?.remoteJid || (msg as any).chatId || "";
            if (
              !rawJid ||
              isJidBroadcast(rawJid) ||
              rawJid.endsWith("newsletter")
            ) {
              continue;
            }

            const normalizedJid = jidNormalizedUser(rawJid);
            const isLidMsg = isLidUser(rawJid) || isLid(rawJid);
            const isGroup = isJidGroup(rawJid);
            const userPart = normalizedJid.split("@")[0];
            let cleanNumber = cleanDigits(userPart) || userPart;
            let resolvedLid = isLidMsg ? normalizedJid : undefined;

            if (isLidMsg) {
              const fromStore = resolveLidFromStores(userPart);
              if (fromStore?.phone) {
                cleanNumber = normalizePhoneNumber(fromStore.phone);
              }
            } else {
              cleanNumber = normalizePhoneNumber(cleanNumber);
            }

            if (!cleanNumber && !isLidMsg) continue;

            const whereContact: any = {};
            if (resolvedLid) {
              whereContact.lid = resolvedLid;
            } else if (cleanNumber) {
              const orList: any[] = [{ number: cleanNumber }];
              if (cleanNumber.length >= 8) {
                orList.push({ number: { [Op.like]: `%${cleanNumber.slice(-8)}` } });
              }
              whereContact[Op.or] = orList;
            }

            let contact = await Contact.findOne({ where: whereContact });
            if (!contact) {
              const contactName = isRealPhoneNumber(cleanNumber) ? cleanNumber : (cleanNumber || rawJid);

              contact = await Contact.create({
                name: contactName,
                number: cleanNumber || userPart,
                lid: resolvedLid,
                isGroup
              });
              getIO().emit("contact", { action: "create", contact });
            }

            let ticket = await Ticket.findOne({
              where: { contactId: contact.id },
              order: [["updatedAt", "DESC"]]
            });

            if (!ticket) {
              ticket = await Ticket.create({
                contactId: contact.id,
                whatsappId: sessionId,
                status: "closed",
                isGroup,
                unreadMessages: 0
              });
            }

            if (ticket && msg.key?.id) {
              const rawTs = Number(msg.messageTimestamp);
              const timestampMs =
                rawTs > 1000000000000 ? rawTs : rawTs * 1000;
              const createdAt = new Date(timestampMs || Date.now());
              const body = getMessageBody(msg) || "";
              const mediaType = mapMessageType(msg) || "chat";

              const exists = await Message.findByPk(msg.key.id);
              if (!exists) {
                const created = await Message.create({
                  id: msg.key.id,
                  ticketId: ticket.id,
                  contactId: msg.key.fromMe ? null : contact.id,
                  body,
                  fromMe: Boolean(msg.key.fromMe),
                  read: true,
                  mediaType,
                  mediaUrl: null,
                  ack: msg.status ? mapMessageAck(msg.status) : 0,
                  createdAt,
                  updatedAt: createdAt
                });

                syncedToTickets++;

                const contactTickets = await Ticket.findAll({
                  where: { contactId: contact.id },
                  attributes: ["id"]
                });
                for (const ct of contactTickets) {
                  getIO().to(ct.id.toString()).emit("appMessage", {
                    action: "create",
                    message: created
                  });
                }
              }

              const currentUpdate = ticketUpdates.get(ticket.id);
              if (!currentUpdate || createdAt > currentUpdate.timestamp) {
                ticketUpdates.set(ticket.id, {
                  lastMessage: body,
                  timestamp: createdAt
                });
              }
            }
          } catch (msgErr) {
            logger.warn({ msgErr, key: msg.key }, "Error processing single history message");
          }
        }

        for (const [ticketId, { lastMessage, timestamp }] of ticketUpdates.entries()) {
          const t = await Ticket.findByPk(ticketId);
          if (t) {
            await t.update({
              lastMessage,
              updatedAt: timestamp
            });
            getIO()
              .to(t.status)
              .to("notification")
              .to(t.id.toString())
              .emit("ticket", {
                action: "update",
                ticket: t
              });
          }
        }

        if (syncedToTickets > 0) {
          logger.info(
            `[SYNC] Stored and synced ${syncedToTickets} history messages from WhatsApp.`
          );
        }
      } catch (err) {
        logger.error({ err }, "Error processing history messages");
      }
    }
  });

  wbot.ev.on("messages.upsert", async ({ messages, type }) => {
    messages.forEach(msg => {
      msgCache.save(msg);
      logger.debug({
        info: "[RAW] Message received",
        sessionId,
        type,
        key: msg.key,
        messageTimestamp: msg.messageTimestamp,
        pushName: msg.pushName,
        status: msg.status,
        messageType: Object.keys(msg.message || {}),
        rawMessage: JSON.stringify(msg, null, 2)
      });
    });

    const validMessages = messages.filter(msg => {
      if (!msg.message || !shouldHandleMessage(msg)) return false;

      if (type === "notify") return true;

      if (type === "append" && msg.key.fromMe) return true;

      return false;
    });

    if (validMessages.length === 0) return;

    await Promise.all(
      validMessages.map(async msg => {
        try {
          const {
            messagePayload,
            contactPayload,
            contextPayload,
            mediaPayload
          } = await getMessageData(msg, wbot);

          await handleMessage(
            messagePayload,
            contactPayload,
            contextPayload,
            mediaPayload
          );
        } catch (err) {
          logger.error(err, "Error handling message upsert");
        }
      })
    );
  });

  wbot.ev.on("connection.update", async update => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const errorMessage =
        (lastDisconnect?.error as Boom)?.output?.payload?.message ||
        (lastDisconnect?.error as Error)?.message ||
        "";

      if (errorMessage === "Intentional Logout") {
        await whatsapp.update({
          status: "DISCONNECTED",
          qrcode: "",
          retries: 0
        });

        const updatedWhatsapp = await Whatsapp.findByPk(sessionId);
        if (updatedWhatsapp) {
          io.emit("whatsappSession", {
            action: "update",
            session: updatedWhatsapp
          });
          io.emit("whatsapp", {
            action: "update",
            whatsapp: updatedWhatsapp
          });
        }

        logger.info({ info: "Session intentionally logged out", sessionId });

        await clearSessionKeys(sessionId);

        await removeSession(sessionId);
        return;
      }

      if (statusCode === DisconnectReason.loggedOut) {
        await whatsapp.update({
          status: "DISCONNECTED",
          qrcode: "",
          retries: 0
        });

        const updatedWhatsapp = await Whatsapp.findByPk(sessionId);
        if (updatedWhatsapp) {
          io.emit("whatsappSession", {
            action: "update",
            session: updatedWhatsapp
          });
          io.emit("whatsapp", {
            action: "update",
            whatsapp: updatedWhatsapp
          });
        }

        await clearSessionKeys(sessionId);
        await removeSession(sessionId);

        return;
      }

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut; // TODO handle other cases

      if (shouldReconnect) {
        await flushPendingCredsSave(sessionId);

        const currentWp = await Whatsapp.findByPk(sessionId);
        if (currentWp && currentWp.status !== "qrcode") {
          await currentWp.update({ status: "OPENING" });
          io.emit("whatsappSession", {
            action: "update",
            session: currentWp
          });
          io.emit("whatsapp", {
            action: "update",
            whatsapp: currentWp
          });
        }
        logger.info({
          info: "Connection closed, reconnecting...",
          sessionId,
          statusCode
        });

        await sleep(3000);
        init(whatsapp);
      }
    }

    if (connection === "open") {
      await flushPendingCredsSave(sessionId);

      await whatsapp.update({
        status: "CONNECTED",
        qrcode: "",
        retries: 0
      });

      const updatedWhatsapp = await Whatsapp.findByPk(sessionId);
      if (updatedWhatsapp) {
        io.emit("whatsappSession", {
          action: "update",
          session: updatedWhatsapp
        });
        io.emit("whatsapp", {
          action: "update",
          whatsapp: updatedWhatsapp
        });
      }

      logger.info({ info: "Session connected", sessionId });

      if (typeof (wbot as any).resyncAppState === "function") {
        try {
          (wbot as any)
            .resyncAppState(
              [
                "critical_block",
                "critical_unblock_low",
                "regular_high",
                "regular_low",
                "regular"
              ],
              false
            )
            .catch((e: any) => {
              logger.debug({ info: "Non-critical error in resyncAppState", err: e });
            });
        } catch (e) {
          logger.debug({ info: "Could not trigger resyncAppState", err: e });
        }
      }

      setTimeout(async () => {
        try {
          if (wbot.store?.contacts) {
            const allContacts = Object.values(wbot.store.contacts);
            if (allContacts.length > 0) {
              logger.info(
                `[SYNC] Post-connect syncing ${allContacts.length} contacts from store on session ${sessionId}`
              );
              await syncContacts(allContacts);
            }
          }
        } catch (e) {
          logger.error({ info: "Error syncing store contacts post-connect", err: e });
        }
      }, 4000);
    }

    if (qr !== undefined) {
      await whatsapp.update({
        qrcode: qr,
        status: "qrcode"
      });

      const updatedWhatsapp = await Whatsapp.findByPk(sessionId);

      io.emit("whatsappSession", {
        action: "update",
        session: updatedWhatsapp || whatsapp
      });
      io.emit("whatsapp", {
        action: "update",
        whatsapp: updatedWhatsapp || whatsapp
      });

      logger.info({ info: "QR Code generated", sessionId, qrLength: qr.length });
    }
  });

  wbot.ev.on("messages.update", async updates => {
    await Promise.all(
      updates.map(async event => {
        try {
          if (!event.update.status || !event.key.id) return;

          const ack = (event.update.status as MessageAck) || 0;
          await handleMessageAck(event.key.id, ack);
        } catch (err) {
          logger.error({
            info: "Error handling message update",
            err,
            messageId: event.key.id
          });
        }
      })
    );
  });

  wbot.ev.on("message-receipt.update", async updates => {
    await Promise.all(
      updates.map(async ({ key, receipt }) => {
        try {
          if (!key.id) return;

          let ack: MessageAck = 2;
          if (receipt.playedTimestamp) {
            ack = 4;
          } else if (receipt.readTimestamp) {
            ack = 3;
          } else if (receipt.receiptTimestamp) {
            ack = 2;
          }

          await handleMessageAck(key.id, ack);

          logger.debug({
            info: "Message receipt update processed",
            messageId: key.id,
            ack,
            sessionId
          });
        } catch (err) {
          logger.error({
            info: "Error processing message receipt",
            err,
            messageId: key.id
          });
        }
      })
    );
  });
  } catch (err) {
    logger.error({ info: "Error during init of WhatsApp session", sessionId, err });
    try {
      await whatsapp.update({
        status: "DISCONNECTED",
        qrcode: ""
      });
      const updatedWhatsapp = await Whatsapp.findByPk(sessionId);
      io.emit("whatsappSession", {
        action: "update",
        session: updatedWhatsapp || whatsapp
      });
      io.emit("whatsapp", {
        action: "update",
        whatsapp: updatedWhatsapp || whatsapp
      });
    } catch (e) {
      logger.error({ info: "Error updating whatsapp status to DISCONNECTED on init failure", sessionId, err: e });
    }
    throw err;
  }
};

const logout = async (sessionId: number): Promise<void> => {
  await flushPendingCredsSave(sessionId);

  const wbot = sessions.get(sessionId);

  if (wbot) {
    await wbot
      .logout()
      .catch(err => logger.error({ info: "Error on logout", sessionId, err }));
  }

  await removeSession(sessionId);

  const whatsapp = await Whatsapp.findByPk(sessionId);

  if (whatsapp) {
    await whatsapp.update({
      status: "DISCONNECTED",
      qrcode: "",
      session: "",
      retries: 0
    });

    const updatedWhatsapp = await Whatsapp.findByPk(sessionId);
    if (updatedWhatsapp) {
      getIO().emit("whatsappSession", {
        action: "update",
        session: updatedWhatsapp
      });
      getIO().emit("whatsapp", {
        action: "update",
        whatsapp: updatedWhatsapp
      });
    }

    logger.info({ info: "Session logged out", sessionId });
  }

  await clearSessionKeys(sessionId);
};

const buildQuotedContext = async (
  wbot: Session,
  toJid: string,
  options?: { quotedMessageId?: string; quotedMessageFromMe?: boolean }
): Promise<{
  contextInfo?: any;
  quoted?: WAMessage;
}> => {
  if (!options?.quotedMessageId) return {};

  const { quotedMessageId, quotedMessageFromMe } = options;

  let quotedMessageProto: any = undefined;
  const cached = msgCache.get({ id: quotedMessageId });
  if (cached) {
    quotedMessageProto = cached;
  } else {
    try {
      const dbMsg = await Message.findByPk(quotedMessageId);
      if (dbMsg) {
        if (
          dbMsg.mediaType === "image" ||
          (dbMsg.mediaUrl && /\.(jpe?g|png|gif|webp)$/i.test(dbMsg.mediaUrl))
        ) {
          quotedMessageProto = {
            imageMessage: {
              caption: dbMsg.body || ""
            }
          };
        } else if (
          dbMsg.mediaType === "video" ||
          (dbMsg.mediaUrl && /\.(mp4|mov|avi)$/i.test(dbMsg.mediaUrl))
        ) {
          quotedMessageProto = {
            videoMessage: {
              caption: dbMsg.body || ""
            }
          };
        } else if (
          dbMsg.mediaType === "audio" ||
          (dbMsg.mediaUrl && /\.(mp3|ogg|wav)$/i.test(dbMsg.mediaUrl))
        ) {
          quotedMessageProto = {
            audioMessage: {}
          };
        } else {
          quotedMessageProto = {
            conversation: dbMsg.body || ""
          };
        }
      }
    } catch (err) {
      logger.error({ info: "Error loading quoted message from db", err });
    }
  }

  if (!quotedMessageProto) {
    quotedMessageProto = { conversation: "" };
  }

  const participant = quotedMessageFromMe
    ? (wbot.user?.id ? jidNormalizedUser(wbot.user.id) : toJid)
    : toJid;

  const contextInfo = {
    stanzaId: quotedMessageId,
    participant,
    quotedMessage: quotedMessageProto
  };

  const quoted = {
    key: {
      remoteJid: toJid,
      fromMe: Boolean(quotedMessageFromMe),
      id: quotedMessageId,
      participant
    },
    message: quotedMessageProto
  } as WAMessage;

  return { contextInfo, quoted };
};

const sendMessage = async (
  sessionId: number,
  to: string,
  body: string,
  options?: SendMessageOptions
): Promise<ProviderMessage> => {
  const wbot = getWbot(sessionId);
  const toJid = normalizeJid(to);

  const { contextInfo, quoted } = await buildQuotedContext(wbot, toJid, options);

  const messageContent: AnyMessageContent = contextInfo
    ? { text: body, contextInfo }
    : { text: body };

  let sentMsg;
  try {
    sentMsg = await wbot.sendMessage(toJid, messageContent, quoted ? { quoted } : undefined);
  } catch (err) {
    logger.error({ info: "DEBUG_BAILEYS_SEND_ERROR", err, toJid, messageContent });
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }

  if (!sentMsg?.key.id) {
    logger.error({ info: "DEBUG_BAILEYS_SEND_NO_ID", sentMsg, toJid });
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }

  logger.debug({
    info: "[RAW] Message sent",
    sessionId,
    to: toJid,
    key: sentMsg.key,
    messageTimestamp: sentMsg.messageTimestamp,
    status: sentMsg.status,
    rawMessage: JSON.stringify(sentMsg, null, 2)
  });

  msgCache.save(sentMsg);

  return {
    id: sentMsg.key.id,
    body,
    fromMe: true,
    hasMedia: false,
    type: "chat",
    timestamp: sentMsg.messageTimestamp
      ? Number(sentMsg.messageTimestamp)
      : Date.now(),
    from: wbot.user?.id || "",
    to,
    ack: 1
  };
};

const sendMedia = async (
  sessionId: number,
  to: string,
  media: ProviderMediaInput,
  options?: SendMediaOptions
): Promise<ProviderMessage> => {
  const wbot = getWbot(sessionId);
  const toJid = normalizeJid(to);

  const mediaBuffer = media.path ? readFileSync(media.path) : media.data;
  if (!mediaBuffer) throw new AppError("ERR_NO_MEDIA_DATA");

  const { contextInfo, quoted } = await buildQuotedContext(wbot, toJid, options);

  const buildPayload = () => {
    const base = {
      caption: options?.caption,
      mimetype: media.mimetype,
      contextInfo
    };

    if (media.mimetype.startsWith("image/")) {
      return {
        message: { image: mediaBuffer, ...base },
        type: "image" as MessageType
      };
    }

    if (media.mimetype.startsWith("video/")) {
      return {
        message: { video: mediaBuffer, ...base },
        type: "video" as MessageType
      };
    }

    if (media.mimetype.startsWith("audio/")) {
      const ptt = Boolean(options?.sendAudioAsVoice);
      return {
        message: {
          audio: mediaBuffer,
          mimetype: media.mimetype,
          ptt,
          contextInfo
        },
        type: ptt ? "ptt" : ("audio" as MessageType)
      };
    }

    return {
      message: {
        document: mediaBuffer,
        caption: options?.caption,
        mimetype: media.mimetype,
        fileName: media.filename,
        contextInfo
      },
      type: "document" as MessageType
    };
  };

  const { message, type } = buildPayload();

  const sent = await wbot.sendMessage(toJid, message, quoted ? { quoted } : undefined);
  if (!sent?.key?.id) throw new AppError("ERR_SENDING_WAPP_MEDIA_MSG");

  logger.debug({
    info: "[RAW] Media sent",
    sessionId,
    to: toJid,
    mediaType: type,
    mimetype: media.mimetype,
    filename: media.filename,
    key: sent.key,
    messageTimestamp: sent.messageTimestamp,
    status: sent.status,
    rawMessage: JSON.stringify(sent, null, 2)
  });

  msgCache.save(sent);

  return {
    id: sent.key.id,
    body: options?.caption || media.filename,
    fromMe: true,
    hasMedia: true,
    type,
    timestamp: sent.messageTimestamp
      ? Number(sent.messageTimestamp)
      : Date.now(),
    from: wbot.user?.id || "",
    to,
    ack: 1
  };
};

const deleteMessage = async (
  sessionId: number,
  chatId: string,
  messageId: string,
  fromMe: boolean
): Promise<void> => {
  const wbot = getWbot(sessionId);

  const normalizedChatId = normalizeJid(chatId);

  const key = {
    remoteJid: normalizedChatId,
    id: messageId,
    fromMe
  };

  await wbot.sendMessage(normalizedChatId, { delete: key });
};

const checkNumber = async (
  sessionId: number,
  number: string
): Promise<string> => {
  const wbot = getWbot(sessionId);

  const cleanNumber = number.replace(/\D/g, "");

  const [result] = await wbot.onWhatsApp(cleanNumber);

  if (!result?.exists) {
    throw new AppError("ERR_NUMBER_NOT_ON_WHATSAPP", 404);
  }

  return result.jid;
};

const getProfilePicUrl = async (
  sessionId: number,
  number: string
): Promise<string> => {
  const wbot = getWbot(sessionId);

  const jid = number.includes("@") ? number : `${number}@s.whatsapp.net`;

  try {
    const url = await wbot.profilePictureUrl(jid, "image");
    return url || "";
  } catch (err) {
    logger.debug({
      info: "Could not get profile picture",
      number,
      err
    });
    return "";
  }
};

const getContacts = async (sessionId: number): Promise<ProviderContact[]> => {
  const wbot = getWbot(sessionId);

  const contacts: ProviderContact[] = [];

  if (wbot.store?.contacts) {
    Object.values(wbot.store.contacts).forEach(contact => {
      if (!contact.id || contact.id.includes("@g.us") || contact.id === "status@broadcast") {
        return;
      }
      const isUser = isJidUser(contact.id);
      const isLidContact = isLid(contact.id);
      let phone = isUser ? jidNormalizedUser(contact.id).replace("@s.whatsapp.net", "") : "";

      if (isLidContact) {
        const fromStore = resolveLidFromStores(contact.id);
        if (fromStore?.phone) {
          phone = fromStore.phone;
        }
      }

      if (!phone || !isRealPhoneNumber(phone)) return;

      const cleanPhone = normalizePhoneNumber(phone);
      const registeredName = isValidContactName(contact.name, cleanPhone, contact.lid)
        ? contact.name?.trim() || ""
        : "";

      contacts.push({
        id: `${cleanPhone}@s.whatsapp.net`,
        number: cleanPhone,
        name: registeredName || cleanPhone,
        pushname: contact.notify || "",
        isGroup: false
      });
    });
  }

  return contacts;
};

const sendSeen = async (sessionId: number, chatId: string): Promise<void> => {
  const wbot = getWbot(sessionId);

  const normalizedChatId = normalizeJid(chatId);

  const lastMessages =
    wbot.store?.messages?.[normalizedChatId]?.array?.slice(-5) || [];

  if (lastMessages.length === 0) {
    return;
  }

  const keys = lastMessages
    .filter(msg => !msg.key.fromMe && msg.key.id)
    .map(msg => ({
      remoteJid: normalizedChatId,
      id: msg.key.id!,
      participant: msg.key.participant
    }));

  if (keys.length > 0) {
    await wbot.readMessages(keys);
  }
};

const sendPeerDataOperation = async (
  wbot: Session,
  pdoMessage: any
): Promise<string> => {
  const me = wbot.user;
  if (!me?.id) throw new AppError("Not authenticated");

  if (typeof (wbot as any).sendPeerDataOperationMessage === "function") {
    try {
      return await (wbot as any).sendPeerDataOperationMessage(pdoMessage);
    } catch (e) {
      // fallback to manual relay
    }
  }

  const targetJid = (me.lid && jidNormalizedUser(me.lid)) || jidNormalizedUser(me.id);

  const protocolMessage = {
    protocolMessage: {
      peerDataOperationRequestMessage: pdoMessage,
      type:
        proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
    }
  };

  return (wbot as any).relayMessage(targetJid, protocolMessage, {
    additionalAttributes: {
      category: "peer",
      push_priority: "high_force"
    }
  });
};

const fetchChatMessages = async (
  sessionId: number,
  chatId: string,
  limit = 100
): Promise<ProviderMessage[]> => {
  const wbot = getWbot(sessionId);
  const normalizedChatId = jidNormalizedUser(chatId);
  const store = wbot.store;

  const rawClean = chatId.replace(/[^0-9]/g, "");
  const last8 = rawClean.length >= 8 ? rawClean.slice(-8) : "";

  let matchedJid = normalizedChatId;
  let messagesFromStore: WAMessage[] = [];

  const getCandidateKeys = (): string[] => {
    const keys: string[] = [normalizedChatId, chatId];
    if (rawClean) {
      keys.push(`${rawClean}@s.whatsapp.net`);
      if (rawClean.startsWith("58")) {
        keys.push(`${rawClean.slice(2)}@s.whatsapp.net`);
      } else {
        keys.push(`58${rawClean}@s.whatsapp.net`);
      }
      keys.push(`${rawClean}@c.us`);
      keys.push(`${rawClean}@lid`);
      keys.push(`${rawClean}@g.us`);
    }
    return [...new Set(keys)];
  };

  const findInStore = (): WAMessage[] => {
    if (!store?.messages) return [];
    for (const key of getCandidateKeys()) {
      if (store.messages[key]?.array?.length) {
        matchedJid = key;
        return store.messages[key].array;
      }
    }
    if (last8) {
      const foundKey = Object.keys(store.messages).find(
        k => k.includes(last8) && !k.endsWith("@g.us")
      );
      if (foundKey && store.messages[foundKey]?.array?.length) {
        matchedJid = foundKey;
        return store.messages[foundKey].array;
      }
    }
    return [];
  };

  messagesFromStore = findInStore();

  // If store has fewer messages than limit, request on-demand sync from WhatsApp phone
  if (messagesFromStore.length < limit) {
    try {
      const oldest = messagesFromStore[0];
      const pdoChat = {
        peerDataOperationRequestType:
          proto.Message.PeerDataOperationRequestType.HISTORY_SYNC_ON_DEMAND,
        historySyncOnDemandRequest: {
          chatJid: matchedJid || normalizedChatId,
          oldestMsgFromMe: oldest ? Boolean(oldest.key?.fromMe) : false,
          oldestMsgId: oldest?.key?.id || undefined,
          oldestMsgTimestampMs: oldest?.messageTimestamp
            ? Number(oldest.messageTimestamp)
            : undefined,
          onDemandMsgCount: limit
        }
      };

      await sendPeerDataOperation(wbot, pdoChat);

      const pdoFull = {
        peerDataOperationRequestType:
          proto.Message.PeerDataOperationRequestType.FULL_HISTORY_SYNC_ON_DEMAND,
        fullHistorySyncOnDemandRequest: {
          requestMetadata: {},
          historySyncConfig: {
            fullSyncDaysLimit: 365,
            fullSyncSizeMbLimit: 100,
            storageQuotaMb: 1024,
            inlineInitialPayloadInE2EeMsg: false
          }
        }
      };

      await sendPeerDataOperation(wbot, pdoFull);
      logger.info(
        `[SYNC] Sent history on demand peer requests for ${
          matchedJid || normalizedChatId
        }`
      );

      // AWAIT response from phone: check store every 300ms for up to 3500ms
      const startWait = Date.now();
      while (Date.now() - startWait < 3500) {
        await new Promise(resolve => setTimeout(resolve, 300));
        messagesFromStore = findInStore();
        if (messagesFromStore.length >= limit) {
          break;
        }
      }
    } catch (e) {
      logger.warn({ err: e }, "Error requesting peer data operation history sync");
    }
  }

  if (messagesFromStore.length > 0) {
    const messages = messagesFromStore.slice(-limit);
    return messages.map(msg => ({
      id: msg.key.id || "",
      body: getMessageBody(msg),
      fromMe: msg.key.fromMe || false,
      hasMedia: hasMedia(msg),
      type: mapMessageType(msg),
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : Date.now(),
      from: msg.key.participant || msg.key.remoteJid || "",
      to: matchedJid || normalizedChatId,
      ack: mapMessageAck(msg.status)
    }));
  }

  // Fallback: check if messages for this contact already exist in MySQL Message table
  try {
    const whereContact: any = {};
    if (rawClean) {
      const orList: any[] = [{ number: rawClean }];
      if (last8) {
        orList.push({ number: { [Op.like]: `%${last8}` } });
      }
      if (rawClean.length === 10 && rawClean.startsWith("4")) {
        orList.push({ number: `58${rawClean}` });
      }
      whereContact[Op.or] = orList;
    } else {
      whereContact.lid = normalizedChatId;
    }

    const contact = await Contact.findOne({ where: whereContact });
    if (contact) {
      const contactTickets = await Ticket.findAll({
        where: { contactId: contact.id },
        attributes: ["id"]
      });
      const tIds = contactTickets.map(t => t.id);
      if (tIds.length > 0) {
        const dbMsgs = await Message.findAll({
          where: { ticketId: { [Op.in]: tIds } },
          limit,
          order: [["createdAt", "DESC"]]
        });
        if (dbMsgs.length > 0) {
          return dbMsgs.reverse().map(m => ({
            id: m.id,
            body: m.body,
            fromMe: m.fromMe,
            hasMedia: Boolean(m.mediaUrl),
            type: (m.mediaType || "chat") as MessageType,
            timestamp: m.createdAt.getTime(),
            from: m.fromMe ? "" : contact.number,
            to: m.fromMe ? contact.number : "",
            ack: mapMessageAck(m.ack)
          }));
        }
      }
    }
  } catch (err) {
    logger.debug({ err }, "Error querying fallback messages from DB");
  }

  return [];
};

export const WhaileysProvider: WhatsappProvider = {
  init,
  removeSession,
  logout,
  sendMessage,
  sendMedia,
  deleteMessage,
  checkNumber,
  getProfilePicUrl,
  getContacts,
  sendSeen,
  fetchChatMessages
};

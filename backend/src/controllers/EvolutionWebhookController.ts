import { Request, Response } from "express";
import { getIO } from "../libs/socket";
import { logger } from "../utils/logger";
import Whatsapp from "../models/Whatsapp";
import Contact from "../models/Contact";
import {
  handleMessage,
  handleMessageAck,
  MessagePayload,
  ContactPayload,
  WhatsappContextPayload,
  MediaPayload
} from "../handlers/handleWhatsappEvents";
import {
  cleanDigits,
  isLid,
  isRealPhoneNumber,
  normalizePhoneNumber,
  isValidContactName
} from "../helpers/PhoneNumberUtils";

const getMessageBody = (msg: any): string => {
  if (!msg) return "";
  if (typeof msg.conversation === "string") return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;
  if (msg.videoMessage?.caption) return msg.videoMessage.caption;
  if (msg.documentMessage?.caption) return msg.documentMessage.caption;
  if (msg.documentMessage?.fileName) return msg.documentMessage.fileName;
  if (msg.buttonsResponseMessage?.selectedDisplayText) return msg.buttonsResponseMessage.selectedDisplayText;
  if (msg.templateButtonReplyMessage?.selectedDisplayText) return msg.templateButtonReplyMessage.selectedDisplayText;
  if (msg.listResponseMessage?.title) return msg.listResponseMessage.title;
  return "";
};

const getMediaType = (msg: any): string => {
  if (!msg) return "chat";
  if (msg.imageMessage) return "image";
  if (msg.videoMessage) return "video";
  if (msg.audioMessage) return "audio";
  if (msg.documentMessage) return "document";
  if (msg.stickerMessage) return "sticker";
  if (msg.contactMessage) return "vcard";
  if (msg.locationMessage) return "location";
  return "chat";
};

export const handleEvolutionWebhook = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { sessionId } = req.params;
  const whatsappId = Number(sessionId);
  const payload = req.body;

  if (!payload || !payload.event) {
    return res.status(200).json({ received: true });
  }

  const eventName = String(payload.event).toUpperCase().replace(".", "_");
  const io = getIO();

  try {
    switch (eventName) {
      case "QRCODE_UPDATED": {
        const qrData =
          payload.data?.qrcode?.base64 ||
          payload.data?.qrcode?.code ||
          payload.data?.base64 ||
          payload.data?.code ||
          "";

        if (qrData && whatsappId) {
          const wp = await Whatsapp.findByPk(whatsappId);
          if (wp) {
            await wp.update({ status: "qrcode", qrcode: qrData });
            io.emit("whatsappSession", { action: "update", session: wp });
            io.emit("whatsapp", { action: "update", whatsapp: wp });
            logger.info(`[EVOLUTION_WEBHOOK] QR Code updated for session ${whatsappId}`);
          }
        }
        break;
      }

      case "CONNECTION_UPDATE": {
        const state = payload.data?.state || payload.data?.status || "";
        if (whatsappId) {
          const wp = await Whatsapp.findByPk(whatsappId);
          if (wp) {
            if (state === "open") {
              await wp.update({ status: "CONNECTED", qrcode: "", retries: 0 });
              logger.info(`[EVOLUTION_WEBHOOK] Session ${whatsappId} CONNECTED`);
            } else if (state === "close") {
              await wp.update({ status: "DISCONNECTED", qrcode: "" });
              logger.info(`[EVOLUTION_WEBHOOK] Session ${whatsappId} DISCONNECTED`);
            } else if (state === "connecting") {
              await wp.update({ status: "OPENING" });
            }
            io.emit("whatsappSession", { action: "update", session: wp });
            io.emit("whatsapp", { action: "update", whatsapp: wp });
          }
        }
        break;
      }

      case "MESSAGES_UPSERT": {
        const msg = payload.data?.message ? payload.data : (payload.data?.messages?.[0] || payload.data);
        if (!msg || !msg.key) break;

        const remoteJid = msg.key.remoteJid || "";
        if (!remoteJid || remoteJid.includes("@broadcast") || remoteJid.endsWith("newsletter")) {
          break;
        }

        const isGroup = remoteJid.includes("@g.us");
        const userPart = remoteJid.split("@")[0];
        const rawNumber = cleanDigits(userPart) || userPart;

        if (isLid(remoteJid) || isLid(rawNumber)) break;

        const cleanNumber = normalizePhoneNumber(rawNumber);
        const pushName = msg.pushName || "";
        const candidateName = isValidContactName(pushName, cleanNumber) ? pushName.trim() : cleanNumber;

        const body = getMessageBody(msg.message);
        const mediaType = getMediaType(msg.message);
        const hasMedia = mediaType !== "chat";

        const messagePayload: MessagePayload = {
          id: msg.key.id || `evo_${Date.now()}`,
          body: body || (hasMedia ? `[${mediaType}]` : ""),
          fromMe: Boolean(msg.key.fromMe),
          hasMedia,
          type: mediaType as any,
          timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
          from: remoteJid,
          to: msg.key.fromMe ? remoteJid : "me",
          mediaType: hasMedia ? mediaType : undefined
        };

        const contactPayload: ContactPayload = {
          name: candidateName,
          number: cleanNumber || userPart,
          isGroup
        };

        const contextPayload: WhatsappContextPayload = {
          whatsappId: whatsappId || 1,
          unreadMessages: msg.key.fromMe ? 0 : 1
        };

        let mediaPayload: MediaPayload | undefined;
        if (hasMedia && msg.mediaUrl) {
          mediaPayload = {
            filename: msg.mediaName || "attachment",
            mimetype: msg.mediaType || "application/octet-stream",
            data: msg.mediaUrl
          };
        }

        await handleMessage(messagePayload, contactPayload, contextPayload, mediaPayload);
        break;
      }

      case "MESSAGES_UPDATE": {
        const updates = Array.isArray(payload.data) ? payload.data : [payload.data];
        for (const item of updates) {
          const keyId = item?.key?.id;
          const status = item?.update?.status;
          if (keyId && status !== undefined) {
            let ack: 0 | 1 | 2 | 3 | 4 = 1;
            if (status === 3 || status === "READ") ack = 3;
            else if (status === 2 || status === "DELIVERY_ACK") ack = 2;
            else if (status === 4 || status === "PLAYED") ack = 4;
            await handleMessageAck(keyId, ack);
          }
        }
        break;
      }

      case "CHATS_UPSERT":
      case "CHATS_SET":
      case "CONTACTS_UPSERT": {
        const items = Array.isArray(payload.data) ? payload.data : [payload.data];
        for (const item of items) {
          if (!item || !item.id) continue;
          const jid = item.id;
          if (jid.includes("@broadcast") || jid.endsWith("newsletter") || jid.includes("@g.us")) continue;

          const uPart = jid.split("@")[0];
          if (isLid(jid) || isLid(uPart) || !isRealPhoneNumber(uPart)) continue;

          const cleanNum = normalizePhoneNumber(uPart);
          const rawName = item.name || item.displayName || item.pushName || "";
          const isReg = isValidContactName(rawName, cleanNum);
          const finalName = isReg ? rawName.trim() : cleanNum;

          const existing = await Contact.findOne({ where: { number: cleanNum } });
          if (!existing) {
            const created = await Contact.create({
              name: finalName,
              number: cleanNum,
              isGroup: false
            });
            io.emit("contact", { action: "create", contact: created });
          } else if (isReg && existing.name !== finalName) {
            await existing.update({ name: finalName });
            io.emit("contact", { action: "update", contact: existing });
          }
        }
        break;
      }

      default:
        logger.debug(`[EVOLUTION_WEBHOOK] Unhandled event: ${eventName}`);
        break;
    }
  } catch (err) {
    logger.error({ info: "Error processing Evolution webhook", eventName, err });
  }

  return res.status(200).json({ received: true });
};

export default { handleEvolutionWebhook };

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

const resolveWhatsappRecord = async (sessionId?: string, payload?: any): Promise<Whatsapp | null> => {
  const parsedId = Number(sessionId);
  if (parsedId && !isNaN(parsedId)) {
    const wp = await Whatsapp.findByPk(parsedId);
    if (wp) return wp;
  }

  const instName = payload?.instance || payload?.data?.instance || payload?.instanceName;
  if (instName) {
    const wp = await Whatsapp.findOne({
      where: {
        name: instName
      }
    });
    if (wp) return wp;
  }

  return (await Whatsapp.findOne({ where: { default: true } })) || (await Whatsapp.findOne());
};

export const handleEvolutionWebhook = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { sessionId } = req.params;
  const payload = req.body;

  if (!payload || !payload.event) {
    return res.status(200).json({ received: true });
  }

  const eventName = String(payload.event).toUpperCase().replace(".", "_");
  const io = getIO();

  try {
    const wp = await resolveWhatsappRecord(sessionId, payload);

    switch (eventName) {
      case "QRCODE_UPDATED": {
        const qrData =
          payload.data?.qrcode?.base64 ||
          payload.data?.qrcode?.code ||
          payload.data?.base64 ||
          payload.data?.code ||
          "";

        if (qrData && wp) {
          await wp.update({ status: "qrcode", qrcode: qrData });
          io.emit("whatsappSession", { action: "update", session: wp });
          io.emit("whatsapp", { action: "update", whatsapp: wp });
          logger.info(`[EVOLUTION_WEBHOOK] QR Code updated for session ${wp.id}`);
        }
        break;
      }

      case "CONNECTION_UPDATE": {
        const state =
          payload.data?.state ||
          payload.data?.status ||
          payload.data?.connectionStatus ||
          "";

        if (wp) {
          if (state === "open") {
            await wp.update({ status: "CONNECTED", qrcode: "", retries: 0 });
            logger.info(`[EVOLUTION_WEBHOOK] Session ${wp.id} CONNECTED`);
          } else if (state === "close") {
            await wp.update({ status: "DISCONNECTED", qrcode: "" });
            logger.info(`[EVOLUTION_WEBHOOK] Session ${wp.id} DISCONNECTED`);
          } else if (state === "connecting") {
            await wp.update({ status: "OPENING" });
          }
          io.emit("whatsappSession", { action: "update", session: wp });
          io.emit("whatsapp", { action: "update", whatsapp: wp });
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

        const isLidContact = isLid(remoteJid) || isLid(rawNumber);
        let cleanNumber = isLidContact ? rawNumber : normalizePhoneNumber(rawNumber);
        if (!cleanNumber) cleanNumber = userPart;

        const pushName = msg.pushName || "";
        const candidateName = isValidContactName(pushName, cleanNumber, isLidContact ? remoteJid : null)
          ? pushName.trim()
          : cleanNumber;

        const body = getMessageBody(msg.message);
        const mediaType = getMediaType(msg.message);
        const hasMedia = mediaType !== "chat";

        // Extract Quoted Message Stanza ID if present
        const quotedMsgId =
          msg.message?.extendedTextMessage?.contextInfo?.stanzaId ||
          msg.message?.imageMessage?.contextInfo?.stanzaId ||
          msg.message?.videoMessage?.contextInfo?.stanzaId ||
          msg.message?.audioMessage?.contextInfo?.stanzaId ||
          msg.message?.documentMessage?.contextInfo?.stanzaId;

        let mediaPayload: MediaPayload | undefined;
        if (hasMedia) {
          let base64Data = payload.data?.base64 || msg.base64 || msg.media?.base64;
          let filename = msg.mediaName || "";
          let mimetype = msg.mediaType || "";

          // If base64 not yet present in webhook, download from Evolution API
          if (!base64Data && msg.key?.id && wp) {
            try {
              const instName = payload.instance || wp.name;
              const apiUrl = (process.env.EVOLUTION_API_URL || "http://localhost:8080").replace(/\/+$/, "");
              const apiKey = process.env.EVOLUTION_API_KEY || "";
              const mediaRes = await fetch(`${apiUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instName)}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  apikey: apiKey,
                  "api-key": apiKey
                },
                body: JSON.stringify({ message: { key: { id: msg.key.id } } })
              });
              if (mediaRes.ok) {
                const resJson: any = await mediaRes.json().catch(() => ({}));
                if (resJson?.base64) {
                  base64Data = resJson.base64;
                  if (resJson.fileName) filename = resJson.fileName;
                  if (resJson.mimetype) mimetype = resJson.mimetype;
                }
              }
            } catch (mediaErr) {
              logger.error("Error fetching media from Evolution API:", mediaErr);
            }
          }

          if (base64Data) {
            const cleanBase64 = String(base64Data).replace(/^data:[^;]+;base64,/, "");
            if (!mimetype) {
              if (mediaType === "image") mimetype = "image/jpeg";
              else if (mediaType === "audio") mimetype = "audio/ogg";
              else if (mediaType === "video") mimetype = "video/mp4";
              else mimetype = "application/octet-stream";
            }
            if (!filename) {
              const ext = mimetype.split("/")[1] || "bin";
              filename = `${mediaType}_${Date.now()}.${ext}`;
            }
            mediaPayload = {
              filename,
              mimetype,
              data: cleanBase64
            };
          }
        }

        const messagePayload: MessagePayload = {
          id: msg.key.id || `evo_${Date.now()}`,
          body: body || (hasMedia ? `[${mediaType}]` : ""),
          fromMe: Boolean(msg.key.fromMe),
          hasMedia,
          type: mediaType as any,
          timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
          from: remoteJid,
          to: msg.key.fromMe ? remoteJid : "me",
          quotedMsgId,
          mediaType: hasMedia ? mediaType : undefined
        };

        const contactPayload: ContactPayload = {
          name: candidateName,
          number: cleanNumber,
          lid: isLidContact ? remoteJid : undefined,
          isGroup
        };

        const contextPayload: WhatsappContextPayload = {
          whatsappId: wp?.id || 1,
          unreadMessages: msg.key.fromMe ? 0 : 1
        };

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

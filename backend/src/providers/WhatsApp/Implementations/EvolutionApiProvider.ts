import Whatsapp from "../../../models/Whatsapp";
import AppError from "../../../errors/AppError";
import { logger } from "../../../utils/logger";
import { getIO } from "../../../libs/socket";
import {
  cleanDigits,
  isLid,
  isRealPhoneNumber,
  normalizePhoneNumber,
  isValidContactName
} from "../../../helpers/PhoneNumberUtils";
import {
  SendMessageOptions,
  SendMediaOptions,
  ProviderMessage,
  ProviderMediaInput,
  ProviderContact
} from "../types";
import { WhatsappProvider } from "../whatsappProvider";

const getEvolutionConfig = () => {
  const apiUrl = (process.env.EVOLUTION_API_URL || "http://localhost:8080").replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY || "";
  const backendUrl = (process.env.BACKEND_URL || "http://localhost:3000").replace(/\/+$/, "");

  return { apiUrl, apiKey, backendUrl };
};

const evolutionFetch = async (
  endpoint: string,
  options: {
    method?: string;
    body?: any;
    headers?: Record<string, string>;
  } = {}
) => {
  const { apiUrl, apiKey } = getEvolutionConfig();
  const url = `${apiUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: apiKey,
    "api-key": apiKey,
    ...(options.headers || {})
  };

  const reqOptions: RequestInit = {
    method: options.method || "GET",
    headers
  };

  if (options.body) {
    reqOptions.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }

  try {
    const res = await fetch(url, reqOptions);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (err: any) {
    logger.error({ info: "Evolution API fetch error", url, err: err?.message });
    return { status: 500, ok: false, data: null, error: err };
  }
};

const resolveInstanceName = async (whatsapp?: Whatsapp | { id: number; name?: string }): Promise<string> => {
  if (process.env.EVOLUTION_INSTANCE_NAME) {
    return process.env.EVOLUTION_INSTANCE_NAME;
  }

  try {
    const res = await evolutionFetch("/instance/fetchInstances");
    const list = Array.isArray(res.data) ? res.data : [];

    if (list.length > 0) {
      if (whatsapp?.name) {
        const match = list.find((inst: any) =>
          inst.name?.toLowerCase().trim() === whatsapp.name?.toLowerCase().trim() ||
          inst.name?.toLowerCase().includes(whatsapp.name?.toLowerCase().trim()) ||
          whatsapp.name?.toLowerCase().includes(inst.name?.toLowerCase().trim())
        );
        if (match) return match.name;
      }
      if (list.length === 1 && list[0].name) {
        return list[0].name;
      }
      const openMatch = list.find((inst: any) => inst.connectionStatus === "open");
      if (openMatch && openMatch.name) {
        return openMatch.name;
      }
    }
  } catch {}

  return whatsapp?.name ? whatsapp.name : `whatsapp_${whatsapp?.id || 1}`;
};

export const EvolutionApiProvider: WhatsappProvider = {
  init: async (whatsapp: Whatsapp): Promise<void> => {
    const { backendUrl, apiKey } = getEvolutionConfig();
    const instanceName = await resolveInstanceName(whatsapp);
    const io = getIO();

    logger.info(`[EVOLUTION] Initializing instance ${instanceName} for session ${whatsapp.id}`);

    // 1. Check if instance already exists
    const checkRes = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`);

    if (checkRes.status === 404 || !checkRes.ok) {
      logger.info(`[EVOLUTION] Creating new instance ${instanceName}`);
      await evolutionFetch("/instance/create", {
        method: "POST",
        body: {
          instanceName,
          token: apiKey,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS"
        }
      });
    }

    // 2. Set Webhook URL to point to Whaticket backend
    const webhookUrl = `${backendUrl}/evolution-webhook/${whatsapp.id}`;
    logger.info(`[EVOLUTION] Configuring webhook for ${instanceName} to ${webhookUrl}`);
    await evolutionFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: {
        webhook: {
          enabled: true,
          url: webhookUrl,
          byEvents: false,
          base64: true,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "SEND_MESSAGE",
            "MESSAGES_SET",
            "CHATS_UPSERT",
            "CHATS_UPDATE",
            "CHATS_SET",
            "CONTACTS_UPSERT",
            "CONTACTS_UPDATE",
            "CONTACTS_SET",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED"
          ]
        }
      }
    });

    // 2.5 Ensure readMessages setting is enabled so native phone notifications clear on read
    await evolutionFetch(`/settings/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: {
        readMessages: true
      }
    });

    // 3. Check connection status
    const connStateRes = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    const state =
      connStateRes.data?.instance?.state ||
      connStateRes.data?.state ||
      connStateRes.data?.instance?.connectionStatus ||
      "";

    if (state === "open") {
      await whatsapp.update({
        status: "CONNECTED",
        qrcode: "",
        retries: 0
      });
      io.emit("whatsappSession", { action: "update", session: whatsapp });
      io.emit("whatsapp", { action: "update", whatsapp });
      logger.info(`[EVOLUTION] Instance ${instanceName} is already CONNECTED`);
    } else {
      const connectRes = await evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`);
      const qrData =
        connectRes.data?.base64 ||
        connectRes.data?.code ||
        connectRes.data?.qrcode?.base64 ||
        "";

      if (qrData) {
        await whatsapp.update({
          status: "qrcode",
          qrcode: qrData
        });
        io.emit("whatsappSession", { action: "update", session: whatsapp });
        io.emit("whatsapp", { action: "update", whatsapp });
        logger.info(`[EVOLUTION] QR code generated for instance ${instanceName}`);
      }
    }
  },

  removeSession: (whatsappId: number): void => {
    logger.info(`[EVOLUTION] Removing local session reference for ${whatsappId}`);
  },

  logout: async (sessionId: number): Promise<void> => {
    const instanceName = await resolveInstanceName({ id: sessionId });
    logger.info(`[EVOLUTION] Logging out instance ${instanceName}`);

    await evolutionFetch(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "DELETE" });

    const whatsapp = await Whatsapp.findByPk(sessionId);
    if (whatsapp) {
      await whatsapp.update({
        status: "DISCONNECTED",
        qrcode: "",
        retries: 0
      });
      getIO().emit("whatsappSession", { action: "update", session: whatsapp });
      getIO().emit("whatsapp", { action: "update", whatsapp });
    }
  },

  sendMessage: async (
    sessionId: number,
    to: string,
    body: string,
    options?: SendMessageOptions
  ): Promise<ProviderMessage> => {
    const instanceName = await resolveInstanceName({ id: sessionId });

    let destination = to;
    if (to.includes("@lid")) {
      destination = to;
    } else if (!to.includes("@g.us")) {
      const userPart = to.split("@")[0];
      destination = normalizePhoneNumber(userPart) || cleanDigits(userPart);
    }

    const payload: any = {
      number: destination,
      text: body,
      options: {
        delay: 500,
        presence: "composing"
      }
    };

    if (options?.quotedMessageId) {
      payload.quoted = {
        key: {
          id: options.quotedMessageId
        }
      };
      payload.options.quoted = payload.quoted;
    }

    const res = await evolutionFetch(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: payload
    });

    if (!res.ok) {
      logger.error({ info: "Evolution API sendText failed", res });
      throw new AppError("ERR_SENDING_WAPP_MSG");
    }

    const msgKey = res.data?.key || {};
    return {
      id: msgKey.id || `evo_${Date.now()}`,
      body,
      fromMe: true,
      hasMedia: false,
      type: "chat",
      timestamp: res.data?.messageTimestamp || Math.floor(Date.now() / 1000),
      from: "me",
      to: destination
    };
  },

  sendMedia: async (
    sessionId: number,
    to: string,
    media: ProviderMediaInput,
    options?: SendMediaOptions
  ): Promise<ProviderMessage> => {
    const instanceName = await resolveInstanceName({ id: sessionId });

    let destination = to;
    if (to.includes("@lid")) {
      destination = to;
    } else if (!to.includes("@g.us")) {
      const userPart = to.split("@")[0];
      destination = normalizePhoneNumber(userPart) || cleanDigits(userPart);
    }

    const mimetype = media.mimetype || "";
    const isAudio =
      mimetype.includes("audio") ||
      mimetype.includes("ogg") ||
      mimetype.includes("opus") ||
      mimetype.includes("mp3");

    let mediaBase64 = "";
    if (media.data && Buffer.isBuffer(media.data)) {
      mediaBase64 = media.data.toString("base64");
    } else if (media.path) {
      const fs = require("fs");
      try {
        const fileBuf = fs.readFileSync(media.path);
        mediaBase64 = fileBuf.toString("base64");
      } catch {}
    } else if ((media as any).data) {
      const raw = String((media as any).data);
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        mediaBase64 = raw;
      } else {
        mediaBase64 = raw.replace(/^data:[^;]+;base64,/, "");
      }
    }

    let endpoint = `/message/sendMedia/${encodeURIComponent(instanceName)}`;
    let payload: any = {};

    if (isAudio) {
      endpoint = `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`;
      payload = {
        number: destination,
        audio: mediaBase64
      };
    } else {
      let mediatype: "image" | "document" | "video" = "document";
      if (mimetype.startsWith("image/")) mediatype = "image";
      else if (mimetype.startsWith("video/")) mediatype = "video";

      payload = {
        number: destination,
        mediatype,
        mimetype,
        caption: options?.caption || "",
        media: mediaBase64,
        fileName: media.filename || "file"
      };
    }

    if (options?.quotedMessageId) {
      payload.quoted = {
        key: {
          id: options.quotedMessageId
        }
      };
    }

    let res = await evolutionFetch(endpoint, {
      method: "POST",
      body: payload
    });

    // If sendWhatsAppAudio fails, fallback to sendMedia with mediatype: "audio"
    if (!res.ok && isAudio) {
      logger.warn(`[EVOLUTION] sendWhatsAppAudio failed, attempting fallback to sendMedia for ${instanceName}`);
      res = await evolutionFetch(`/message/sendMedia/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: {
          number: destination,
          mediatype: "audio",
          mimetype: mimetype || "audio/ogg",
          media: mediaBase64,
          fileName: media.filename || "audio.ogg",
          caption: options?.caption || "",
          ...(options?.quotedMessageId ? { quoted: { key: { id: options.quotedMessageId } } } : {})
        }
      });
    }

    if (!res.ok) {
      logger.error({ info: "Evolution API sendMedia failed", res });
      throw new AppError("ERR_SENDING_WAPP_MSG");
    }

    const msgKey = res.data?.key || {};
    return {
      id: msgKey.id || `evo_media_${Date.now()}`,
      body: options?.caption || "",
      fromMe: true,
      hasMedia: true,
      type: isAudio ? "audio" : (mimetype.startsWith("image/") ? "image" : (mimetype.startsWith("video/") ? "video" : "document")),
      timestamp: res.data?.messageTimestamp || Math.floor(Date.now() / 1000),
      from: "me",
      to: destination
    };
  },

  deleteMessage: async (
    sessionId: number,
    chatId: string,
    messageId: string,
    fromMe: boolean
  ): Promise<void> => {
    const instanceName = await resolveInstanceName({ id: sessionId });

    await evolutionFetch(`/message/deleteMessage/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
      body: {
        id: messageId,
        remoteJid: chatId,
        fromMe
      }
    });
  },

  checkNumber: async (sessionId: number, number: string): Promise<string> => {
    const instanceName = await resolveInstanceName({ id: sessionId });
    const cleanNumber = normalizePhoneNumber(number) || cleanDigits(number);

    const res = await evolutionFetch(`/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: {
        numbers: [cleanNumber]
      }
    });

    const results = Array.isArray(res.data) ? res.data : (res.data?.numbers || []);
    const match = results.find((r: any) => r.exists || r.jid);

    if (!match || !match.exists) {
      throw new AppError("ERR_NUMBER_NOT_ON_WHATSAPP", 404);
    }

    return match.jid || `${cleanNumber}@s.whatsapp.net`;
  },

  getProfilePicUrl: async (sessionId: number, number: string): Promise<string> => {
    const instanceName = await resolveInstanceName({ id: sessionId });
    const cleanNumber = normalizePhoneNumber(number) || cleanDigits(number);

    const res = await evolutionFetch(`/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: { number: cleanNumber }
    });

    return res.data?.profilePictureUrl || "";
  },

  getContacts: async (sessionId: number): Promise<ProviderContact[]> => {
    const instanceName = await resolveInstanceName({ id: sessionId });
    const contactMap = new Map<string, ProviderContact>();

    logger.info(`[EVOLUTION] Querying contacts and chats for instance ${instanceName}`);

    // 1. Fetch contacts from /chat/findContacts
    const contactsRes = await evolutionFetch(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: {}
    });
    const contactsList = Array.isArray(contactsRes.data)
      ? contactsRes.data
      : (contactsRes.data?.contacts || contactsRes.data?.data || []);

    if (Array.isArray(contactsList)) {
      for (const c of contactsList) {
        const rawJid = c.remoteJid || c.id || "";
        if (!rawJid || rawJid.includes("@g.us") || rawJid.includes("@broadcast") || rawJid.endsWith("newsletter")) {
          continue;
        }

        const userPart = rawJid.split("@")[0];
        if (isLid(rawJid) || isLid(userPart)) continue;
        if (!isRealPhoneNumber(userPart)) continue;

        const cleanPhone = normalizePhoneNumber(userPart);
        const rawName = c.pushName || c.name || c.displayName || "";
        const isRegistered = isValidContactName(rawName, cleanPhone);
        const registeredName = isRegistered ? rawName.trim() : "";

        contactMap.set(cleanPhone, {
          id: `${cleanPhone}@s.whatsapp.net`,
          number: cleanPhone,
          name: registeredName || cleanPhone,
          pushname: c.pushName || "",
          isGroup: false
        });
      }
    }

    // 2. Fetch chats from /chat/findChats
    const chatsRes = await evolutionFetch(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: {}
    });
    const chatsList = Array.isArray(chatsRes.data)
      ? chatsRes.data
      : (chatsRes.data?.chats || chatsRes.data?.data || []);

    if (Array.isArray(chatsList)) {
      for (const chat of chatsList) {
        const rawJid = chat.remoteJid || chat.id || "";
        if (!rawJid || rawJid.includes("@g.us") || rawJid.includes("@broadcast") || rawJid.endsWith("newsletter")) {
          continue;
        }

        const userPart = rawJid.split("@")[0];
        if (isLid(rawJid) || isLid(userPart)) continue;
        if (!isRealPhoneNumber(userPart)) continue;

        const cleanPhone = normalizePhoneNumber(userPart);
        const rawName = chat.pushName || chat.name || chat.displayName || "";
        const isRegistered = isValidContactName(rawName, cleanPhone);
        const registeredName = isRegistered ? rawName.trim() : "";

        const existing = contactMap.get(cleanPhone);
        if (existing) {
          if (registeredName && (!existing.name || existing.name === cleanPhone)) {
            existing.name = registeredName;
          }
        } else {
          contactMap.set(cleanPhone, {
            id: `${cleanPhone}@s.whatsapp.net`,
            number: cleanPhone,
            name: registeredName || cleanPhone,
            pushname: chat.pushName || "",
            isGroup: false
          });
        }
      }
    }

    logger.info(`[EVOLUTION] Found ${contactMap.size} valid contacts from Evolution API`);
    return Array.from(contactMap.values());
  },

  sendSeen: async (
    sessionId: number,
    chatId: string,
    messageIds?: string[]
  ): Promise<void> => {
    const instanceName = await resolveInstanceName({ id: sessionId });

    let destination = chatId;
    if (chatId.includes("@c.us")) {
      destination = chatId.replace("@c.us", "@s.whatsapp.net");
    } else if (!chatId.includes("@")) {
      destination = `${chatId}@s.whatsapp.net`;
    }

    let ids = messageIds ? [...messageIds] : [];

    // If no specific message IDs were passed, find the most recent incoming message
    if (ids.length === 0) {
      try {
        const findRes = await evolutionFetch(`/chat/findMessages/${encodeURIComponent(instanceName)}`, {
          method: "POST",
          body: {
            where: {
              key: {
                remoteJid: destination,
                fromMe: false
              }
            },
            limit: 3
          }
        });
        const records = findRes.data?.messages?.records || findRes.data?.messages || findRes.data || [];
        if (Array.isArray(records) && records.length > 0) {
          ids = records.map((r: any) => r.key?.id).filter(Boolean);
        }
      } catch {}
    }

    if (ids.length > 0) {
      const readMessages = ids.map(id => ({
        id,
        fromMe: false,
        remoteJid: destination
      }));

      await evolutionFetch(`/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: { readMessages }
      });
      logger.info(`[EVOLUTION] Marked ${readMessages.length} messages as read for ${destination}`);
    }
  },

  fetchChatMessages: async (
    sessionId: number,
    chatId: string,
    limit: number
  ): Promise<ProviderMessage[]> => {
    const instanceName = await resolveInstanceName({ id: sessionId });
    const res = await evolutionFetch(`/chat/findMessages/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      body: {
        where: {
          key: {
            remoteJid: chatId
          }
        },
        limit
      }
    });

    const messages = Array.isArray(res.data)
      ? res.data
      : (Array.isArray(res.data?.messages)
        ? res.data.messages
        : (res.data?.messages?.records || []));

    return messages.map((m: any) => {
      const isMedia = Boolean(
        m.message?.imageMessage ||
        m.message?.videoMessage ||
        m.message?.audioMessage ||
        m.message?.documentMessage
      );
      let mType = m.messageType || "chat";
      if (m.message?.imageMessage) mType = "image";
      else if (m.message?.audioMessage) mType = "audio";
      else if (m.message?.videoMessage) mType = "video";
      else if (m.message?.documentMessage) mType = "document";

      const body =
        m.message?.conversation ||
        m.message?.extendedTextMessage?.text ||
        m.message?.imageMessage?.caption ||
        m.message?.videoMessage?.caption ||
        m.message?.documentMessage?.caption ||
        m.message?.documentMessage?.fileName ||
        (isMedia ? `[${mType}]` : "");

      return {
        id: m.key?.id || "",
        body,
        fromMe: Boolean(m.key?.fromMe),
        hasMedia: isMedia,
        type: mType as any,
        timestamp: m.messageTimestamp || Math.floor(Date.now() / 1000),
        from: m.key?.remoteJid || "",
        to: m.key?.fromMe ? m.key?.remoteJid : "me"
      };
    });
  }
};

export default EvolutionApiProvider;

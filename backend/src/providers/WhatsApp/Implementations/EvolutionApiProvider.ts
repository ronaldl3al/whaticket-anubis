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

const getInstanceName = (whatsapp: Whatsapp | { id: number; name?: string }): string => {
  return `whatsapp_${whatsapp.id}`;
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

export const EvolutionApiProvider: WhatsappProvider = {
  init: async (whatsapp: Whatsapp): Promise<void> => {
    const { backendUrl, apiKey } = getEvolutionConfig();
    const instanceName = getInstanceName(whatsapp);
    const io = getIO();

    logger.info(`[EVOLUTION] Initializing instance ${instanceName} for session ${whatsapp.id}`);

    // 1. Check if instance already exists
    const checkRes = await evolutionFetch(`/instance/connectionState/${instanceName}`);

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
    await evolutionFetch(`/webhook/set/${instanceName}`, {
      method: "POST",
      body: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        events: [
          "MESSAGES_UPSERT",
          "MESSAGES_UPDATE",
          "MESSAGES_DELETE",
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
    });

    // 3. Request connection / QR code
    const connStateRes = await evolutionFetch(`/instance/connectionState/${instanceName}`);
    const state = connStateRes.data?.instance?.state || connStateRes.data?.state || "";

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
      const connectRes = await evolutionFetch(`/instance/connect/${instanceName}`);
      const qrData = connectRes.data?.base64 || connectRes.data?.code || connectRes.data?.qrcode?.base64 || "";

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
    const instanceName = getInstanceName({ id: sessionId });
    logger.info(`[EVOLUTION] Logging out instance ${instanceName}`);

    await evolutionFetch(`/instance/logout/${instanceName}`, { method: "DELETE" });

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
    const instanceName = getInstanceName({ id: sessionId });

    let destination = to;
    if (!to.includes("@g.us")) {
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
      payload.options.quoted = {
        key: {
          id: options.quotedMessageId
        }
      };
    }

    const res = await evolutionFetch(`/message/sendText/${instanceName}`, {
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
    const instanceName = getInstanceName({ id: sessionId });

    let destination = to;
    if (!to.includes("@g.us")) {
      const userPart = to.split("@")[0];
      destination = normalizePhoneNumber(userPart) || cleanDigits(userPart);
    }

    const mimetype = media.mimetype || "";
    const isAudio = mimetype.includes("audio") || mimetype.includes("ogg") || mimetype.includes("opus");

    let mediaBase64 = "";
    if (media.data && Buffer.isBuffer(media.data)) {
      mediaBase64 = `data:${mimetype};base64,${media.data.toString("base64")}`;
    } else if (media.path) {
      const fs = require("fs");
      try {
        const fileBuf = fs.readFileSync(media.path);
        mediaBase64 = `data:${mimetype};base64,${fileBuf.toString("base64")}`;
      } catch {}
    } else if ((media as any).data) {
      const raw = String((media as any).data);
      if (raw.startsWith("data:") || raw.startsWith("http")) {
        mediaBase64 = raw;
      } else {
        mediaBase64 = `data:${mimetype};base64,${raw}`;
      }
    }

    let endpoint = `/message/sendMedia/${instanceName}`;
    let payload: any = {};

    if (isAudio) {
      endpoint = `/message/sendWhatsAppAudio/${instanceName}`;
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

    const res = await evolutionFetch(endpoint, {
      method: "POST",
      body: payload
    });

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
    const instanceName = getInstanceName({ id: sessionId });

    await evolutionFetch(`/message/deleteMessage/${instanceName}`, {
      method: "DELETE",
      body: {
        id: messageId,
        remoteJid: chatId,
        fromMe
      }
    });
  },

  checkNumber: async (sessionId: number, number: string): Promise<string> => {
    const instanceName = getInstanceName({ id: sessionId });
    const cleanNumber = normalizePhoneNumber(number) || cleanDigits(number);

    const res = await evolutionFetch(`/chat/whatsappNumbers/${instanceName}`, {
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
    const instanceName = getInstanceName({ id: sessionId });
    const cleanNumber = normalizePhoneNumber(number) || cleanDigits(number);

    const res = await evolutionFetch(`/chat/fetchProfilePictureUrl/${instanceName}`, {
      method: "POST",
      body: { number: cleanNumber }
    });

    return res.data?.profilePictureUrl || "";
  },

  getContacts: async (sessionId: number): Promise<ProviderContact[]> => {
    const instanceName = getInstanceName({ id: sessionId });
    const contactMap = new Map<string, ProviderContact>();

    logger.info(`[EVOLUTION] Querying chats and contacts for instance ${instanceName}`);

    // 1. Fetch Chats (where chat names like cliente0000 exist)
    let chatsRes = await evolutionFetch(`/chat/findChats/${instanceName}`);
    if (!chatsRes.ok) {
      chatsRes = await evolutionFetch(`/chat/findChats/${instanceName}`, { method: "POST", body: {} });
    }
    const chatsList = Array.isArray(chatsRes.data)
      ? chatsRes.data
      : (chatsRes.data?.chats || chatsRes.data?.data || []);

    if (Array.isArray(chatsList)) {
      for (const chat of chatsList) {
        if (!chat || !chat.id || chat.id.includes("@g.us") || chat.id.includes("@broadcast") || chat.id.endsWith("newsletter")) {
          continue;
        }

        const rawJid = chat.id;
        const userPart = rawJid.split("@")[0];

        if (isLid(rawJid) || isLid(userPart)) continue;
        if (!isRealPhoneNumber(userPart)) continue;

        const cleanPhone = normalizePhoneNumber(userPart);
        const candidateName = chat.name || chat.displayName || chat.subject || "";
        const isRegistered = isValidContactName(candidateName, cleanPhone);
        const registeredName = isRegistered ? candidateName.trim() : "";

        contactMap.set(cleanPhone, {
          id: `${cleanPhone}@s.whatsapp.net`,
          number: cleanPhone,
          name: registeredName || cleanPhone,
          pushname: chat.pushName || "",
          isGroup: false
        });
      }
    }

    // 2. Fetch Contacts
    let contactsRes = await evolutionFetch(`/contact/findContact/${instanceName}`);
    if (!contactsRes.ok) {
      contactsRes = await evolutionFetch(`/contact/findContact/${instanceName}`, { method: "POST", body: {} });
    }
    const contactsList = Array.isArray(contactsRes.data)
      ? contactsRes.data
      : (contactsRes.data?.contacts || contactsRes.data?.data || []);

    if (Array.isArray(contactsList)) {
      for (const c of contactsList) {
        if (!c || !c.id || c.id.includes("@g.us") || c.id.includes("@broadcast")) continue;

        const rawJid = c.id;
        const userPart = rawJid.split("@")[0];

        if (isLid(rawJid) || isLid(userPart)) continue;
        if (!isRealPhoneNumber(userPart)) continue;

        const cleanPhone = normalizePhoneNumber(userPart);
        const candidateName = c.name || c.displayName || c.pushName || "";
        const isRegistered = isValidContactName(candidateName, cleanPhone);
        const registeredName = isRegistered ? candidateName.trim() : "";

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
            pushname: c.pushName || "",
            isGroup: false
          });
        }
      }
    }

    logger.info(`[EVOLUTION] Found ${contactMap.size} valid contacts from Evolution API`);
    return Array.from(contactMap.values());
  },

  sendSeen: async (sessionId: number, chatId: string): Promise<void> => {
    const instanceName = getInstanceName({ id: sessionId });
    await evolutionFetch(`/chat/markMessageAsRead/${instanceName}`, {
      method: "POST",
      body: {
        readMessages: [{ remoteJid: chatId }]
      }
    });
  },

  fetchChatMessages: async (
    sessionId: number,
    chatId: string,
    limit: number
  ): Promise<ProviderMessage[]> => {
    const instanceName = getInstanceName({ id: sessionId });
    const res = await evolutionFetch(`/chat/findMessages/${instanceName}`, {
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

    const messages = Array.isArray(res.data) ? res.data : (res.data?.messages || []);
    return messages.map((m: any) => ({
      id: m.key?.id || "",
      timestamp: m.messageTimestamp || Math.floor(Date.now() / 1000),
      fromMe: Boolean(m.key?.fromMe)
    }));
  }
};

export default EvolutionApiProvider;

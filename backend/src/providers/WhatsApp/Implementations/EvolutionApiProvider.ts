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

  sendSeen: async (sessionId: number, chatId: string): Promise<void> => {
    const instanceName = await resolveInstanceName({ id: sessionId });
    await evolutionFetch(`/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`, {
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

    const messages = Array.isArray(res.data) ? res.data : (res.data?.messages || []);
    return messages.map((m: any) => ({
      id: m.key?.id || "",
      body: m.message?.conversation || m.message?.extendedTextMessage?.text || "",
      fromMe: Boolean(m.key?.fromMe),
      hasMedia: Boolean(m.message?.imageMessage || m.message?.videoMessage || m.message?.audioMessage || m.message?.documentMessage),
      type: m.messageType || "chat",
      timestamp: m.messageTimestamp || Math.floor(Date.now() / 1000),
      from: m.key?.remoteJid || "",
      to: m.key?.fromMe ? m.key?.remoteJid : "me"
    }));
  }
};

export default EvolutionApiProvider;

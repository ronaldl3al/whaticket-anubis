import React, { useState, useEffect, useContext } from "react";
import { useParams, useHistory } from "react-router-dom";
import { makeStyles } from "@material-ui/core/styles";
import Avatar from "@material-ui/core/Avatar";
import Typography from "@material-ui/core/Typography";
import InputBase from "@material-ui/core/InputBase";
import SearchIcon from "@material-ui/icons/Search";
import WhatsAppIcon from "@material-ui/icons/WhatsApp";
import LockIcon from "@material-ui/icons/Lock";
import ArrowBackIcon from "@material-ui/icons/ArrowBack";
import IconButton from "@material-ui/core/IconButton";
import CircularProgress from "@material-ui/core/CircularProgress";
import { parseISO, format, isToday, isYesterday } from "date-fns";
import clsx from "clsx";

import api from "../../services/api";
import openSocket from "../../services/socket-io";
import { AuthContext } from "../../context/Auth/AuthContext";
import { ReplyMessageProvider } from "../../context/ReplyingMessage/ReplyingMessageContext";
import MessagesList from "../../components/MessagesList";
import MessageInput from "../../components/MessageInput";

// Anubis Store Dark Palette
const C = {
  deepNavy: "#10232A",
  panelBg: "#1a2e36",
  slateGray: "#3D4D55",
  warmGray: "#A79E9C",
  warmBeige: "#D3C3B9",
  goldAccent: "#B58863",
  pureBlack: "#161616",
  divider: "rgba(61,77,85,0.35)",
};

const useStyles = makeStyles((theme) => ({
  mainContainer: {
    display: "flex",
    height: "calc(100vh - 48px)",
    overflow: "hidden",
    backgroundColor: C.deepNavy,
  },

  /* ─── LEFT PANEL ─── */
  leftPanel: {
    width: "380px",
    minWidth: "320px",
    maxWidth: "460px",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: C.deepNavy,
    borderRight: `1px solid ${C.divider}`,
    zIndex: 2,
    [theme.breakpoints.down("sm")]: {
      width: "100%",
      maxWidth: "100%",
    },
  },
  leftPanelHiddenMobile: {
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },

  headerLeft: {
    height: "60px",
    backgroundColor: C.pureBlack,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderBottom: `1px solid ${C.divider}`,
  },
  headerLeftTitle: {
    fontWeight: 600,
    fontSize: "1.1rem",
    color: C.warmBeige,
    display: "flex",
    alignItems: "center",
    gap: "10px",
    letterSpacing: "0.3px",
  },
  headerBrand: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: C.goldAccent,
    color: C.pureBlack,
    fontWeight: 700,
    fontSize: "0.72rem",
    padding: "3px 10px",
    borderRadius: "12px",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  },

  searchContainer: {
    padding: "10px 12px",
    backgroundColor: C.deepNavy,
    borderBottom: `1px solid ${C.divider}`,
  },
  searchWrapper: {
    display: "flex",
    alignItems: "center",
    backgroundColor: C.panelBg,
    borderRadius: "8px",
    padding: "6px 12px",
    transition: "background-color 0.2s ease",
    "&:focus-within": {
      backgroundColor: C.slateGray,
    },
  },
  searchInput: {
    marginLeft: "8px",
    flex: 1,
    fontSize: "0.88rem",
    color: C.warmBeige,
    "&::placeholder": {
      color: C.warmGray,
      opacity: 1,
    },
  },

  filterPills: {
    display: "flex",
    gap: "8px",
    padding: "8px 12px 12px 12px",
    backgroundColor: C.deepNavy,
    borderBottom: `1px solid ${C.divider}`,
    overflowX: "auto",
  },
  pill: {
    fontSize: "0.8rem",
    fontWeight: 500,
    cursor: "pointer",
    borderRadius: "16px",
    padding: "5px 14px",
    backgroundColor: C.panelBg,
    color: C.warmGray,
    border: "none",
    outline: "none",
    transition: "all 0.2s ease",
    "&:hover": {
      backgroundColor: C.slateGray,
      color: C.warmBeige,
    },
  },
  pillActive: {
    backgroundColor: `${C.goldAccent} !important`,
    color: `${C.pureBlack} !important`,
    fontWeight: 700,
  },

  chatList: {
    flex: 1,
    overflowY: "auto",
    backgroundColor: C.deepNavy,
    "&::-webkit-scrollbar": {
      width: "5px",
    },
    "&::-webkit-scrollbar-track": {
      backgroundColor: C.deepNavy,
    },
    "&::-webkit-scrollbar-thumb": {
      backgroundColor: C.slateGray,
      borderRadius: "3px",
    },
  },

  chatItem: {
    display: "flex",
    alignItems: "center",
    padding: "12px 14px",
    cursor: "pointer",
    borderBottom: `1px solid ${C.divider}`,
    transition: "background-color 0.15s ease",
    "&:hover": {
      backgroundColor: C.panelBg,
    },
  },
  chatItemActive: {
    backgroundColor: `${C.slateGray} !important`,
    borderLeft: `3px solid ${C.goldAccent}`,
    paddingLeft: "11px",
  },

  chatAvatar: {
    width: "48px",
    height: "48px",
    backgroundColor: C.slateGray,
    color: C.warmBeige,
    fontWeight: 600,
    fontSize: "1.1rem",
    marginRight: "12px",
    border: `2px solid ${C.divider}`,
  },

  chatDetails: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  chatDetailsTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: "3px",
  },
  chatName: {
    fontWeight: 600,
    fontSize: "0.95rem",
    color: C.warmBeige,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chatTime: {
    fontSize: "0.72rem",
    color: C.warmGray,
    marginLeft: "6px",
    flexShrink: 0,
  },
  chatDetailsBottom: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chatMessageSnippet: {
    fontSize: "0.84rem",
    color: C.warmGray,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "flex",
    alignItems: "center",
    gap: "3px",
  },

  unreadBadge: {
    backgroundColor: C.goldAccent,
    color: C.pureBlack,
    borderRadius: "10px",
    fontSize: "0.73rem",
    fontWeight: 700,
    minWidth: "20px",
    height: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 6px",
    marginLeft: "6px",
  },

  /* ─── RIGHT PANEL ─── */
  rightPanel: {
    flex: 1,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: C.deepNavy,
    position: "relative",
  },
  rightPanelHiddenMobile: {
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },

  rightHeader: {
    height: "60px",
    backgroundColor: C.pureBlack,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderBottom: `1px solid ${C.divider}`,
    zIndex: 1,
  },
  rightHeaderInfo: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  },
  rightHeaderTexts: {
    marginLeft: "12px",
    display: "flex",
    flexDirection: "column",
  },
  rightHeaderName: {
    fontWeight: 600,
    fontSize: "1rem",
    color: C.warmBeige,
    lineHeight: "1.2",
  },
  rightHeaderStatus: {
    fontSize: "0.78rem",
    color: C.goldAccent,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },

  messagesArea: {
    flex: 1,
    overflowY: "hidden",
    position: "relative",
    backgroundColor: C.deepNavy,
  },

  /* ─── WELCOME SCREEN ─── */
  welcomeScreen: {
    flex: 1,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.deepNavy,
    borderBottom: `4px solid ${C.goldAccent}`,
    padding: "20px",
    textAlign: "center",
  },
  welcomeIconContainer: {
    width: 100,
    height: 100,
    borderRadius: "50%",
    background: `linear-gradient(135deg, ${C.slateGray}, ${C.panelBg})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    boxShadow: `0 4px 20px rgba(0,0,0,0.3)`,
  },
  welcomeTitle: {
    fontSize: "1.8rem",
    fontWeight: 300,
    color: C.warmBeige,
    marginBottom: "10px",
    letterSpacing: "0.5px",
  },
  welcomeSubtitle: {
    fontSize: "0.92rem",
    color: C.warmGray,
    maxWidth: "480px",
    lineHeight: "1.6",
  },
  welcomeFooter: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "40px",
    color: C.warmGray,
    fontSize: "0.82rem",
  },

  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px",
  },
  emptyListMessage: {
    textAlign: "center",
    color: C.warmGray,
    padding: "40px 20px",
    fontSize: "0.9rem",
  },
}));

const formatMessageTime = (dateStr) => {
  if (!dateStr) return "";
  try {
    const d = parseISO(dateStr);
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ayer";
    return format(d, "dd/MM/yyyy");
  } catch (e) {
    return "";
  }
};

const WhatsAppWebChat = () => {
  const classes = useStyles();
  const history = useHistory();
  const { ticketId } = useParams();
  const { user } = useContext(AuthContext);

  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParam, setSearchParam] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTicket, setSelectedTicket] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchChats = async () => {
      setLoading(true);
      try {
        const { data } = await api.get("/tickets", {
          params: {
            showAll: "true",
            searchParam: searchParam.trim(),
            withUnreadMessages: filter === "unread" ? "true" : "false",
            pageNumber: 1,
          },
        });
        if (isMounted) {
          let list = data.tickets || [];
          if (filter === "groups") {
            list = list.filter((t) => t.isGroup);
          }
          setChats(list);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) setLoading(false);
      }
    };

    const delayDebounceFn = setTimeout(() => {
      fetchChats();
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(delayDebounceFn);
    };
  }, [searchParam, filter]);

  useEffect(() => {
    let isMounted = true;
    if (!ticketId) {
      setSelectedTicket(null);
      return;
    }

    const fetchSelected = async () => {
      try {
        const { data } = await api.get(`/tickets/${ticketId}`);
        if (isMounted) {
          setSelectedTicket(data);
          setChats((prev) =>
            prev.map((c) => (c.id === Number(ticketId) ? { ...c, unreadMessages: 0 } : c))
          );
        }
      } catch (err) {
        if (isMounted) setSelectedTicket(null);
      }
    };

    fetchSelected();

    return () => {
      isMounted = false;
    };
  }, [ticketId]);

  useEffect(() => {
    const socket = openSocket();

    socket.on("connect", () => {
      socket.emit("joinNotification");
    });

    socket.on("ticket", (data) => {
      if (data.action === "update" || data.action === "updateUnread") {
        setChats((prev) => {
          const index = prev.findIndex((t) => t.id === data.ticket.id);
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...data.ticket };
            return updated;
          }
          return [data.ticket, ...prev];
        });
      }
    });

    socket.on("appMessage", (data) => {
      if (data.action === "create") {
        const msg = data.message;
        setChats((prev) => {
          const tId = msg.ticketId;
          const index = prev.findIndex((t) => t.id === tId);
          if (index !== -1) {
            const current = prev[index];
            const isCurrentActive = Number(ticketId) === tId;
            const updatedTicket = {
              ...current,
              lastMessage: msg.body,
              updatedAt: msg.createdAt,
              unreadMessages: isCurrentActive ? 0 : current.unreadMessages + (msg.fromMe ? 0 : 1),
            };
            const others = prev.filter((t) => t.id !== tId);
            return [updatedTicket, ...others];
          }
          return prev;
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [ticketId]);

  const handleSelectChat = (chat) => {
    history.push(`/chats/${chat.id}`);
  };

  const handleBackToChatList = () => {
    history.push("/chats");
  };

  return (
    <div className={classes.mainContainer}>
      <div
        className={clsx(classes.leftPanel, {
          [classes.leftPanelHiddenMobile]: Boolean(ticketId),
        })}
      >
        {/* Header */}
        <div className={classes.headerLeft}>
          <Typography className={classes.headerLeftTitle}>
            <WhatsAppIcon style={{ color: C.goldAccent, fontSize: 26 }} />
            Chats
          </Typography>
          <span className={classes.headerBrand}>
            Anubis Store
          </span>
        </div>

        {/* Search */}
        <div className={classes.searchContainer}>
          <div className={classes.searchWrapper}>
            <SearchIcon style={{ color: C.warmGray, fontSize: 20 }} />
            <InputBase
              className={classes.searchInput}
              placeholder="Buscar o empezar un nuevo chat"
              value={searchParam}
              onChange={(e) => setSearchParam(e.target.value)}
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className={classes.filterPills}>
          {[
            { key: "all", label: "Todos" },
            { key: "unread", label: "No leídos" },
            { key: "groups", label: "Grupos" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={clsx(classes.pill, {
                [classes.pillActive]: filter === key,
              })}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Chat List */}
        <div className={classes.chatList}>
          {loading ? (
            <div className={classes.loadingContainer}>
              <CircularProgress size={32} style={{ color: C.goldAccent }} />
            </div>
          ) : chats.length === 0 ? (
            <div className={classes.emptyListMessage}>
              No se encontraron chats que coincidan con la búsqueda.
            </div>
          ) : (
            chats.map((chat) => {
              const isSelected = Number(ticketId) === chat.id;
              const contactName = chat.contact?.name || chat.contact?.number || "Contacto";

              return (
                <div
                  key={chat.id}
                  className={clsx(classes.chatItem, {
                    [classes.chatItemActive]: isSelected,
                  })}
                  onClick={() => handleSelectChat(chat)}
                >
                  <Avatar
                    src={chat.contact?.profilePicUrl}
                    className={classes.chatAvatar}
                  >
                    {contactName.charAt(0).toUpperCase()}
                  </Avatar>
                  <div className={classes.chatDetails}>
                    <div className={classes.chatDetailsTop}>
                      <Typography className={classes.chatName}>
                        {contactName}
                      </Typography>
                      <Typography
                        className={classes.chatTime}
                        style={chat.unreadMessages > 0 ? { color: C.goldAccent } : {}}
                      >
                        {formatMessageTime(chat.updatedAt)}
                      </Typography>
                    </div>
                    <div className={classes.chatDetailsBottom}>
                      <Typography className={classes.chatMessageSnippet}>
                        {chat.lastMessage || "Sin mensajes"}
                      </Typography>
                      {chat.unreadMessages > 0 && (
                        <div className={classes.unreadBadge}>
                          {chat.unreadMessages}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ─── RIGHT PANEL ─── */}
      <div
        className={clsx(classes.rightPanel, {
          [classes.rightPanelHiddenMobile]: !Boolean(ticketId),
        })}
      >
        {selectedTicket ? (
          <ReplyMessageProvider>
            <div className={classes.rightHeader}>
              <div className={classes.rightHeaderInfo}>
                <IconButton
                  style={{ marginRight: 4, padding: 6 }}
                  onClick={handleBackToChatList}
                >
                  <ArrowBackIcon style={{ color: C.warmGray }} />
                </IconButton>
                <Avatar
                  src={selectedTicket.contact?.profilePicUrl}
                  style={{
                    width: 40,
                    height: 40,
                    backgroundColor: C.slateGray,
                    color: C.warmBeige,
                    border: `2px solid ${C.divider}`,
                  }}
                >
                  {(selectedTicket.contact?.name || "C").charAt(0).toUpperCase()}
                </Avatar>
                <div className={classes.rightHeaderTexts}>
                  <Typography className={classes.rightHeaderName}>
                    {selectedTicket.contact?.name || selectedTicket.contact?.number}
                  </Typography>
                  <Typography className={classes.rightHeaderStatus}>
                    <span style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      backgroundColor: C.goldAccent,
                      display: "inline-block",
                    }} />
                    {selectedTicket.contact?.number
                      ? `+${selectedTicket.contact.number} • Conectado`
                      : "En línea"}
                  </Typography>
                </div>
              </div>
            </div>

            <div className={classes.messagesArea}>
              <MessagesList
                ticketId={selectedTicket.id}
                isGroup={selectedTicket.isGroup}
              />
            </div>

            <MessageInput ticketStatus={selectedTicket.status || "open"} />
          </ReplyMessageProvider>
        ) : (
          <div className={classes.welcomeScreen}>
            <div className={classes.welcomeIconContainer}>
              <WhatsAppIcon style={{ fontSize: 56, color: C.goldAccent }} />
            </div>
            <Typography className={classes.welcomeTitle}>
              Anubis Store
            </Typography>
            <Typography className={classes.welcomeSubtitle}>
              Envía y recibe mensajes, fotos, notas de voz y documentos en tiempo real.
              Las notificaciones se sincronizan automáticamente con tu WhatsApp.
            </Typography>
            <div className={classes.welcomeFooter}>
              <LockIcon style={{ fontSize: 16 }} />
              <span>Cifrado de extremo a extremo activo</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WhatsAppWebChat;
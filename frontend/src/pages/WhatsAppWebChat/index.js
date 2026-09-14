import React, { useState, useEffect, useContext, useRef, useCallback } from "react";
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

import Drawer from "@material-ui/core/Drawer";
import Button from "@material-ui/core/Button";
import Tooltip from "@material-ui/core/Tooltip";
import MenuBookIcon from "@material-ui/icons/MenuBook";
import CloseIcon from "@material-ui/icons/Close";
import FileCopyOutlinedIcon from "@material-ui/icons/FileCopyOutlined";
import { toast } from "react-toastify";

import api from "../../services/api";
import openSocket from "../../services/socket-io";
import { AuthContext } from "../../context/Auth/AuthContext";
import { ReplyMessageProvider } from "../../context/ReplyingMessage/ReplyingMessageContext";
import MessagesList from "../../components/MessagesList";
import MessageInput from "../../components/MessageInput";

// WhatsApp Desktop Dark Theme Palette
const C = {
  black: "#0b141a",         // deepest background for conversation panel
  darkPanel: "#111b21",     // chat list background
  cardHover: "#202c33",     // hover on chat list item
  cardActive: "#2a3942",    // active selected chat item
  headerBg: "#202c33",      // top headers
  inputField: "#202c33",    // search field background
  inputFocus: "#2a3942",    // search field focused
  divider: "#222d34",       // subtle panel separator
  textPrimary: "#e9edef",   // clean white/light text
  textSecondary: "#8696a0", // muted gray text
  greenAccent: "#00a884",   // WhatsApp green
  goldBadge: "#B58863",     // Anubis Store gold accent
  blueCheck: "#53bdeb",     // WhatsApp checkmarks & links
};

const useStyles = makeStyles((theme) => ({
  mainContainer: {
    display: "flex",
    height: "calc(100vh - 48px)",
    overflow: "hidden",
    backgroundColor: C.darkPanel,
    position: "relative",
    userSelect: (props) => (props.isResizing ? "none" : "auto"),
  },

  /* ─── LEFT PANEL (CHAT LIST) ─── */
  leftPanel: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: C.darkPanel,
    borderRight: `1px solid ${C.divider}`,
    zIndex: 2,
    flexShrink: 0,
    [theme.breakpoints.down("sm")]: {
      width: "100% !important",
    },
  },
  leftPanelHiddenMobile: {
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },

  headerLeft: {
    height: "60px",
    backgroundColor: C.headerBg,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderBottom: `1px solid ${C.divider}`,
  },
  headerLeftTitle: {
    fontWeight: 600,
    fontSize: "1.15rem",
    color: C.textPrimary,
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  headerBrand: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    backgroundColor: C.greenAccent,
    color: "#111b21",
    fontWeight: 700,
    fontSize: "0.72rem",
    padding: "3px 10px",
    borderRadius: "12px",
    letterSpacing: "0.5px",
    textTransform: "uppercase",
  },

  searchContainer: {
    padding: "10px 12px",
    backgroundColor: C.darkPanel,
    borderBottom: `1px solid ${C.divider}`,
  },
  searchWrapper: {
    display: "flex",
    alignItems: "center",
    backgroundColor: C.inputField,
    borderRadius: "8px",
    padding: "5px 12px",
    transition: "background-color 0.2s ease",
    "&:focus-within": {
      backgroundColor: C.inputFocus,
    },
  },
  searchInput: {
    marginLeft: "8px",
    flex: 1,
    fontSize: "0.88rem",
    color: C.textPrimary,
    "&::placeholder": {
      color: C.textSecondary,
      opacity: 1,
    },
  },

  filterPills: {
    display: "flex",
    gap: "8px",
    padding: "8px 12px 10px 12px",
    backgroundColor: C.darkPanel,
    borderBottom: `1px solid ${C.divider}`,
    overflowX: "auto",
  },
  pill: {
    fontSize: "0.82rem",
    fontWeight: 500,
    cursor: "pointer",
    borderRadius: "18px",
    padding: "5px 14px",
    backgroundColor: C.inputField,
    color: C.textSecondary,
    border: "none",
    outline: "none",
    transition: "all 0.15s ease",
    "&:hover": {
      backgroundColor: C.cardHover,
      color: C.textPrimary,
    },
  },
  pillActive: {
    backgroundColor: `${C.greenAccent} !important`,
    color: "#111b21 !important",
    fontWeight: 700,
  },

  chatList: {
    flex: 1,
    overflowY: "auto",
    backgroundColor: C.darkPanel,
    padding: "4px 8px",
    "&::-webkit-scrollbar": {
      width: "5px",
    },
    "&::-webkit-scrollbar-track": {
      backgroundColor: C.darkPanel,
    },
    "&::-webkit-scrollbar-thumb": {
      backgroundColor: C.cardHover,
      borderRadius: "3px",
    },
  },

  chatItem: {
    display: "flex",
    alignItems: "center",
    padding: "10px 12px",
    cursor: "pointer",
    borderRadius: "8px",
    marginBottom: "2px",
    transition: "background-color 0.15s ease",
    "&:hover": {
      backgroundColor: C.cardHover,
    },
  },
  chatItemActive: {
    backgroundColor: `${C.cardActive} !important`,
  },

  chatAvatar: {
    width: "46px",
    height: "46px",
    backgroundColor: C.cardHover,
    color: C.textPrimary,
    fontWeight: 600,
    fontSize: "1.1rem",
    marginRight: "12px",
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
    color: C.textPrimary,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chatTime: {
    fontSize: "0.72rem",
    color: C.textSecondary,
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
    color: C.textSecondary,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "flex",
    alignItems: "center",
    gap: "3px",
  },

  unreadBadge: {
    backgroundColor: C.greenAccent,
    color: "#111b21",
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

  /* ─── RESIZABLE SPLITTER ─── */
  resizer: {
    width: "5px",
    cursor: "col-resize",
    backgroundColor: C.divider,
    zIndex: 10,
    flexShrink: 0,
    transition: "background-color 0.2s ease",
    "&:hover, &:active": {
      backgroundColor: C.greenAccent,
      width: "6px",
    },
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },

  /* ─── RIGHT PANEL (CONVERSATION) ─── */
  rightPanel: {
    flex: 1,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: C.black,
    position: "relative",
    minWidth: 0,
  },
  rightPanelHiddenMobile: {
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },

  rightHeader: {
    height: "60px",
    backgroundColor: C.headerBg,
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
    color: C.textPrimary,
    lineHeight: "1.2",
  },
  rightHeaderStatus: {
    fontSize: "0.78rem",
    color: C.greenAccent,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: "4px",
  },

  messagesArea: {
    flex: 1,
    overflowY: "hidden",
    position: "relative",
    backgroundColor: C.black,
  },

  /* ─── WELCOME SCREEN ─── */
  welcomeScreen: {
    flex: 1,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.darkPanel,
    borderBottom: `4px solid ${C.greenAccent}`,
    padding: "20px",
    textAlign: "center",
  },
  welcomeIconContainer: {
    width: 90,
    height: 90,
    borderRadius: "50%",
    background: C.cardHover,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    boxShadow: `0 4px 20px rgba(0,0,0,0.4)`,
  },
  welcomeTitle: {
    fontSize: "1.8rem",
    fontWeight: 300,
    color: C.textPrimary,
    marginBottom: "10px",
  },
  welcomeSubtitle: {
    fontSize: "0.92rem",
    color: C.textSecondary,
    maxWidth: "480px",
    lineHeight: "1.6",
  },
  welcomeFooter: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "40px",
    color: C.textSecondary,
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
    color: C.textSecondary,
    padding: "40px 20px",
    fontSize: "0.9rem",
  },
}));

// Error Boundary component to protect against white screens
class ChatErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, errorInfo) {
    console.error("[ChatErrorBoundary] Caught error:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#8696a0", padding: 20 }}>
          <p>Ocurrió un error inesperado al renderizar este chat.</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{ backgroundColor: "#00a884", color: "#111b21", border: "none", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}
          >
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const formatMessageTime = (dateStr) => {
  if (!dateStr) return "";
  try {
    const d = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    if (isToday(d)) return format(d, "HH:mm");
    if (isYesterday(d)) return "Ayer";
    return format(d, "dd/MM/yyyy");
  } catch (e) {
    return "";
  }
};

const WhatsAppWebChat = () => {
  const { ticketId } = useParams();
  const history = useHistory();
  const { user } = useContext(AuthContext);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("anubis_chat_sidebar_width");
    return saved ? Math.min(Math.max(Number(saved), 260), 650) : 380;
  });
  const [isResizing, setIsResizing] = useState(false);

  const classes = useStyles({ isResizing });

  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParam, setSearchParam] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [profilePics, setProfilePics] = useState({});
  const [quickNotesDrawerOpen, setQuickNotesDrawerOpen] = useState(false);
  const [chatQuickNotes, setChatQuickNotes] = useState([]);
  const [chatNotesSearch, setChatNotesSearch] = useState("");

  useEffect(() => {
    if (quickNotesDrawerOpen) {
      api.get("/quickNotes").then(({ data }) => {
        setChatQuickNotes(data.quickNotes || []);
      }).catch(() => {});
    }
  }, [quickNotesDrawerOpen]);

  // Fetch client profile picture dynamically
  const fetchProfilePic = useCallback(async (contactId) => {
    if (!contactId || profilePics[contactId]) return;
    try {
      const { data } = await api.get(`/contacts/${contactId}/profile-pic`);
      if (data?.profilePicUrl) {
        setProfilePics((prev) => ({ ...prev, [contactId]: data.profilePicUrl }));
      }
    } catch (e) {
      // Ignore failure
    }
  }, [profilePics]);

  // Resizable splitter logic
  const startResize = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e) => {
      // 48px is typical offset of left drawer icon if present
      const newWidth = Math.min(Math.max(e.clientX - 56, 260), 650);
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      localStorage.setItem("anubis_chat_sidebar_width", String(sidebarWidth));
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, sidebarWidth]);

  // Fetch chat list
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

  // Fetch missing profile pictures for visible contacts
  useEffect(() => {
    chats.slice(0, 30).forEach((chat) => {
      if (chat.contact?.id && !chat.contact.profilePicUrl && !profilePics[chat.contact.id]) {
        fetchProfilePic(chat.contact.id);
      }
    });
  }, [chats, fetchProfilePic, profilePics]);

  // Fetch selected ticket when URL changes
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
          // If the ticket is pending, automatically open/accept it so typing works immediately
          if (data.status === "pending") {
            api.put(`/tickets/${ticketId}`, { status: "open", userId: user?.id }).catch(() => {});
            data.status = "open";
          }
          setSelectedTicket(data);
          setChats((prev) =>
            prev.map((c) => (c.id === Number(ticketId) ? { ...c, unreadMessages: 0, status: "open" } : c))
          );
          if (data.contact?.id && !data.contact.profilePicUrl) {
            fetchProfilePic(data.contact.id);
          }
        }
      } catch (err) {
        if (isMounted) setSelectedTicket(null);
      }
    };

    fetchSelected();

    return () => {
      isMounted = false;
    };
  }, [ticketId, user, fetchProfilePic]);

  // Socket.io for real-time updates
  useEffect(() => {
    const socket = openSocket();

    socket.on("connect", () => {
      socket.emit("joinNotification");
    });

    socket.on("ticket", (data) => {
      if (!data) return;

      if (data.action === "updateUnread") {
        const tId = data.ticketId || data.ticket?.id;
        if (tId) {
          setChats((prev) =>
            prev.map((c) => (c && c.id === tId ? { ...c, unreadMessages: 0 } : c))
          );
        }
        return;
      }

      if (data.action === "update" && data.ticket && data.ticket.id) {
        setChats((prev) => {
          const index = prev.findIndex((t) => t && t.id === data.ticket.id);
          if (index !== -1) {
            const updated = [...prev];
            updated[index] = { ...updated[index], ...data.ticket };
            return updated;
          }
          return [data.ticket, ...prev];
        });
        return;
      }

      if (data.action === "delete" && data.ticketId) {
        setChats((prev) => prev.filter((t) => t && t.id !== data.ticketId));
        return;
      }
    });

    socket.on("contact", (data) => {
      if (data?.action === "update" && data.contact?.id) {
        if (data.contact.profilePicUrl) {
          setProfilePics((prev) => ({ ...prev, [data.contact.id]: data.contact.profilePicUrl }));
        }
      }
    });

    socket.on("appMessage", (data) => {
      if (data && data.action === "create" && data.message) {
        const msg = data.message;
        const tId = msg.ticketId;
        if (!tId) return;

        setChats((prev) => {
          const index = prev.findIndex((t) => t && t.id === tId);
          if (index !== -1) {
            const current = prev[index];
            if (!current) return prev;
            const isCurrentActive = Number(ticketId) === tId;
            const updatedTicket = {
              ...current,
              lastMessage: msg.body || (msg.mediaType ? `[${msg.mediaType}]` : ""),
              updatedAt: msg.createdAt || new Date().toISOString(),
              unreadMessages: isCurrentActive ? 0 : ((Number(current.unreadMessages) || 0) + (msg.fromMe ? 0 : 1)),
            };
            const others = prev.filter((t) => t && t.id !== tId);
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
    if (chat.status === "pending") {
      api.put(`/tickets/${chat.id}`, { status: "open", userId: user?.id }).catch(() => {});
    }
    history.push(`/chats/${chat.id}`);
  };

  const handleBackToChatList = () => {
    history.push("/chats");
  };

  return (
    <ChatErrorBoundary>
      <div className={classes.mainContainer}>
        {/* ─── LEFT PANEL (CHAT LIST) ─── */}
        <div
          className={clsx(classes.leftPanel, {
            [classes.leftPanelHiddenMobile]: Boolean(ticketId),
          })}
          style={{ width: `${sidebarWidth}px` }}
        >
          {/* Header */}
          <div className={classes.headerLeft}>
            <Typography className={classes.headerLeftTitle}>
              <WhatsAppIcon style={{ color: C.greenAccent, fontSize: 26 }} />
              Chats
            </Typography>
            <span className={classes.headerBrand}>
              ANUBIS STORE
            </span>
          </div>

          {/* Search */}
          <div className={classes.searchContainer}>
            <div className={classes.searchWrapper}>
              <SearchIcon style={{ color: C.textSecondary, fontSize: 20 }} />
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
                <CircularProgress size={32} style={{ color: C.greenAccent }} />
              </div>
            ) : chats.length === 0 ? (
              <div className={classes.emptyListMessage}>
                No se encontraron chats que coincidan con la búsqueda.
              </div>
            ) : (
              chats.map((chat) => {
                if (!chat) return null;
                const isSelected = Number(ticketId) === chat.id;
                const contactName = String(chat.contact?.name || chat.contact?.number || "Contacto");
                const avatarPic = profilePics[chat.contact?.id] || chat.contact?.profilePicUrl;

                return (
                  <div
                    key={chat.id}
                    className={clsx(classes.chatItem, {
                      [classes.chatItemActive]: isSelected,
                    })}
                    onClick={() => handleSelectChat(chat)}
                  >
                    <Avatar
                      src={avatarPic}
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
                          style={chat.unreadMessages > 0 ? { color: C.greenAccent, fontWeight: 600 } : {}}
                        >
                          {formatMessageTime(chat.updatedAt)}
                        </Typography>
                      </div>
                      <div className={classes.chatDetailsBottom}>
                        <Typography className={classes.chatMessageSnippet}>
                          {typeof chat.lastMessage === "string" ? chat.lastMessage : (chat.lastMessage ? String(chat.lastMessage) : "Sin mensajes")}
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

        {/* ─── RESIZABLE SPLITTER / DRAG HANDLE ─── */}
        <div
          className={classes.resizer}
          onMouseDown={startResize}
          onDoubleClick={() => setSidebarWidth(380)}
          title="Arrastra para cambiar el ancho de la división (Doble clic para restablecer)"
        />

        {/* ─── RIGHT PANEL (CONVERSATION) ─── */}
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
                    <ArrowBackIcon style={{ color: C.textSecondary }} />
                  </IconButton>
                  <Avatar
                    src={profilePics[selectedTicket.contact?.id] || selectedTicket.contact?.profilePicUrl}
                    style={{
                      width: 40,
                      height: 40,
                      backgroundColor: C.cardHover,
                      color: C.textPrimary,
                    }}
                  >
                    {(String(selectedTicket.contact?.name || selectedTicket.contact?.number || "C")).charAt(0).toUpperCase()}
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
                        backgroundColor: C.greenAccent,
                        display: "inline-block",
                      }} />
                      {selectedTicket.contact?.number
                        ? `+${selectedTicket.contact.number} • Conectado`
                        : "En línea"}
                    </Typography>
                  </div>
                </div>

                {/* Quick Action Button for Notes */}
                <div>
                  <Tooltip title="Notas Rápidas y Material de Apoyo">
                    <IconButton
                      onClick={() => setQuickNotesDrawerOpen(true)}
                      style={{ padding: 8 }}
                    >
                      <MenuBookIcon style={{ color: "#B58863" }} />
                    </IconButton>
                  </Tooltip>
                </div>
              </div>

              <div className={classes.messagesArea}>
                <MessagesList
                  ticketId={selectedTicket.id}
                  isGroup={selectedTicket.isGroup}
                />
              </div>

              {/* MessageInput is always open to allow immediate typing like WhatsApp Desktop */}
              <MessageInput ticketId={selectedTicket.id} ticketStatus="open" />
            </ReplyMessageProvider>
          ) : (
            <div className={classes.welcomeScreen}>
              <div className={classes.welcomeIconContainer}>
                <WhatsAppIcon style={{ fontSize: 50, color: C.greenAccent }} />
              </div>
              <Typography className={classes.welcomeTitle}>
                WhatsApp Desktop • Anubis Store
              </Typography>
              <Typography className={classes.welcomeSubtitle}>
                Envía y recibe mensajes, fotos, videos y documentos en tiempo real.
                Las notificaciones se sincronizan automáticamente con tu WhatsApp nativo.
              </Typography>
              <div className={classes.welcomeFooter}>
                <LockIcon style={{ fontSize: 16 }} />
                <span>Cifrado de extremo a extremo activo</span>
              </div>
            </div>
          )}
        </div>

        {/* Quick Notes Side Drawer for Agents */}
        <Drawer
          anchor="right"
          open={quickNotesDrawerOpen}
          onClose={() => setQuickNotesDrawerOpen(false)}
          PaperProps={{
            style: {
              width: 380,
              maxWidth: "90vw",
              backgroundColor: "#161616",
              borderLeft: "1px solid #3D4D55",
              color: "#D3C3B9",
              padding: 16,
              display: "flex",
              flexDirection: "column",
            }
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #3D4D55", paddingBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MenuBookIcon style={{ color: "#B58863" }} />
              <Typography variant="subtitle1" style={{ fontWeight: 700, color: "#D3C3B9" }}>
                Notas Rápidas (Apoyo)
              </Typography>
            </div>
            <IconButton size="small" onClick={() => setQuickNotesDrawerOpen(false)} style={{ color: "#A79E9C" }}>
              <CloseIcon />
            </IconButton>
          </div>

          <InputBase
            placeholder="Buscar nota rápida..."
            value={chatNotesSearch}
            onChange={(e) => setChatNotesSearch(e.target.value)}
            style={{
              backgroundColor: "#1a2e36",
              color: "#D3C3B9",
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid #3D4D55",
              marginBottom: 16,
              fontSize: "0.9rem",
            }}
          />

          <div style={{ overflowY: "auto", flexGrow: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            {chatQuickNotes
              .filter(n =>
                !chatNotesSearch ||
                (n.title && n.title.toLowerCase().includes(chatNotesSearch.toLowerCase())) ||
                (n.content && n.content.toLowerCase().includes(chatNotesSearch.toLowerCase())) ||
                (n.category && n.category.toLowerCase().includes(chatNotesSearch.toLowerCase()))
              )
              .map((note) => (
                <div
                  key={note.id}
                  style={{
                    backgroundColor: "#1a2e36",
                    border: "1px solid #3D4D55",
                    borderRadius: 8,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                    <Typography variant="body2" style={{ fontWeight: 700, color: "#D3C3B9" }}>
                      {note.title}
                    </Typography>
                    <span style={{ fontSize: "0.72rem", backgroundColor: "rgba(181, 136, 99, 0.2)", color: "#B58863", padding: "1px 6px", borderRadius: 4 }}>
                      {note.category || "General"}
                    </span>
                  </div>

                  {note.mediaUrl && (
                    note.mediaType === "video" ? (
                      <video src={note.mediaUrl} controls style={{ width: "100%", maxHeight: 120, borderRadius: 6, margin: "6px 0" }} />
                    ) : (
                      <img src={note.mediaUrl} alt={note.title} style={{ width: "100%", maxHeight: 120, objectFit: "cover", borderRadius: 6, margin: "6px 0" }} />
                    )
                  )}

                  <Typography variant="caption" style={{ color: "#A79E9C", display: "block", whiteSpace: "pre-wrap", marginBottom: 8 }}>
                    {note.content}
                  </Typography>

                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FileCopyOutlinedIcon fontSize="small" />}
                    style={{ color: "#B58863", borderColor: "#B58863", textTransform: "none", fontSize: "0.78rem" }}
                    onClick={() => {
                      navigator.clipboard.writeText(note.content);
                      toast.success("¡Texto de la nota copiado!");
                    }}
                  >
                    Copiar Texto
                  </Button>
                </div>
              ))}
            {chatQuickNotes.length === 0 && (
              <Typography variant="body2" style={{ color: "#A79E9C", textAlign: "center", marginTop: 20 }}>
                No tienes notas rápidas guardadas. Puedes crearlas desde el menú lateral "Notas Rápidas".
              </Typography>
            )}
          </div>
        </Drawer>
      </div>
    </ChatErrorBoundary>
  );
};

export default WhatsAppWebChat;
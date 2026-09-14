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
import Chip from "@material-ui/core/Chip";
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

const useStyles = makeStyles((theme) => ({
  mainContainer: {
    display: "flex",
    height: "calc(100vh - 48px)",
    overflow: "hidden",
    backgroundColor: "#f0f2f5",
  },
  leftPanel: {
    width: "380px",
    minWidth: "320px",
    maxWidth: "460px",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#ffffff",
    borderRight: "1px solid #e9edef",
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
  rightPanel: {
    flex: 1,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#efeae2",
    position: "relative",
  },
  rightPanelHiddenMobile: {
    [theme.breakpoints.down("sm")]: {
      display: "none",
    },
  },
  headerLeft: {
    height: "60px",
    backgroundColor: "#f0f2f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderBottom: "1px solid #e9edef",
  },
  headerLeftTitle: {
    fontWeight: 600,
    fontSize: "1.1rem",
    color: "#111b21",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  searchContainer: {
    padding: "8px 12px",
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #f0f2f5",
  },
  searchWrapper: {
    display: "flex",
    alignItems: "center",
    backgroundColor: "#f0f2f5",
    borderRadius: "8px",
    padding: "4px 10px",
  },
  searchInput: {
    marginLeft: "8px",
    flex: 1,
    fontSize: "0.88rem",
    color: "#111b21",
  },
  filterPills: {
    display: "flex",
    gap: "6px",
    padding: "6px 12px 10px 12px",
    backgroundColor: "#ffffff",
    borderBottom: "1px solid #e9edef",
    overflowX: "auto",
  },
  pill: {
    fontSize: "0.8rem",
    fontWeight: 500,
    cursor: "pointer",
    borderRadius: "16px",
    padding: "4px 10px",
    backgroundColor: "#f0f2f5",
    color: "#54656f",
    border: "none",
    outline: "none",
    "&:hover": {
      backgroundColor: "#e9edef",
    },
  },
  pillActive: {
    backgroundColor: "#d9fdd3 !important",
    color: "#008069 !important",
    fontWeight: 600,
  },
  chatList: {
    flex: 1,
    overflowY: "auto",
    backgroundColor: "#ffffff",
  },
  chatItem: {
    display: "flex",
    alignItems: "center",
    padding: "10px 14px",
    cursor: "pointer",
    borderBottom: "1px solid #f5f6f6",
    transition: "background-color 0.15s ease",
    "&:hover": {
      backgroundColor: "#f5f6f6",
    },
  },
  chatItemActive: {
    backgroundColor: "#f0f2f5 !important",
  },
  chatAvatar: {
    width: "48px",
    height: "48px",
    backgroundColor: "#00a884",
    color: "#ffffff",
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
    color: "#111b21",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  chatTime: {
    fontSize: "0.74rem",
    color: "#667781",
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
    color: "#667781",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "flex",
    alignItems: "center",
    gap: "3px",
  },
  unreadBadge: {
    backgroundColor: "#25d366",
    color: "#ffffff",
    borderRadius: "10px",
    fontSize: "0.75rem",
    fontWeight: 700,
    minWidth: "18px",
    height: "18px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0 5px",
    marginLeft: "6px",
  },
  rightHeader: {
    height: "60px",
    backgroundColor: "#f0f2f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 16px",
    borderBottom: "1px solid #e9edef",
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
    color: "#111b21",
    lineHeight: "1.2",
  },
  rightHeaderStatus: {
    fontSize: "0.78rem",
    color: "#008069",
    fontWeight: 500,
  },
  messagesArea: {
    flex: 1,
    overflowY: "hidden",
    position: "relative",
    backgroundColor: "#efeae2",
  },
  welcomeScreen: {
    flex: 1,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0f2f5",
    borderBottom: "6px solid #25d366",
    padding: "20px",
    textAlign: "center",
  },
  welcomeTitle: {
    fontSize: "1.8rem",
    fontWeight: 300,
    color: "#41525d",
    marginTop: "24px",
    marginBottom: "10px",
  },
  welcomeSubtitle: {
    fontSize: "0.92rem",
    color: "#667781",
    maxWidth: "480px",
    lineHeight: "1.5",
  },
  welcomeFooter: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    marginTop: "40px",
    color: "#8696a0",
    fontSize: "0.82rem",
  },
  loadingContainer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "30px",
  },
  emptyListMessage: {
    textAlign: "center",
    color: "#667781",
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
        <div className={classes.headerLeft}>
          <Typography className={classes.headerLeftTitle}>
            <WhatsAppIcon style={{ color: "#25d366", fontSize: 26 }} />
            Chats
          </Typography>
          <Chip
            size="small"
            label="WhatsApp Web"
            style={{
              backgroundColor: "#d9fdd3",
              color: "#008069",
              fontWeight: 600,
              fontSize: "0.74rem",
            }}
          />
        </div>

        <div className={classes.searchContainer}>
          <div className={classes.searchWrapper}>
            <SearchIcon style={{ color: "#54656f", fontSize: 20 }} />
            <InputBase
              className={classes.searchInput}
              placeholder="Buscar o empezar un nuevo chat"
              value={searchParam}
              onChange={(e) => setSearchParam(e.target.value)}
            />
          </div>
        </div>

        <div className={classes.filterPills}>
          <button
            type="button"
            className={clsx(classes.pill, {
              [classes.pillActive]: filter === "all",
            })}
            onClick={() => setFilter("all")}
          >
            Todos
          </button>
          <button
            type="button"
            className={clsx(classes.pill, {
              [classes.pillActive]: filter === "unread",
            })}
            onClick={() => setFilter("unread")}
          >
            No leídos
          </button>
          <button
            type="button"
            className={clsx(classes.pill, {
              [classes.pillActive]: filter === "groups",
            })}
            onClick={() => setFilter("groups")}
          >
            Grupos
          </button>
        </div>

        <div className={classes.chatList}>
          {loading ? (
            <div className={classes.loadingContainer}>
              <CircularProgress size={32} style={{ color: "#25d366" }} />
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
                      <Typography className={classes.chatTime}>
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
                  <ArrowBackIcon style={{ color: "#54656f" }} />
                </IconButton>
                <Avatar
                  src={selectedTicket.contact?.profilePicUrl}
                  style={{ width: 40, height: 40, backgroundColor: "#00a884" }}
                >
                  {(selectedTicket.contact?.name || "C").charAt(0).toUpperCase()}
                </Avatar>
                <div className={classes.rightHeaderTexts}>
                  <Typography className={classes.rightHeaderName}>
                    {selectedTicket.contact?.name || selectedTicket.contact?.number}
                  </Typography>
                  <Typography className={classes.rightHeaderStatus}>
                    {selectedTicket.contact?.number ? `+${selectedTicket.contact.number} • WhatsApp Conectado` : "En línea"}
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
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                backgroundColor: "#d9fdd3",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <WhatsAppIcon style={{ fontSize: 60, color: "#25d366" }} />
            </div>
            <Typography className={classes.welcomeTitle}>
              WhatsApp Web • Anubis Store
            </Typography>
            <Typography className={classes.welcomeSubtitle}>
              Envía y recibe mensajes, fotos, notas de voz y documentos en tiempo real.
              Al abrir cualquier mensaje, las notificaciones en tu teléfono WhatsApp nativo se sincronizan y limpian automáticamente.
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
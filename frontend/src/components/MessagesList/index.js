import React, { useState, useEffect, useReducer, useRef } from "react";

import { isSameDay, parseISO, format } from "date-fns";
import openSocket from "../../services/socket-io";
import clsx from "clsx";

import { green } from "@material-ui/core/colors";
import {
  Button,
  CircularProgress,
  Divider,
  IconButton,
  makeStyles,
} from "@material-ui/core";
import {
  AccessTime,
  Block,
  Done,
  DoneAll,
  ExpandMore,
  GetApp,
} from "@material-ui/icons";

import MarkdownWrapper from "../MarkdownWrapper";
import VcardPreview from "../VcardPreview";
import LocationPreview from "../LocationPreview";
import ModalImageCors from "../ModalImageCors";
import MessageOptionsMenu from "../MessageOptionsMenu";
import whatsBackground from "../../assets/wa-background.png";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import Audio from "../Audio";

const useStyles = makeStyles((theme) => ({
  messagesListWrapper: {
    overflow: "hidden",
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
  },

  messagesList: {
    backgroundColor: "#0b141a",
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    padding: "20px 20px 20px 20px",
    overflowY: "scroll",
    [theme.breakpoints.down("sm")]: {
      paddingBottom: "90px",
    },
    ...theme.scrollbarStyles,
  },

  circleLoading: {
    color: "#00a884",
    position: "absolute",
    opacity: "70%",
    top: 0,
    left: "50%",
    marginTop: 12,
  },

  messageLeft: {
    marginRight: 20,
    marginTop: 2,
    minWidth: 100,
    maxWidth: 600,
    height: "auto",
    display: "block",
    position: "relative",
    "&:hover #messageActionsButton": {
      display: "flex",
      position: "absolute",
      top: 0,
      right: 0,
    },

    whiteSpace: "pre-wrap",
    backgroundColor: "#202c33",
    color: "#e9edef",
    alignSelf: "flex-start",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 6,
    paddingBottom: 2,
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
  },

  quotedContainerLeft: {
    margin: "-3px -80px 6px -6px",
    overflow: "hidden",
    backgroundColor: "#182229",
    borderRadius: "7.5px",
    display: "flex",
    position: "relative",
  },

  quotedMsg: {
    padding: 10,
    maxWidth: 300,
    height: "auto",
    display: "block",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
  },

  quotedSideColorLeft: {
    flex: "none",
    width: "4px",
    backgroundColor: "#53bdeb",
  },

  messageRight: {
    marginLeft: 20,
    marginTop: 2,
    minWidth: 100,
    maxWidth: 600,
    height: "auto",
    display: "block",
    position: "relative",
    "&:hover #messageActionsButton": {
      display: "flex",
      position: "absolute",
      top: 0,
      right: 0,
    },

    whiteSpace: "pre-wrap",
    backgroundColor: "#005c4b",
    color: "#e9edef",
    alignSelf: "flex-end",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 0,
    paddingLeft: 6,
    paddingRight: 6,
    paddingTop: 6,
    paddingBottom: 2,
    boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
  },

  quotedContainerRight: {
    margin: "-3px -80px 6px -6px",
    overflowY: "hidden",
    backgroundColor: "#025144",
    borderRadius: "7.5px",
    display: "flex",
    position: "relative",
  },

  quotedMsgRight: {
    padding: 10,
    maxWidth: 300,
    height: "auto",
    whiteSpace: "pre-wrap",
  },

  quotedSideColorRight: {
    flex: "none",
    width: "4px",
    backgroundColor: "#25d366",
  },

  messageActionsButton: {
    display: "none",
    position: "relative",
    color: "#999",
    zIndex: 1,
    backgroundColor: "inherit",
    opacity: "90%",
    "&:hover, &.Mui-focusVisible": { backgroundColor: "inherit" },
  },

  messageContactName: {
    display: "flex",
    color: "#53bdeb",
    fontWeight: 500,
  },

  textContentItem: {
    overflowWrap: "break-word",
    padding: "3px 80px 6px 6px",
    color: "#e9edef",
  },

  textContentItemDeleted: {
    fontStyle: "italic",
    color: "rgba(233, 237, 239, 0.4)",
    overflowWrap: "break-word",
    padding: "3px 80px 6px 6px",
  },

  messageMedia: {
    objectFit: "cover",
    width: 250,
    height: 200,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },

  timestamp: {
    fontSize: 11,
    position: "absolute",
    bottom: 0,
    right: 5,
    color: "#8696a0",
  },

  dailyTimestamp: {
    alignItems: "center",
    textAlign: "center",
    alignSelf: "center",
    width: "110px",
    backgroundColor: "#182229",
    margin: "10px",
    borderRadius: "8px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
  },

  dailyTimestampText: {
    color: "#8696a0",
    padding: 6,
    fontSize: 12,
    alignSelf: "center",
    marginLeft: "0px",
  },

  ackIcons: {
    fontSize: 18,
    verticalAlign: "middle",
    marginLeft: 4,
    color: "#8696a0",
  },

  deletedIcon: {
    fontSize: 18,
    verticalAlign: "middle",
    marginRight: 4,
  },

  ackDoneAllIcon: {
    color: "#53bdeb",
    fontSize: 18,
    verticalAlign: "middle",
    marginLeft: 4,
  },

  downloadMedia: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "inherit",
    padding: 10,
  },
}));

const reducer = (state, action) => {
  if (action.type === "LOAD_MESSAGES") {
    const messages = action.payload;
    const newMessages = [];

    messages.forEach((message) => {
      const messageIndex = state.findIndex((m) => m.id === message.id);
      if (messageIndex !== -1) {
        state[messageIndex] = message;
      } else {
        newMessages.push(message);
      }
    });

    return [...newMessages, ...state];
  }

  if (action.type === "ADD_MESSAGE") {
    const newMessage = action.payload;
    if (!newMessage || !newMessage.id) return state;
    const messageIndex = state.findIndex((m) => m.id === newMessage.id);

    if (messageIndex !== -1) {
      const newState = [...state];
      newState[messageIndex] = newMessage;
      return newState;
    }

    return [...state, newMessage];
  }

  if (action.type === "UPDATE_MESSAGE") {
    const messageToUpdate = action.payload;
    if (!messageToUpdate || !messageToUpdate.id) return state;
    const messageIndex = state.findIndex((m) => m.id === messageToUpdate.id);

    if (messageIndex !== -1) {
      const newState = [...state];
      newState[messageIndex] = messageToUpdate;
      return newState;
    }

    return state;
  }

  if (action.type === "RESET") {
    return [];
  }
};

const safeFormatTime = (dateStr) => {
  if (!dateStr) return "";
  try {
    const d = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr);
    return isNaN(d.getTime()) ? "" : format(d, "HH:mm");
  } catch (e) {
    return "";
  }
};

const safeFormatDate = (dateStr) => {
  if (!dateStr) return "";
  try {
    const d = typeof dateStr === "string" ? parseISO(dateStr) : new Date(dateStr);
    return isNaN(d.getTime()) ? "" : format(d, "dd/MM/yyyy");
  } catch (e) {
    return "";
  }
};

const MessagesList = ({ ticketId, isGroup }) => {
  const classes = useStyles();

  const [messagesList, dispatch] = useReducer(reducer, []);
  const [pageNumber, setPageNumber] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const lastMessageRef = useRef();

  const [selectedMessage, setSelectedMessage] = useState({});
  const [anchorEl, setAnchorEl] = useState(null);
  const messageOptionsMenuOpen = Boolean(anchorEl);
  const currentTicketId = useRef(ticketId);

  useEffect(() => {
    dispatch({ type: "RESET" });
    setPageNumber(1);

    currentTicketId.current = ticketId;
  }, [ticketId]);

  useEffect(() => {
    setLoading(true);
    const delayDebounceFn = setTimeout(() => {
      const fetchMessages = async () => {
        try {
          const { data } = await api.get("/messages/" + ticketId, {
            params: { pageNumber },
          });

          if (currentTicketId.current === ticketId) {
            dispatch({ type: "LOAD_MESSAGES", payload: data.messages });
            setHasMore(data.hasMore);
            setLoading(false);
          }

          if (pageNumber === 1 && data.messages.length > 1) {
            scrollToBottom();
          }
        } catch (err) {
          setLoading(false);
          toastError(err);
        }
      };
      fetchMessages();
    }, 500);
    return () => {
      clearTimeout(delayDebounceFn);
    };
  }, [pageNumber, ticketId]);

  useEffect(() => {
    const socket = openSocket();

    const join = () => {
      socket.emit("joinChatBox", String(ticketId));
      socket.emit("joinNotification");
    };

    if (socket.connected) {
      join();
    } else {
      socket.on("connect", join);
    }

    const onAppMessage = (data) => {
      try {
        if (!data || !data.message) return;

        // Ensure this message belongs to the current open chat
        if (String(data.message.ticketId) !== String(ticketId)) return;

        if (data.action === "create") {
          dispatch({ type: "ADD_MESSAGE", payload: data.message });
          setTimeout(() => {
            scrollToBottom();
          }, 50);
        }

        if (data.action === "update") {
          dispatch({ type: "UPDATE_MESSAGE", payload: data.message });
        }
      } catch (err) {
        console.warn("[MessagesList] Socket appMessage error:", err);
      }
    };

    socket.on("appMessage", onAppMessage);

    const handleLocalMessage = (e) => {
      try {
        const msg = e.detail;
        if (msg && String(msg.ticketId) === String(ticketId)) {
          dispatch({ type: "ADD_MESSAGE", payload: msg });
          setTimeout(() => {
            scrollToBottom();
          }, 50);
        }
      } catch (err) {
        console.warn("[MessagesList] Error adding local message:", err);
      }
    };

    window.addEventListener("localMessageSent", handleLocalMessage);

    return () => {
      socket.off("appMessage", onAppMessage);
      socket.off("connect", join);
      socket.emit("leaveChatBox", String(ticketId));
      window.removeEventListener("localMessageSent", handleLocalMessage);
    };
  }, [ticketId]);

  const loadMore = () => {
    setPageNumber((prevPageNumber) => prevPageNumber + 1);
  };

  const scrollToBottom = () => {
    try {
      if (lastMessageRef.current && typeof lastMessageRef.current.scrollIntoView === "function") {
        lastMessageRef.current.scrollIntoView({ behavior: "smooth" });
      }
    } catch (e) {
      // Ignore scroll failures
    }
  };

  const handleScroll = (e) => {
    if (!hasMore) return;
    const { scrollTop } = e.currentTarget;

    if (scrollTop === 0) {
      document.getElementById("messagesList").scrollTop = 1;
    }

    if (loading) {
      return;
    }

    if (scrollTop < 50) {
      loadMore();
    }
  };

  const handleOpenMessageOptionsMenu = (e, message) => {
    setAnchorEl(e.currentTarget);
    setSelectedMessage(message);
  };

  const handleCloseMessageOptionsMenu = (e) => {
    setAnchorEl(null);
  };

  const checkMessageMedia = (message) => {
    if (!message || message.mediaType === "chat" || !message.mediaType) return null;
    if (message.mediaType === "location" && message.body && typeof message.body === "string" && message.body.split('|').length >= 2) {
      let locationParts = message.body.split('|')
      let imageLocation = locationParts[0] || ""
      let linkLocation = locationParts[1] || ""

      let descriptionLocation = null

      if (locationParts.length > 2)
        descriptionLocation = message.body.split('|')[2]

      return <LocationPreview image={imageLocation} link={linkLocation} description={descriptionLocation} />
    }
    else if (message.mediaType === "vcard" && message.body && typeof message.body === "string") {
      let array = message.body.split("\n");
      let obj = [];
      let contact = "";
      for (let index = 0; index < array.length; index++) {
        const v = array[index] || "";
        let values = v.split(":");
        for (let ind = 0; ind < values.length; ind++) {
          if (values[ind] && values[ind].indexOf("+") !== -1) {
            obj.push({ number: values[ind] });
          }
          if (values[ind] && values[ind].indexOf("FN") !== -1) {
            contact = values[ind + 1] || "";
          }
        }
      }
      return <VcardPreview contact={contact} numbers={obj[0]?.number} />
    }
    else if (message.mediaType === "image" && message.mediaUrl) {
      return <ModalImageCors imageUrl={message.mediaUrl} />;
    } else if (message.mediaType === "audio" && message.mediaUrl) {
      return <Audio url={message.mediaUrl} />
    } else if (message.mediaType === "video" && message.mediaUrl) {
      return (
        <video
          className={classes.messageMedia}
          src={message.mediaUrl}
          controls
        />
      );
    } else if (message.mediaUrl && message.mediaUrl !== "/public/" && !message.mediaUrl.endsWith("/public/")) {
      return (
        <>
          <div className={classes.downloadMedia}>
            <Button
              startIcon={<GetApp />}
              color="primary"
              variant="outlined"
              target="_blank"
              href={message.mediaUrl}
            >
              Download
            </Button>
          </div>
          <Divider />
        </>
      );
    }
    return null;
  };

  const renderMessageAck = (message) => {
    if (message.ack === 0) {
      return <AccessTime fontSize="small" className={classes.ackIcons} />;
    }
    if (message.ack === 1) {
      return <Done fontSize="small" className={classes.ackIcons} />;
    }
    if (message.ack === 2) {
      return <DoneAll fontSize="small" className={classes.ackIcons} />;
    }
    if (message.ack === 3 || message.ack === 4) {
      return <DoneAll fontSize="small" className={classes.ackDoneAllIcon} />;
    }
  };

  const renderDailyTimestamps = (message, index) => {
    if (index === 0) {
      return (
        <span
          className={classes.dailyTimestamp}
          key={`timestamp-${message.id}`}
        >
          <div className={classes.dailyTimestampText}>
            {safeFormatDate(messagesList[index]?.createdAt)}
          </div>
        </span>
      );
    }
    if (index < messagesList.length - 1 && messagesList[index]?.createdAt && messagesList[index - 1]?.createdAt) {
      try {
        let messageDay = parseISO(messagesList[index].createdAt);
        let previousMessageDay = parseISO(messagesList[index - 1].createdAt);

        if (!isSameDay(messageDay, previousMessageDay)) {
          return (
            <span
              className={classes.dailyTimestamp}
              key={`timestamp-${message.id}`}
            >
              <div className={classes.dailyTimestampText}>
                {safeFormatDate(messagesList[index].createdAt)}
              </div>
            </span>
          );
        }
      } catch (e) {}
    }
    if (index === messagesList.length - 1) {
      return (
        <div
          key={`ref-${message.createdAt || index}`}
          ref={lastMessageRef}
          style={{ float: "left", clear: "both" }}
        />
      );
    }
  };

  const renderMessageDivider = (message, index) => {
    if (index < messagesList.length && index > 0) {
      let messageUser = messagesList[index].fromMe;
      let previousMessageUser = messagesList[index - 1].fromMe;

      if (messageUser !== previousMessageUser) {
        return (
          <span style={{ marginTop: 16 }} key={`divider-${message.id}`}></span>
        );
      }
    }
  };

  const handleScrollToMessage = (targetId) => {
    if (!targetId) return;
    const element = document.getElementById(`message-${targetId}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      const originalOutline = element.style.outline;
      element.style.outline = "2px solid #25D366";
      element.style.borderRadius = "8px";
      setTimeout(() => {
        element.style.outline = originalOutline;
      }, 1500);
    }
  };

  const renderQuotedMessage = (message) => {
    return (
      <div
        className={clsx(classes.quotedContainerLeft, {
          [classes.quotedContainerRight]: message.fromMe,
        })}
        style={{ cursor: "pointer" }}
        onClick={() => handleScrollToMessage(message.quotedMsg?.id)}
      >
        <span
          className={clsx(classes.quotedSideColorLeft, {
            [classes.quotedSideColorRight]: message.quotedMsg?.fromMe,
          })}
        ></span>
        <div className={classes.quotedMsg}>
            {!message.quotedMsg?.fromMe && (
              <span className={classes.messageContactName}>
                {message.quotedMsg?.contact?.name || message.quotedMsg?.contact?.number || "Contacto"}
              </span>
            )}
          {message.quotedMsg?.mediaType === "image" ||
          (message.quotedMsg?.mediaUrl &&
            /\.(jpe?g|png|gif|webp)$/i.test(message.quotedMsg.mediaUrl)) ? (
            <span>📷 Foto {message.quotedMsg.body || ""}</span>
          ) : message.quotedMsg?.mediaType === "video" ||
            (message.quotedMsg?.mediaUrl &&
              /\.(mp4|mov|avi)$/i.test(message.quotedMsg.mediaUrl)) ? (
            <span>🎥 Video {message.quotedMsg.body || ""}</span>
          ) : message.quotedMsg?.mediaType === "audio" ||
            (message.quotedMsg?.mediaUrl &&
              /\.(mp3|ogg|wav)$/i.test(message.quotedMsg.mediaUrl)) ? (
            <span>🎵 Audio</span>
          ) : (
            typeof message.quotedMsg?.body === "string" ? message.quotedMsg.body : String(message.quotedMsg?.body || "")
          )}
        </div>
      </div>
    );
  };

  const renderMessages = () => {
    if (messagesList.length > 0) {
      const viewMessagesList = messagesList.map((message, index) => {
        try {
          if (!message || !message.id) return null;
          if (!message.fromMe) {
            return (
              <React.Fragment key={message.id}>
                {renderDailyTimestamps(message, index)}
                {renderMessageDivider(message, index)}
                <div className={classes.messageLeft} id={`message-${message.id}`}>
                  <IconButton
                    variant="contained"
                    size="small"
                    id="messageActionsButton"
                    disabled={message.isDeleted}
                    className={classes.messageActionsButton}
                    onClick={(e) => handleOpenMessageOptionsMenu(e, message)}
                  >
                    <ExpandMore />
                  </IconButton>
                  {isGroup && (
                    <span className={classes.messageContactName}>
                      {message.contact?.name}
                    </span>
                  )}
                  {(message.mediaUrl || message.mediaType === "location" || message.mediaType === "vcard"
                    //|| message.mediaType === "multi_vcard" 
                  ) && checkMessageMedia(message)}
                  <div className={classes.textContentItem}>
                    {message.quotedMsg && renderQuotedMessage(message)}
                    <MarkdownWrapper>{typeof message.body === "string" ? message.body : String(message.body || "")}</MarkdownWrapper>
                    <span className={classes.timestamp}>
                      {safeFormatTime(message.createdAt)}
                    </span>
                  </div>
                </div>
              </React.Fragment>
            );
          } else {
            return (
              <React.Fragment key={message.id}>
                {renderDailyTimestamps(message, index)}
                {renderMessageDivider(message, index)}
                <div className={classes.messageRight} id={`message-${message.id}`}>
                  <IconButton
                    variant="contained"
                    size="small"
                    id="messageActionsButton"
                    disabled={message.isDeleted}
                    className={classes.messageActionsButton}
                    onClick={(e) => handleOpenMessageOptionsMenu(e, message)}
                  >
                    <ExpandMore />
                  </IconButton>
                  {(message.mediaUrl || message.mediaType === "location" || message.mediaType === "vcard"
                    //|| message.mediaType === "multi_vcard" 
                  ) && checkMessageMedia(message)}
                  <div
                    className={clsx(classes.textContentItem, {
                      [classes.textContentItemDeleted]: message.isDeleted,
                    })}
                  >
                    {message.isDeleted && (
                      <Block
                        color="disabled"
                        fontSize="small"
                        className={classes.deletedIcon}
                      />
                    )}
                    {message.quotedMsg && renderQuotedMessage(message)}
                    <MarkdownWrapper>{typeof message.body === "string" ? message.body : String(message.body || "")}</MarkdownWrapper>
                    <span className={classes.timestamp}>
                      {safeFormatTime(message.createdAt)}
                      {renderMessageAck(message)}
                    </span>
                  </div>
                </div>
              </React.Fragment>
            );
          }
        } catch (msgErr) {
          console.error("Error rendering message item:", msgErr);
          return null;
        }
      });
      return viewMessagesList;
    } else {
      return (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "#8696a0", fontSize: "0.9rem" }}>
          Inicia la conversación enviando un mensaje o adjuntando fotos y videos.
        </div>
      );
    }
  };

  return (
    <div className={classes.messagesListWrapper}>
      <MessageOptionsMenu
        message={selectedMessage}
        anchorEl={anchorEl}
        menuOpen={messageOptionsMenuOpen}
        handleClose={handleCloseMessageOptionsMenu}
      />
      <div
        id="messagesList"
        className={classes.messagesList}
        onScroll={handleScroll}
      >
        {messagesList.length > 0 ? renderMessages() : []}
        <div ref={lastMessageRef} style={{ float: "left", clear: "both" }} />
      </div>
      {loading && (
        <div>
          <CircularProgress className={classes.circleLoading} />
        </div>
      )}
    </div>
  );
};

export default MessagesList;
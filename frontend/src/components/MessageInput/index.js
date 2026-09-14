import React, { useState, useEffect, useContext, useRef } from "react";
import "emoji-mart/css/emoji-mart.css";
import { useParams } from "react-router-dom";
import { Picker } from "emoji-mart";
import clsx from "clsx";

import { makeStyles } from "@material-ui/core/styles";
import Paper from "@material-ui/core/Paper";
import InputBase from "@material-ui/core/InputBase";
import CircularProgress from "@material-ui/core/CircularProgress";
import AttachFileIcon from "@material-ui/icons/AttachFile";
import IconButton from "@material-ui/core/IconButton";
import MoodIcon from "@material-ui/icons/Mood";
import SendIcon from "@material-ui/icons/Send";
import CancelIcon from "@material-ui/icons/Cancel";
import ClearIcon from "@material-ui/icons/Clear";
import ClickAwayListener from "@material-ui/core/ClickAwayListener";

import { i18n } from "../../translate/i18n";
import api from "../../services/api";
import { ReplyMessageContext } from "../../context/ReplyingMessage/ReplyingMessageContext";
import { AuthContext } from "../../context/Auth/AuthContext";
import toastError from "../../errors/toastError";

const useStyles = makeStyles(theme => ({
  mainWrapper: {
    background: "#161616",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    borderTop: "1px solid rgba(61, 77, 85, 0.35)",
    [theme.breakpoints.down("sm")]: {
      position: "fixed",
      bottom: 0,
      width: "100%",
    },
  },

  newMessageBox: {
    background: "#161616",
    width: "100%",
    display: "flex",
    padding: "7px",
    alignItems: "center",
  },

  messageInputWrapper: {
    padding: 6,
    marginRight: 7,
    background: "#1a2e36",
    border: "1px solid #3D4D55",
    display: "flex",
    borderRadius: 20,
    flex: 1,
    position: "relative",
  },

  messageInput: {
    paddingLeft: 10,
    flex: 1,
    border: "none",
    color: "#D3C3B9",
  },

  sendMessageIcons: {
    color: "#A79E9C",
  },

  uploadInput: {
    display: "none",
  },

  viewMediaInputWrapper: {
    display: "flex",
    padding: "10px 13px",
    position: "relative",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#161616",
    borderTop: "1px solid rgba(61, 77, 85, 0.35)",
  },

  emojiBox: {
    position: "absolute",
    bottom: 63,
    width: 40,
    borderTop: "1px solid #3D4D55",
  },

  circleLoading: {
    color: "#B58863",
    opacity: "70%",
    position: "absolute",
    top: "20%",
    left: "50%",
    marginLeft: -12,
  },

  mediaPreviewContainer: {
    display: "flex",
    alignItems: "center",
    maxWidth: "80%",
    overflow: "hidden",
  },

  mediaThumbnail: {
    maxHeight: 50,
    maxWidth: 60,
    borderRadius: 6,
    marginRight: 10,
    objectFit: "cover",
  },

  mediaFilename: {
    color: "#D3C3B9",
    fontSize: "0.85rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  replyginMsgWrapper: {
    display: "flex",
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    paddingLeft: 73,
    paddingRight: 7,
  },

  replyginMsgContainer: {
    flex: 1,
    marginRight: 5,
    overflowY: "hidden",
    backgroundColor: "#1a2e36",
    borderRadius: "7.5px",
    display: "flex",
    position: "relative",
  },

  replyginMsgBody: {
    padding: 10,
    height: "auto",
    display: "block",
    whiteSpace: "pre-wrap",
    overflow: "hidden",
    color: "#D3C3B9",
  },

  replyginContactMsgSideColor: {
    flex: "none",
    width: "4px",
    backgroundColor: "#B58863",
  },

  replyginSelfMsgSideColor: {
    flex: "none",
    width: "4px",
    backgroundColor: "#B58863",
  },

  messageContactName: {
    display: "flex",
    color: "#B58863",
    fontWeight: 500,
  },
  messageQuickAnswersWrapper: {
    margin: 0,
    position: "absolute",
    bottom: "50px",
    background: "#1a2e36",
    padding: "4px",
    borderRadius: "6px",
    border: "1px solid #3D4D55",
    left: 0,
    width: "100%",
    zIndex: 10,
    maxHeight: "180px",
    overflowY: "auto",
    "& li": {
      listStyle: "none",
      "& a": {
        display: "block",
        padding: "8px 12px",
        textOverflow: "ellipsis",
        overflow: "hidden",
        whiteSpace: "nowrap",
        color: "#D3C3B9",
        borderRadius: "4px",
        "&:hover": {
          background: "#3D4D55",
          cursor: "pointer",
        },
      },
    },
  },
}));

const MessageInput = ({ ticketId: propTicketId, ticketStatus }) => {
  const classes = useStyles();
  const { ticketId: paramTicketId } = useParams();
  const ticketId = propTicketId || paramTicketId;

  const [medias, setMedias] = useState([]);
  const [quickMedia, setQuickMedia] = useState(null);
  const [inputMessage, setInputMessage] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [loading, setLoading] = useState(false);
  const [quickAnswers, setQuickAnswer] = useState([]);
  const [typeBar, setTypeBar] = useState(false);
  const inputRef = useRef();
  const { setReplyingMessage, replyingMessage } =
    useContext(ReplyMessageContext);

  useEffect(() => {
    inputRef.current && inputRef.current.focus();
  }, [replyingMessage]);

  useEffect(() => {
    inputRef.current && inputRef.current.focus();
    return () => {
      setInputMessage("");
      setShowEmoji(false);
      setMedias([]);
      setQuickMedia(null);
      setReplyingMessage(null);
    };
  }, [ticketId, setReplyingMessage]);

  const handleChangeInput = e => {
    setInputMessage(e.target.value);
    handleLoadQuickAnswer(e.target.value);
  };

  const handleQuickAnswersClick = qa => {
    setInputMessage(qa.message || "");
    if (qa.mediaUrl) {
      setQuickMedia({
        url: qa.mediaUrl,
        type: qa.mediaType || "image"
      });
    }
    setTypeBar(false);
  };

  const handleAddEmoji = e => {
    let emoji = e.native;
    setInputMessage(prevState => prevState + emoji);
  };

  const handleChangeMedias = e => {
    if (!e.target.files || e.target.files.length === 0) {
      return;
    }
    const selectedMedias = Array.from(e.target.files);
    setMedias(selectedMedias);
  };

  const handleInputPaste = e => {
    if (e.clipboardData.files && e.clipboardData.files[0]) {
      setMedias([e.clipboardData.files[0]]);
    }
  };

  const handleUploadMedia = async e => {
    if (!ticketId || medias.length === 0) return;
    setLoading(true);
    e && e.preventDefault && e.preventDefault();

    const formData = new FormData();
    formData.append("fromMe", "true");
    if (replyingMessage) {
      formData.append("quotedMsg", JSON.stringify(replyingMessage));
    }
    medias.forEach(media => {
      formData.append("medias", media);
      formData.append("body", inputMessage.trim() || media.name);
    });

    try {
      const { data: sentData } = await api.post(`/messages/${ticketId}`, formData);
      if (Array.isArray(sentData)) {
        sentData.forEach((m) => {
          if (m && m.id) window.dispatchEvent(new CustomEvent("localMessageSent", { detail: m }));
        });
      } else if (sentData && sentData.id) {
        window.dispatchEvent(new CustomEvent("localMessageSent", { detail: sentData }));
      }
      setMedias([]);
      setQuickMedia(null);
      setInputMessage("");
      setReplyingMessage(null);
    } catch (err) {
      toastError(err);
    }

    setLoading(false);
  };

  const handleSendMessage = async () => {
    if (!ticketId) return;
    if (inputMessage.trim() === "" && medias.length === 0 && !quickMedia) return;

    if (medias.length > 0) {
      return handleUploadMedia();
    }

    setLoading(true);

    const message = {
      read: 1,
      fromMe: true,
      mediaUrl: quickMedia ? quickMedia.url : "",
      body: inputMessage.trim(),
      quotedMsg: replyingMessage,
    };
    try {
      if (ticketStatus === "pending") {
        api.put(`/tickets/${ticketId}`, { status: "open" }).catch(() => {});
      }
      const { data: sentMessage } = await api.post(`/messages/${ticketId}`, message);
      if (sentMessage && sentMessage.id) {
        window.dispatchEvent(new CustomEvent("localMessageSent", { detail: sentMessage }));
      }
      setInputMessage("");
      setQuickMedia(null);
      setShowEmoji(false);
      setReplyingMessage(null);
    } catch (err) {
      toastError(err);
    }

    setLoading(false);
  };

  const handleLoadQuickAnswer = async value => {
    if (value && value.indexOf("/") === 0) {
      try {
        const { data } = await api.get("/quickAnswers/", {
          params: { searchParam: value.substring(1) },
        });
        setQuickAnswer(data.quickAnswers || []);
        if (data.quickAnswers && data.quickAnswers.length > 0) {
          setTypeBar(true);
        } else {
          setTypeBar(false);
        }
      } catch (err) {
        setTypeBar(false);
      }
    } else {
      setTypeBar(false);
    }
  };

  const renderReplyingMessage = message => {
    return (
      <div className={classes.replyginMsgWrapper}>
        <div className={classes.replyginMsgContainer}>
          <span
            className={clsx(classes.replyginContactMsgSideColor, {
              [classes.replyginSelfMsgSideColor]: !message.fromMe,
            })}
          ></span>
          <div className={classes.replyginMsgBody}>
            {!message.fromMe && (
              <span className={classes.messageContactName}>
                {message.contact?.name}
              </span>
            )}
            {message.mediaType === "image" ||
            (message.mediaUrl &&
              /\.(jpe?g|png|gif|webp)$/i.test(message.mediaUrl)) ? (
              <span>📷 Foto {message.body || ""}</span>
            ) : message.mediaType === "video" ||
              (message.mediaUrl &&
                /\.(mp4|mov|avi)$/i.test(message.mediaUrl)) ? (
              <span>🎥 Video {message.body || ""}</span>
            ) : message.mediaType === "audio" ||
              (message.mediaUrl &&
                /\.(mp3|ogg|wav)$/i.test(message.mediaUrl)) ? (
              <span>🎵 Audio</span>
            ) : (
              message.body
            )}
          </div>
        </div>
        <IconButton
          aria-label="clearReply"
          component="span"
          disabled={loading}
          onClick={() => setReplyingMessage(null)}
        >
          <ClearIcon className={classes.sendMessageIcons} />
        </IconButton>
      </div>
    );
  };

  return (
    <Paper square elevation={0} className={classes.mainWrapper}>
      {replyingMessage && renderReplyingMessage(replyingMessage)}

      {/* Media Attachment Preview Bar */}
      {medias.length > 0 && (
        <div className={classes.viewMediaInputWrapper}>
          <IconButton
            aria-label="cancel-upload"
            component="span"
            onClick={() => setMedias([])}
          >
            <CancelIcon className={classes.sendMessageIcons} />
          </IconButton>

          <div className={classes.mediaPreviewContainer}>
            {medias[0].type && medias[0].type.startsWith("image/") && (
              <img
                src={URL.createObjectURL(medias[0])}
                alt="preview"
                className={classes.mediaThumbnail}
              />
            )}
            <span className={classes.mediaFilename}>
              {medias[0]?.name}
            </span>
          </div>

          {loading ? (
            <CircularProgress size={24} style={{ color: "#B58863", margin: "0 12px" }} />
          ) : (
            <IconButton
              aria-label="send-upload"
              component="span"
              onClick={handleUploadMedia}
              disabled={loading}
            >
              <SendIcon style={{ color: "#B58863" }} />
            </IconButton>
          )}
        </div>
      )}

      {/* Quick Media Attachment Preview Bar */}
      {quickMedia && medias.length === 0 && (
        <div className={classes.viewMediaInputWrapper}>
          <IconButton
            aria-label="cancel-quick-media"
            component="span"
            onClick={() => setQuickMedia(null)}
          >
            <CancelIcon className={classes.sendMessageIcons} />
          </IconButton>

          <div className={classes.mediaPreviewContainer}>
            {quickMedia.type === "video" ? (
              <video
                src={quickMedia.url}
                className={classes.mediaThumbnail}
              />
            ) : (
              <img
                src={quickMedia.url}
                alt="quick-preview"
                className={classes.mediaThumbnail}
              />
            )}
            <span className={classes.mediaFilename}>
              Adjunto de Respuesta Rápida
            </span>
          </div>

          <IconButton
            aria-label="send-quick-media"
            component="span"
            onClick={handleSendMessage}
            disabled={loading}
          >
            <SendIcon style={{ color: "#B58863" }} />
          </IconButton>
        </div>
      )}

      {/* Main Input Bar */}
      <div className={classes.newMessageBox}>
        <IconButton
          aria-label="emojiPicker"
          component="span"
          disabled={loading}
          onClick={() => setShowEmoji(prevState => !prevState)}
        >
          <MoodIcon className={classes.sendMessageIcons} />
        </IconButton>

        {showEmoji && (
          <div className={classes.emojiBox}>
            <ClickAwayListener onClickAway={() => setShowEmoji(false)}>
              <Picker
                perLine={16}
                showPreview={false}
                showSkinTones={false}
                onSelect={handleAddEmoji}
              />
            </ClickAwayListener>
          </div>
        )}

        <input
          multiple
          type="file"
          id="upload-button"
          disabled={loading}
          className={classes.uploadInput}
          onChange={handleChangeMedias}
          accept="image/*,video/*,application/pdf,application/*"
        />
        <label htmlFor="upload-button">
          <IconButton
            aria-label="upload"
            component="span"
            disabled={loading}
          >
            <AttachFileIcon className={classes.sendMessageIcons} />
          </IconButton>
        </label>

        <div className={classes.messageInputWrapper}>
          <InputBase
            inputRef={input => {
              input && input.focus();
              input && (inputRef.current = input);
            }}
            className={classes.messageInput}
            placeholder={medias.length > 0 ? "Añadir un comentario (opcional)..." : "Escribe un mensaje o escribe / para respuestas rápidas"}
            multiline
            maxRows={5}
            value={inputMessage}
            onChange={handleChangeInput}
            disabled={loading}
            onPaste={handleInputPaste}
            onKeyPress={e => {
              if (loading || e.shiftKey) return;
              else if (e.key === "Enter") {
                e.preventDefault();
                handleSendMessage();
              }
            }}
          />

          {typeBar && (
            <ul className={classes.messageQuickAnswersWrapper}>
              {quickAnswers.map((qa, index) => (
                <li key={index}>
                  <a onClick={() => handleQuickAnswersClick(qa)}>
                    <strong>/{qa.shortcut}</strong> - {qa.message}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(inputMessage.trim() || medias.length > 0) && (
          <IconButton
            aria-label="sendMessage"
            component="span"
            onClick={handleSendMessage}
            disabled={loading}
          >
            <SendIcon style={{ color: "#B58863" }} />
          </IconButton>
        )}
      </div>
    </Paper>
  );
};

export default MessageInput;

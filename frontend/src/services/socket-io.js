import openSocket from "socket.io-client";
import { getBackendUrl } from "../config";

function getSafeToken() {
  const token = localStorage.getItem("token");
  if (!token) return "";
  try {
    const parsed = JSON.parse(token);
    return typeof parsed === "string" ? parsed : token;
  } catch (e) {
    return token;
  }
}

function connectToSocket() {
  const token = getSafeToken();
  return openSocket(getBackendUrl(), {
    transports: ["websocket", "polling"],
    query: {
      token,
    },
  });
}

export default connectToSocket;
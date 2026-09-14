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

let socketInstance = null;

function connectToSocket() {
  const token = getSafeToken();
  if (!socketInstance || socketInstance.disconnected) {
    socketInstance = openSocket(getBackendUrl(), {
      transports: ["websocket", "polling"],
      query: {
        token,
      },
    });
  }
  return socketInstance;
}

export default connectToSocket;
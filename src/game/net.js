import { validMessage } from "./protocol.js";
import { roomInvitationLink } from "./sharing.js";
import { Peer } from "peerjs";

const PEER_OPTS = {
  debug: 0,
  secure: true,
  host: "0.peerjs.com",
  port: 443,
  path: "/",
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
      },
    ],
  },
};

const CONNECT_OPTS = { reliable: true, serialization: "json" };
const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_MS = 7000;
const HEARTBEAT_START_GRACE_MS = 20000;
const HEARTBEAT_PING = "__fotw_ping";
const HEARTBEAT_PONG = "__fotw_pong";

function roomId() {
  return "lns" + crypto.randomUUID().replaceAll("-", "");
}

function guestId() {
  return "lnsc" + crypto.randomUUID().replaceAll("-", "");
}

function makePeer(id) {
  return new Peer(id, PEER_OPTS);
}

export function parseRoomFromUrl() {
  const h = location.hash.replace(/^#/, "");
  const q = new URLSearchParams(h.includes("=") ? h : `r=${h}`);
  const id = q.get("r") || "";
  return /^[a-zA-Z0-9_-]{3,80}$/.test(id) ? id : "";
}

export function roomLink(id) {
  return roomInvitationLink(location.href, id);
}

export function wasHosting(id) {
  try {
    return sessionStorage.getItem("lns-host") === id;
  } catch {
    return false;
  }
}

export function rememberHost(id) {
  try {
    if (id) sessionStorage.setItem("lns-host", id);
    else sessionStorage.removeItem("lns-host");
  } catch {
    /* ignore */
  }
}

export function hostRoom(handlers, existingId) {
  const id = existingId || roomId();
  const peer = makePeer(id);
  const conns = new Map();

  function each(fn, exceptId) {
    for (const [pid, c] of conns) {
      if (exceptId && pid === exceptId) continue;
      if (c.open) fn(c, pid);
    }
  }

  function attach(c) {
    if (conns.has(c.peer)) { c.close(); return; }
    const pid = c.peer;
    let lastSeen = performance.now();
    let connectedAt = lastSeen;
    let heartbeatTimer = null;
    conns.set(pid, c);
    const ready = () => {
      connectedAt = lastSeen = performance.now();
      handlers.onPeer?.(pid);
    };
    c.on("open", ready);
    const accept = messageGate(true);
    c.on("data", (data) => {
      lastSeen = performance.now();
      if (data?.t === HEARTBEAT_PONG) return;
      if (accept(data)) handlers.onData?.(data, pid);
    });
    heartbeatTimer = setInterval(() => {
      if (!c.open) return;
      const now = performance.now();
      if (now - connectedAt > HEARTBEAT_START_GRACE_MS && now - lastSeen > HEARTBEAT_TIMEOUT_MS) {
        c.close();
        return;
      }
      try {
        c.send({ t: HEARTBEAT_PING });
      } catch {
        c.close();
      }
    }, HEARTBEAT_INTERVAL_MS);
    c.on("close", () => {
      if (heartbeatTimer != null) clearInterval(heartbeatTimer);
      conns.delete(pid);
      handlers.onLeft?.(pid);
    });
    c.on("error", (err) => handlers.onError?.(err));
    if (c.open) ready();
  }

  const api = {
    id,
    host: true,
    myPeerId: id,
    send(data) {
      each((c) => c.send(data));
    },
    sendTo(peerId, data) {
      const c = conns.get(peerId);
      if (c?.open) c.send(data);
    },
    sendExcept(peerId, data) {
      each((c) => c.send(data), peerId);
    },
    disconnect(peerId) {
      const c = conns.get(peerId);
      if (!c) return false;
      c.close();
      return true;
    },
    call(peerId, stream) {
      if (!peerId || !stream) return null;
      try {
        return peer.call(peerId, stream);
      } catch {
        return null;
      }
    },
    destroy() {
      for (const c of conns.values()) c.close();
      conns.clear();
      peer.destroy();
    },
  };

  peer.on("open", () => {
    rememberHost(id);
    handlers.onOpen?.(id);
  });
  peer.on("error", (err) => handlers.onError?.(err));
  peer.on("connection", attach);
  peer.on("call", (call) => handlers.onCall?.(call));

  return api;
}

export function joinRoom(hostId, handlers) {
  const myId = guestId();
  const peer = makePeer(myId);
  let conn = null;
  let tries = 0;
  let opened = false;
  let destroyed = false;
  let retryTimer = null;
  let attemptTimer = null;
  let failureReported = false;
  const maxTries = 8;

  function clearJoinTimers() {
    if (retryTimer != null) clearTimeout(retryTimer);
    if (attemptTimer != null) clearTimeout(attemptTimer);
    retryTimer = null;
    attemptTimer = null;
  }

  function failOrRetry(err = { type: "peer-unavailable" }) {
    if (destroyed || opened) return;
    if (attemptTimer != null) clearTimeout(attemptTimer);
    attemptTimer = null;
    if (tries < maxTries) {
      if (retryTimer == null) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          tryConnect();
        }, 800);
      }
      return;
    }
    if (!failureReported) {
      failureReported = true;
      handlers.onError?.(err);
    }
  }

  function wire(c) {
    conn = c;
    c.on("open", () => {
      if (opened || destroyed) return;
      opened = true;
      clearJoinTimers();
      handlers.onOpen?.(hostId, myId);
      handlers.onPeer?.();
    });
    const accept = messageGate(false);
    c.on("data", (data) => {
      if (data?.t === HEARTBEAT_PING) {
        try {
          if (c.open) c.send({ t: HEARTBEAT_PONG });
        } catch {
          c.close();
        }
        return;
      }
      if (accept(data)) handlers.onData?.(data);
    });
    c.on("close", () => {
      if (!destroyed && opened) handlers.onLeft?.();
    });
    c.on("error", (err) => {
      if (opened) handlers.onError?.(err);
      else failOrRetry(err);
    });
    if (c.open && !opened) {
      opened = true;
      clearJoinTimers();
      handlers.onOpen?.(hostId, myId);
      handlers.onPeer?.();
    }
  }

  function tryConnect() {
    if (destroyed || opened) return;
    if (attemptTimer != null) clearTimeout(attemptTimer);
    attemptTimer = null;
    tries += 1;
    handlers.onStatus?.(`Joining room… (${tries}/${maxTries})`);
    try {
      if (conn) {
        conn.close();
        conn = null;
      }
    } catch {
      /* ignore */
    }
    wire(peer.connect(hostId, CONNECT_OPTS));
    attemptTimer = setTimeout(() => failOrRetry(), 3500);
  }

  const api = {
    id: hostId,
    host: false,
    myPeerId: myId,
    send(data) {
      if (conn?.open) conn.send(data);
    },
    sendTo() {},
    sendExcept() {},
    disconnect() { return false; },
    call(peerId, stream) {
      if (!peerId || !stream) return null;
      try {
        return peer.call(peerId, stream);
      } catch {
        return null;
      }
    },
    destroy() {
      destroyed = true;
      clearJoinTimers();
      try {
        conn?.close();
      } catch {
        /* ignore */
      }
      peer.destroy();
    },
  };

  peer.on("error", (err) => {
    if (destroyed) return;
    if (err?.type === "peer-unavailable") {
      failOrRetry(err);
      return;
    }
    handlers.onError?.(err);
  });
  peer.on("open", () => tryConnect());
  peer.on("call", (call) => handlers.onCall?.(call));

  return api;
}

function messageGate(fromGuest) {
  let since = performance.now(), count = 0;
  return data => {
    const now = performance.now();
    if (now - since >= 1000) { since = now; count = 0; }
    return ++count <= (fromGuest ? 100 : 1600) && validMessage(data, fromGuest);
  };
}

export const PUBLIC_GAME_URL = "https://headlost.github.io/flight-over-the-world-plus/";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

export function roomInvitationLink(currentHref, roomId) {
  const current = new URL(currentHref);
  const base = current.protocol === "file:" || LOOPBACK_HOSTS.has(current.hostname)
    ? new URL(PUBLIC_GAME_URL)
    : current;
  base.search = "";
  base.hash = `r=${encodeURIComponent(String(roomId || ""))}`;
  return base.toString();
}

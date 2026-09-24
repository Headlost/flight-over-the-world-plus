const TYPES = new Set(['hello','bye','welcome','roster','scope','mode','city','plane','name','chat','ready','talk','presence','moderate','muted','removed','resume','bump','snapped','go','rematch','start','pose','guess','done','roundEnd']);
const GUEST_TYPES = new Set(['hello','bye','plane','name','chat','ready','talk','presence','moderate','bump','snapped','rematch','pose','guess','done']);
// The Free Flight controller and model are retained locally but archived from play.
const PLANES = new Set(['mooney','boeing737','a380','ac130','b2','jet','rocket','parachutist','dzikiDzik']);
const PLAYER_ROLES = new Set(['admin','leader','player']);
const finite = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const location = d => finite(d.lat,-90,90) && finite(d.lon,-180,180);
const spaceVector = d => finite(d.x,-1e7,1e7) && finite(d.y,-1e7,1e7) && finite(d.z,-1e7,1e7)
  && finite(d.fx,-1,1) && finite(d.fy,-1,1) && finite(d.fz,-1,1);
const rotation = d => finite(d.qx,-1,1) && finite(d.qy,-1,1) && finite(d.qz,-1,1) && finite(d.qw,-1,1);
const ROTATION_FIELDS = ['qx','qy','qz','qw'];
const aerobaticRotation = d => {
  // Legacy peers may omit the entire attitude; a partially received or invalid
  // quaternion must not reach slerp or discard the aircraft's inverted attitude.
  if (!ROTATION_FIELDS.some(key => Object.hasOwn(d,key))) return true;
  return rotation(d) && Math.abs(d.qx*d.qx + d.qy*d.qy + d.qz*d.qz + d.qw*d.qw - 1) <= 1e-3;
};
export const PLAYER_NAME_MAX = 24;
export const CHAT_MESSAGE_MAX = 280;
export const MULTIPLAYER_PROTOCOL_VERSION = 2;

export function supportsMultiplayerRoundConfig(version) {
  // Older clients omit this optional capability marker; that is not a reason to reject a room join.
  return Number.isSafeInteger(version) && version >= MULTIPLAYER_PROTOCOL_VERSION;
}
export const PLAYER_PRESENCE_LABELS = Object.freeze({
  active: '',
  paused: 'Paused',
  afk: 'AFK',
  'street-view': 'Street View active',
});
const PLAYER_PRESENCES = new Set(Object.keys(PLAYER_PRESENCE_LABELS));

export function playerPresence({ paused = false, away = false, streetView = false } = {}) {
  if (streetView) return 'street-view';
  if (away) return 'afk';
  return paused ? 'paused' : 'active';
}

export function normalizePlayerName(value, fallback = 'Pilot') {
  const clean = input => String(input ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLAYER_NAME_MAX);
  return clean(value) || clean(fallback) || 'Pilot';
}

export function normalizeChatMessage(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MESSAGE_MAX);
}

export function canModeratePlayer(actorRole, targetRole, isSelf = false) {
  if (isSelf) return false;
  if (actorRole === 'admin') return true;
  return actorRole === 'leader' && targetRole !== 'admin';
}

export function hasRankStartQuorum(players = []) {
  const required = players.filter(player => player?.role === 'admin' || player?.role === 'leader');
  return required.some(player => player.role === 'admin') && required.every(player => player.ready === true);
}

export function canEditLobbyProfile(player = {}) {
  return !player.ready && !player.inRound;
}

export function canChooseLobbyVehicle(player = {}, lockedPlane = '', isAdmin = false) {
  return canEditLobbyProfile(player) && (!lockedPlane || isAdmin);
}

export function validMessage(data, fromGuest = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !TYPES.has(data.t)) return false;
  if (fromGuest && !GUEST_TYPES.has(data.t)) return false;
  let size = 0;
  function safe(value, depth = 0) {
    if (++size > (fromGuest ? 500 : 100000) || depth > 5) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.length <= 500;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value !== 'object') return false;
    return Object.entries(value).every(([key,v]) => !['__proto__','constructor','prototype'].includes(key) && key.length <= 100 && safe(v,depth+1));
  }
  if (!safe(data)) return false;
  if (data.plane != null && !PLANES.has(data.plane)) return false;
  if (data.protocolVersion != null && (!Number.isSafeInteger(data.protocolVersion) || !finite(data.protocolVersion,1,1000))) return false;
  if (data.roundId != null && (typeof data.roundId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(data.roundId))) return false;
  if (data.vehicles != null && (fromGuest || typeof data.vehicles !== 'object' || Array.isArray(data.vehicles) || !Object.values(data.vehicles).every(plane => PLANES.has(plane)))) return false;
  if (data.spawnSpacing != null && (fromGuest || !finite(data.spawnSpacing,12,40))) return false;
  if (data.lockedPlane != null && (fromGuest || (data.lockedPlane !== '' && !PLANES.has(data.lockedPlane)))) return false;
  if (data.t === 'ready' && typeof data.ready !== 'boolean') return false;
  if ((data.t === 'presence' || data.presence != null) && !PLAYER_PRESENCES.has(data.presence)) return false;
  if (data.mode != null && !['free','home','guess'].includes(data.mode)) return false;
  if (data.scope != null && !['pl','eu','world'].includes(data.scope)) return false;
  if (data.name != null && (typeof data.name !== 'string' || data.name.length > PLAYER_NAME_MAX)) return false;
  if (data.text != null && (typeof data.text !== 'string' || data.text.length > CHAT_MESSAGE_MAX)) return false;
  if (data.reason != null && (typeof data.reason !== 'string' || data.reason.length > 360)) return false;
  if (data.joining != null && typeof data.joining !== 'boolean') return false;
  if (data.role != null && (!PLAYER_ROLES.has(data.role) || fromGuest)) return false;
  if (data.city != null && (typeof data.city !== 'string' || data.city.length > 240)) return false;
  if (['guess','start'].includes(data.t) && !location(data)) return false;
  if (data.t === 'start' && data.mode === 'home' && !location({lat:data.homeLat,lon:data.homeLon})) return false;
  if (['snapped','go'].includes(data.t)) {
    if (!finite(data.h,-12000,1e7) || !finite(data.heading,-1e5,1e5)) return false;
    if (!finite(data.gh,-12000,1e7)) return false;
  }
  if (data.t === 'pose') {
    if (!finite(data.seq,0,Number.MAX_SAFE_INTEGER) || !finite(data.at,0,Number.MAX_SAFE_INTEGER)) return false;
    if (data.space === true) {
      if (data.plane !== 'rocket' || !spaceVector(data) || !rotation(data)) return false;
    } else if (!location(data) || !finite(data.h,-12000,1e7) || !finite(data.heading,-1e5,1e5) || !finite(data.pitch,-Math.PI,Math.PI) || !finite(data.roll,-Math.PI,Math.PI)) return false;
    if (data.space !== true && data.plane === 'dzikiDzik' && !aerobaticRotation(data)) return false;
  }
  if (data.t === 'resume') {
    if (!data.pose || typeof data.pose !== 'object' || typeof data.pose.space !== 'boolean') return false;
    if (data.pose.space) {
      if (data.plane !== 'rocket' || !spaceVector(data.pose) || !rotation(data.pose) || !finite(data.pose.motion,0,5000)) return false;
    } else if (!location(data.pose) || !finite(data.pose.h,-12000,1e7) || !finite(data.pose.heading,-1e5,1e5) || !finite(data.pose.pitch,-Math.PI,Math.PI) || !finite(data.pose.roll,-Math.PI,Math.PI)) return false;
    if (!data.pose.space && data.plane === 'dzikiDzik' && !aerobaticRotation(data.pose)) return false;
  }
  if (data.t === 'bump' && (typeof data.target !== 'string' || data.target.length < 3 || data.target.length > 80 || !finite(data.ix,-8,8) || !finite(data.iy,-8,8) || !finite(data.iz,-8,8))) return false;
  if (data.t === 'moderate' && (!['mute','kick','approve'].includes(data.action) || typeof data.target !== 'string' || data.target.length < 3 || data.target.length > 80 || (data.action === 'mute' && typeof data.muted !== 'boolean') || (data.action === 'approve' && typeof data.approved !== 'boolean'))) return false;
  if (data.t === 'muted' && typeof data.muted !== 'boolean') return false;
  if (data.state != null && !['airborne','grounded','launching'].includes(data.state)) return false;
  if (data.motion != null && !finite(data.motion,0,data.space === true ? 5000 : 1000)) return false;
  if (data.resumeKey != null && (data.t !== 'hello' || typeof data.resumeKey !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(data.resumeKey))) return false;
  for (const key of ['roster','players']) if (data[key] != null && (!Array.isArray(data[key]) || !data[key].every(p => p && typeof p.id === 'string' && typeof p.name === 'string' && p.name.length <= PLAYER_NAME_MAX && PLANES.has(p.plane) && (p.role == null || PLAYER_ROLES.has(p.role)) && (p.presence == null || PLAYER_PRESENCES.has(p.presence)) && (p.muted == null || typeof p.muted === 'boolean') && (p.approved == null || typeof p.approved === 'boolean') && (p.score == null || finite(p.score,0,1e9))))) return false;
  if (data.seats != null && (typeof data.seats !== 'object' || Array.isArray(data.seats) || !Object.values(data.seats).every(n => Number.isSafeInteger(n) && n >= 0))) return false;
  return true;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

const BACKGROUND_GAIN = 0.22;
const BLACK_HOLE_GAIN = 0.48;
const BLACK_HOLE_ENTRY_MIX = 0.25;
const BLACK_HOLE_CUE_SECONDS = 45;
const MUSIC_MUTED_KEY = "fotw-music-muted";

const background = document.getElementById("bgm");
const blackHoleScore = document.getElementById("black-hole-score");
let lastRetry = 0;
let blackHoleProximity = 0;
let blackHoleTransit = false;
let blackHoleTransitProgress = 0;
let resetScoreWhenSilent = false;
let musicMuted = false;

try { musicMuted = localStorage.getItem(MUSIC_MUTED_KEY) === "1"; } catch { /* optional */ }

if (background) {
  background.loop = true;
  background.volume = BACKGROUND_GAIN;
  background.muted = musicMuted;
  window.__bgm = background;
  if (!musicMuted) background.play().catch(() => {});
}

if (blackHoleScore) {
  blackHoleScore.loop = false;
  blackHoleScore.volume = 0;
  blackHoleScore.muted = musicMuted;
  window.__blackHoleScore = blackHoleScore;
}

function approach(value, target, response = 4.2) {
  return value + (target - value) * Math.min(1, response / 60);
}

function playBlackHoleScore() {
  if (!blackHoleScore || document.hidden || musicMuted) return;
  blackHoleScore.play().catch(() => {});
}

function cueBlackHoleScore() {
  if (!blackHoleScore) return;
  const seekAndPlay = () => {
    if (!blackHoleTransit && blackHoleProximity <= 0.015) return;
    if (Number.isFinite(blackHoleScore.duration) && blackHoleScore.duration > 1) {
      blackHoleScore.currentTime = Math.min(BLACK_HOLE_CUE_SECONDS, blackHoleScore.duration - 1);
    }
    playBlackHoleScore();
  };
  if (blackHoleScore.readyState >= 1) seekAndPlay();
  else blackHoleScore.addEventListener("loadedmetadata", seekAndPlay, { once: true });
}

export function setBlackHoleProximity(value) {
  const wasActive = blackHoleTransit || blackHoleProximity > 0.015;
  blackHoleProximity = Math.max(0, Math.min(1, Number(value) || 0));
  if (blackHoleProximity > 0.015) {
    resetScoreWhenSilent = false;
    if (!wasActive) cueBlackHoleScore();
    else playBlackHoleScore();
  } else if (!blackHoleTransit) {
    resetScoreWhenSilent = true;
  }
}

export function startBlackHoleFinale(totalSeconds = 32) {
  if (!blackHoleScore) return;
  blackHoleTransit = true;
  blackHoleTransitProgress = 0;
  blackHoleProximity = 1;
  resetScoreWhenSilent = false;
  const cueFinale = () => {
    if (!Number.isFinite(blackHoleScore.duration) || blackHoleScore.duration <= 1) return;
    const cue = Math.max(0, blackHoleScore.duration - Math.max(1, totalSeconds) - 0.25);
    blackHoleScore.currentTime = cue;
    // The timestamp changes under the four-second blackout. Pull the gain down
    // briefly so the climactic section can swell back in with the countdown.
    blackHoleScore.volume = Math.min(blackHoleScore.volume, 0.16);
    playBlackHoleScore();
  };
  if (blackHoleScore.readyState >= 1) cueFinale();
  else blackHoleScore.addEventListener("loadedmetadata", cueFinale, { once: true });
  playBlackHoleScore();
}

export function setBlackHoleTransitProgress(value) {
  blackHoleTransitProgress = Math.max(0, Math.min(1, Number(value) || 0));
}

export function stopBlackHoleScore() {
  blackHoleTransit = false;
  blackHoleTransitProgress = 0;
  blackHoleProximity = 0;
  resetScoreWhenSilent = true;
}

export function updateMusic() {
  if (musicMuted) return;
  const blackHoleActive = blackHoleTransit || blackHoleProximity > 0.015;
  const proximityMix = blackHoleProximity > 0
    ? BLACK_HOLE_ENTRY_MIX + (1 - BLACK_HOLE_ENTRY_MIX) * Math.pow(blackHoleProximity, 0.68)
    : 0;
  const scoreTarget = BLACK_HOLE_GAIN * (blackHoleTransit
    ? 1 + blackHoleTransitProgress * 0.28
    : proximityMix);
  if (blackHoleScore) {
    blackHoleScore.volume = approach(blackHoleScore.volume, scoreTarget, scoreTarget > blackHoleScore.volume ? 8.5 : 2.2);
    if (scoreTarget > 0.008 && blackHoleScore.paused) playBlackHoleScore();
    if (resetScoreWhenSilent && blackHoleScore.volume < 0.006) {
      blackHoleScore.pause();
      blackHoleScore.currentTime = 0;
      blackHoleScore.volume = 0;
      resetScoreWhenSilent = false;
    }
  }

  if (!background) return;
  const backgroundTarget = blackHoleActive ? 0 : BACKGROUND_GAIN;
  background.volume = approach(background.volume, backgroundTarget, blackHoleActive ? 7.8 : 3.4);
  if (!background.paused || document.hidden) return;
  const now = performance.now();
  if (now - lastRetry < 3000) return;
  lastRetry = now;
  background.play().catch(() => {});
}

export function primeMusic() {
  if (musicMuted) return;
  background?.play().catch(() => {});
  if (blackHoleProximity > 0.015 || blackHoleTransit) playBlackHoleScore();
}

export function setMusicMuted(value) {
  musicMuted = !!value;
  if (background) background.muted = musicMuted;
  if (blackHoleScore) blackHoleScore.muted = musicMuted;
  if (musicMuted) {
    background?.pause();
    blackHoleScore?.pause();
  }
  try { localStorage.setItem(MUSIC_MUTED_KEY, musicMuted ? "1" : "0"); } catch { /* optional */ }
  if (!musicMuted) primeMusic();
  return musicMuted;
}

export function toggleMusic() {
  return setMusicMuted(!musicMuted);
}

export function isMusicMuted() {
  return musicMuted;
}

export function musicDebug() {
  return {
    muted: musicMuted,
    paused: background?.paused ?? null,
    time: background ? Math.round(background.currentTime * 10) / 10 : null,
    gain: background?.volume ?? null,
    blackHole: blackHoleScore ? {
      paused: blackHoleScore.paused,
      time: Math.round(blackHoleScore.currentTime * 10) / 10,
      gain: Math.round(blackHoleScore.volume * 1000) / 1000,
      proximity: Math.round(blackHoleProximity * 1000) / 1000,
      crossfadeActive: blackHoleTransit || blackHoleProximity > 0.015,
      transit: blackHoleTransit,
      transitProgress: Math.round(blackHoleTransitProgress * 1000) / 1000,
    } : null,
  };
}

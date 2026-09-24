import { getAudioCtx } from "./explosion.js";
import { loadAmbientVolume, saveAmbientVolume } from "./ambientVolume.js";
import { asset } from "./asset.js";

// Proceduralne dźwięki napędu + opływ powietrza (WebAudio).
// Zapętlone bezszwowo, wysokość i głośność podążają za obrotami i prędkością.
// Style: "plane" (tłokowy bulgot), "jet" (świst turbiny), "rocket" (niski ryk),
// "wind" (tylko powietrze).

let built = false;
let master, lp, exhaustGain, subGain, noiseGain, bp, am, amDepth;
let osc1, osc2, sub;
let ambientVolume = loadAmbientVolume();
let lastAudible = false;
let masterTarget = null;
const SAMPLE_BY_VEHICLE = {
  boeing737: 'airliner', a380: 'airliner', b2: 'b2',
};
const SAMPLE_FILES = {
  airliner: 'sounds/airliner-cruise.ogg',
  b2: 'sounds/b2-cruise.ogg',
};
const SAMPLE_TONE = {
  // Keep the recorded engine body while softening the narrow, high whine.
  airliner: { type: 'lowpass', frequency: 3600, Q: 0.65 },
  b2: { type: 'peaking', frequency: 2400, Q: 0.9, gain: -7 },
};
const sampleBuffers = new Map();
let selectedSample = null;
let activeSample = null;
let sampleError = null;

function selectEngineSample(ctx, vehicle) {
  const next = SAMPLE_BY_VEHICLE[vehicle] || null;
  if (next === selectedSample) return;
  selectedSample = next;
  sampleError = null;
  if (activeSample) {
    const { source, gain } = activeSample;
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    source.stop(ctx.currentTime + 0.45);
    activeSample = null;
  }
  if (!next) return;
  if (!sampleBuffers.has(next)) {
    sampleBuffers.set(next, fetch(asset(SAMPLE_FILES[next]))
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(bytes => ctx.decodeAudioData(bytes)));
  }
  const load = sampleBuffers.get(next);
  load.then(buffer => {
    if (selectedSample !== next || activeSample) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setTargetAtTime(1.2, ctx.currentTime, 0.14);
    const tone = ctx.createBiquadFilter();
    tone.type = SAMPLE_TONE[next].type;
    tone.frequency.value = SAMPLE_TONE[next].frequency;
    tone.Q.value = SAMPLE_TONE[next].Q;
    if (SAMPLE_TONE[next].gain != null) tone.gain.value = SAMPLE_TONE[next].gain;
    source.connect(tone).connect(gain).connect(master);
    source.start();
    source.onended = () => { source.disconnect(); tone.disconnect(); gain.disconnect(); };
    activeSample = { key: next, source, tone, gain };
  }).catch(error => {
    // The existing synthesised jet remains audible when a sample is missing.
    if (sampleBuffers.get(next) === load) sampleBuffers.delete(next);
    if (selectedSample === next) sampleError = error.message;
  });
}

function applyMasterGain(ctx, audible, response) {
  const target = audible ? 0.14 * ambientVolume : 0;
  if (target === masterTarget) return;
  master.gain.setTargetAtTime(target, ctx.currentTime, response);
  masterTarget = target;
}

export function getAmbientVolume() {
  return ambientVolume;
}

export function setAmbientVolume(value) {
  ambientVolume = saveAmbientVolume(value);
  // Changing a slider must not create/resume an AudioContext. If the graph
  // already exists, its engine and wind master follows the new level smoothly.
  const ctx = getAudioCtx();
  if (ctx && built) applyMasterGain(ctx, lastAudible, 0.06);
  return ambientVolume;
}

function build(ctx) {
  built = true;

  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // wydech: dwie lekko rozstrojone piły przez lowpass
  lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 400;
  lp.Q.value = 1.1;
  exhaustGain = ctx.createGain();
  exhaustGain.gain.value = 0.6;
  lp.connect(exhaustGain).connect(master);

  osc1 = ctx.createOscillator();
  osc1.type = "sawtooth";
  osc1.frequency.value = 70;
  osc2 = ctx.createOscillator();
  osc2.type = "sawtooth";
  osc2.frequency.value = 71;
  const og1 = ctx.createGain();
  og1.gain.value = 0.5;
  const og2 = ctx.createGain();
  og2.gain.value = 0.35;
  osc1.connect(og1).connect(lp);
  osc2.connect(og2).connect(lp);
  osc1.start();
  osc2.start();

  // pulsacja wydechu — AM w rytmie zapłonów (tylko silnik tłokowy)
  am = ctx.createOscillator();
  am.type = "sine";
  am.frequency.value = 140;
  amDepth = ctx.createGain();
  amDepth.gain.value = 0.16;
  am.connect(amDepth).connect(exhaustGain.gain);
  am.start();

  // sub-basowy pomruk
  sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 35;
  subGain = ctx.createGain();
  subGain.gain.value = 0.4;
  sub.connect(subGain).connect(master);
  sub.start();

  // opływ powietrza — zapętlony szum przez bandpass
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = buf;
  noiseSrc.loop = true;
  bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 500;
  bp.Q.value = 0.6;
  noiseGain = ctx.createGain();
  noiseGain.gain.value = 0;
  noiseSrc.connect(bp).connect(noiseGain).connect(master);
  noiseSrc.start();
}

// parametry brzmienia per styl:
// fBase/fRange — częstotliwość podstawowa, lpBase/lpRange — filtr (nitro otwiera),
// exG/subG — głośności silnika (0 = bez silnika), noiseMul — siła opływu
const STYLES = {
  plane:  { fBase: 46,  fRange: 64,   subDiv: 2, am: 0.16, lpBase: 240,  lpRange: 640,  exG: 0.5,  exR: 0.5,  subG: 0.32, subR: 0.3,  noiseMul: 1 },
  jet:    { fBase: 120, fRange: 210, subDiv: 2, am: 0,    lpBase: 900,  lpRange: 1100, exG: 0.06, exR: 0.09, subG: 0.12, subR: 0.12, noiseMul: 2.3 },
  rocket: { fBase: 26,  fRange: 40,   subDiv: 1, am: 0,    lpBase: 130,  lpRange: 380,  exG: 0.85, exR: 0.55, subG: 0.5,  subR: 0.35, noiseMul: 3.1 },
  wind:   { fBase: 46,  fRange: 64,   subDiv: 2, am: 0,    lpBase: 240,  lpRange: 640,  exG: 0,    exR: 0,    subG: 0,    subR: 0,    noiseMul: 1.5 },
};

// audible — czy słychać (lot, nie menu/pauza/kraksa)
// rpm01 — obroty 0..1 (Shift = nitro podbija), speed01 — prędkość 0..1
export function updateEngineSound(audible, rpm01, speed01, style = "plane", vehicle = null) {
  lastAudible = !!audible;
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (!built) build(ctx);
  const t = ctx.currentTime;

  applyMasterGain(ctx, lastAudible, audible ? 0.3 : 0.06);
  selectEngineSample(ctx, vehicle);
  if (!audible) return;

  const S = STYLES[style] || STYLES.plane;
  const rpm = Math.max(0.12, Math.min(1, rpm01));
  // Sawtooth oscillators above 1 kHz produced a prominent, beating cricket
  // tone over the recorded jets. A softer low-frequency turbine bed leaves
  // the recordings and broad-band wind to carry the upper engine detail.
  const waveform = style === 'jet' ? 'triangle' : 'sawtooth';
  if (osc1.type !== waveform) osc1.type = waveform;
  if (osc2.type !== waveform) osc2.type = waveform;
  lp.Q.setTargetAtTime(style === 'jet' ? 0.7 : 1.1, t, 0.1);
  if (activeSample) activeSample.gain.gain.setTargetAtTime(
    0.75 + rpm * 0.7, t, 0.2);
  const freq = S.fBase + rpm * S.fRange;
  osc1.frequency.setTargetAtTime(freq, t, 0.1);
  osc2.frequency.setTargetAtTime(freq * 1.006 + 0.6, t, 0.1);
  sub.frequency.setTargetAtTime(freq / S.subDiv, t, 0.1);
  am.frequency.setTargetAtTime(freq * 2, t, 0.1);
  amDepth.gain.setTargetAtTime(S.am, t, 0.1);
  lp.frequency.setTargetAtTime(S.lpBase + rpm * S.lpRange, t, 0.15); // nitro otwiera filtr — ryk
  exhaustGain.gain.setTargetAtTime(S.exG + rpm * S.exR, t, 0.1);
  subGain.gain.setTargetAtTime(S.subG + rpm * S.subR, t, 0.1);

  const wash = Math.max(0, Math.min(1, speed01));
  noiseGain.gain.setTargetAtTime(wash * wash * 0.5 * S.noiseMul, t, 0.25);
  bp.frequency.setTargetAtTime(380 + wash * 720, t, 0.25);
}

export function engineDebug() {
  const ctx = getAudioCtx();
  return {
    ctxState: ctx ? ctx.state : null,
    built,
    ambientVolume,
    masterTarget,
    masterGain: master ? Math.round(master.gain.value * 1000) / 1000 : null,
    selectedSample,
    activeSample: activeSample?.key || null,
    sampleError,
  };
}

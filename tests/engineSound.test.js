import test from 'node:test';
import assert from 'node:assert/strict';
import { primeAudio } from '../src/game/explosion.js';
import { updateEngineSound } from '../src/game/engineSound.js';

class AudioParamStub {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
}

class AudioNodeStub {
  connect(next) { return next; }
  disconnect() {}
  start() {}
}

class AudioContextStub {
  constructor() {
    AudioContextStub.last = this;
    this.currentTime = 0;
    this.sampleRate = 32;
    this.state = 'running';
    this.destination = new AudioNodeStub();
    this.filters = [];
    this.oscillators = [];
  }
  createGain() {
    const node = new AudioNodeStub();
    node.gain = new AudioParamStub();
    return node;
  }
  createBiquadFilter() {
    const node = new AudioNodeStub();
    node.frequency = new AudioParamStub();
    node.Q = new AudioParamStub();
    node.gain = new AudioParamStub();
    this.filters.push(node);
    return node;
  }
  createOscillator() {
    const node = new AudioNodeStub();
    node.frequency = new AudioParamStub();
    this.oscillators.push(node);
    return node;
  }
  createBuffer(_channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }
  createBufferSource() { return new AudioNodeStub(); }
}

test('recorded jets use a softer low-frequency bed without changing piston or rocket tones', () => {
  const oldWindow = globalThis.window;
  globalThis.window = { AudioContext: AudioContextStub };
  try {
    primeAudio();
    // primeAudio owns the context, so obtain its created graph through a
    // constructor hook instead of relying on a browser AudioContext.
    updateEngineSound(true, 1, 1, 'jet');
    const realCtx = globalThis.window.AudioContext.last;
    assert.ok(realCtx);
    assert.equal(realCtx.oscillators[0].type, 'triangle');
    assert.equal(realCtx.oscillators[1].type, 'triangle');
    assert.equal(realCtx.oscillators[0].frequency.value, 330);
    assert.equal(realCtx.filters[0].frequency.value, 2000);
    assert.equal(realCtx.filters[0].Q.value, 0.7);

    updateEngineSound(true, 1, 1, 'plane');
    assert.equal(realCtx.oscillators[0].type, 'sawtooth');
    assert.equal(realCtx.oscillators[0].frequency.value, 110);
    assert.equal(realCtx.filters[0].Q.value, 1.1);

    updateEngineSound(true, 1, 1, 'rocket');
    assert.equal(realCtx.oscillators[0].type, 'sawtooth');
    assert.equal(realCtx.oscillators[0].frequency.value, 66);
    assert.equal(realCtx.filters[0].frequency.value, 510);
    assert.equal(realCtx.filters[0].Q.value, 1.1);
  } finally {
    globalThis.window = oldWindow;
  }
});

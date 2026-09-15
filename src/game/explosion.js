import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  NormalBlending,
  PointLight,
  Points,
  PointsMaterial,
} from "three";

// Proceduralny wybuch: kula ognia (addytiwne cząsteczki) + dym + błysk światła.
// Dźwięk generowany przez WebAudio — szerokopasmowy huk, ciśnieniowy pomruk
// i odłamki. Bez tonalnego oscylatora, który brzmiał jak uderzenie w bęben.

export function createExplosion(scene, pos) {
  const group = [];

  // --- ogień ---
  const FIRE_N = 240;
  const fireGeo = new BufferGeometry();
  const firePos = new Float32Array(FIRE_N * 3);
  const fireCol = new Float32Array(FIRE_N * 3);
  const fireVel = new Float32Array(FIRE_N * 3);
  for (let i = 0; i < FIRE_N; i++) {
    firePos[i * 3] = pos.x;
    firePos[i * 3 + 1] = pos.y;
    firePos[i * 3 + 2] = pos.z;
    // losowy kierunek sferyczny z lekkim biasem w górę
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    const sp = 12 + Math.random() * 42;
    fireVel[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
    fireVel[i * 3 + 1] = Math.abs(Math.cos(ph)) * sp * 0.9 + 6;
    fireVel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
    // żółty rdzeń → pomarańcz → czerwień
    const t = Math.random();
    fireCol[i * 3] = 1.0;
    fireCol[i * 3 + 1] = 0.75 - t * 0.55;
    fireCol[i * 3 + 2] = 0.35 - t * 0.3;
  }
  fireGeo.setAttribute("position", new Float32BufferAttribute(firePos, 3));
  fireGeo.setAttribute("color", new Float32BufferAttribute(fireCol, 3));
  const fireMat = new PointsMaterial({
    size: 4.2,
    vertexColors: true,
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 1,
  });
  const fire = new Points(fireGeo, fireMat);
  fire.frustumCulled = false;
  scene.add(fire);
  group.push(fire);

  // --- dym ---
  const SMOKE_N = 90;
  const smokeGeo = new BufferGeometry();
  const smokePos = new Float32Array(SMOKE_N * 3);
  const smokeVel = new Float32Array(SMOKE_N * 3);
  for (let i = 0; i < SMOKE_N; i++) {
    smokePos[i * 3] = pos.x;
    smokePos[i * 3 + 1] = pos.y;
    smokePos[i * 3 + 2] = pos.z;
    const th = Math.random() * Math.PI * 2;
    const sp = 3 + Math.random() * 12;
    smokeVel[i * 3] = Math.cos(th) * sp;
    smokeVel[i * 3 + 1] = 8 + Math.random() * 14;
    smokeVel[i * 3 + 2] = Math.sin(th) * sp;
  }
  smokeGeo.setAttribute("position", new Float32BufferAttribute(smokePos, 3));
  const smokeMat = new PointsMaterial({
    size: 9,
    color: 0x2a2624,
    blending: NormalBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.55,
  });
  const smoke = new Points(smokeGeo, smokeMat);
  smoke.frustumCulled = false;
  scene.add(smoke);
  group.push(smoke);

  // --- błysk ---
  const flash = new PointLight(0xffa040, 4000, 600, 1.6);
  flash.position.copy(pos);
  scene.add(flash);
  group.push(flash);

  let age = 0;
  const LIFE = 2.6;

  return {
    update(dt) {
      age += dt;
      const fp = fire.geometry.attributes.position.array;
      for (let i = 0; i < FIRE_N; i++) {
        fireVel[i * 3 + 1] -= 14 * dt; // grawitacja
        const drag = 1 - Math.min(0.9, 1.6 * dt);
        fireVel[i * 3] *= drag;
        fireVel[i * 3 + 1] *= drag;
        fireVel[i * 3 + 2] *= drag;
        fp[i * 3] += fireVel[i * 3] * dt;
        fp[i * 3 + 1] += fireVel[i * 3 + 1] * dt;
        fp[i * 3 + 2] += fireVel[i * 3 + 2] * dt;
      }
      fire.geometry.attributes.position.needsUpdate = true;
      fireMat.opacity = Math.max(0, 1 - age / 1.3);
      fireMat.size = 4.2 + age * 6;

      const sp = smoke.geometry.attributes.position.array;
      for (let i = 0; i < SMOKE_N * 3; i++) sp[i] += smokeVel[i] * dt;
      smoke.geometry.attributes.position.needsUpdate = true;
      smokeMat.opacity = Math.max(0, 0.55 * (1 - age / LIFE));
      smokeMat.size = 9 + age * 10;

      flash.intensity = Math.max(0, 4000 * (1 - age / 0.45));

      if (age >= LIFE) {
        for (const o of group) {
          scene.remove(o);
          o.geometry?.dispose();
          o.material?.dispose();
        }
        return false;
      }
      return true;
    },
  };
}

let audioCtx = null;

// wywołaj przy geście użytkownika (Start), żeby odblokować dźwięk
export function primeAudio() {
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}

export function getAudioCtx() {
  return audioCtx;
}

export function playExplosionSound() {
  primeAudio();
  const t = audioCtx.currentTime;
  const master = audioCtx.createDynamicsCompressor();
  master.threshold.setValueAtTime(-15, t);
  master.knee.setValueAtTime(10, t);
  master.ratio.setValueAtTime(5, t);
  master.attack.setValueAtTime(0.002, t);
  master.release.setValueAtTime(0.36, t);
  master.connect(audioCtx.destination);

  // Pierwsza fala uderzeniowa: jasny trzask przechodzący w szeroki huk.
  const blastDuration = 1.55;
  const blastBuffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * blastDuration), audioCtx.sampleRate);
  const blastData = blastBuffer.getChannelData(0);
  for (let i = 0; i < blastData.length; i++) {
    const age = i / blastData.length;
    const envelope = Math.pow(1 - age, 1.65);
    blastData[i] = (Math.random() * 2 - 1) * envelope;
  }
  const blast = audioCtx.createBufferSource();
  blast.buffer = blastBuffer;
  const blastHighpass = audioCtx.createBiquadFilter();
  blastHighpass.type = "highpass";
  blastHighpass.frequency.setValueAtTime(38, t);
  const blastLowpass = audioCtx.createBiquadFilter();
  blastLowpass.type = "lowpass";
  blastLowpass.frequency.setValueAtTime(6800, t);
  blastLowpass.frequency.exponentialRampToValueAtTime(170, t + blastDuration);
  const blastGain = audioCtx.createGain();
  blastGain.gain.setValueAtTime(0.95, t);
  blastGain.gain.exponentialRampToValueAtTime(0.001, t + blastDuration);
  blast.connect(blastHighpass).connect(blastLowpass).connect(blastGain).connect(master);
  blast.start(t);

  // Niskie ciśnienie i pogłos są również szumem, więc nie tworzą nuty bębna.
  const rumbleDuration = 2.25;
  const rumbleBuffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * rumbleDuration), audioCtx.sampleRate);
  const rumbleData = rumbleBuffer.getChannelData(0);
  let pressure = 0;
  for (let i = 0; i < rumbleData.length; i++) {
    pressure = pressure * 0.965 + (Math.random() * 2 - 1) * 0.035;
    rumbleData[i] = pressure * Math.pow(1 - i / rumbleData.length, 1.15) * 3.2;
  }
  const rumble = audioCtx.createBufferSource();
  rumble.buffer = rumbleBuffer;
  const rumbleFilter = audioCtx.createBiquadFilter();
  rumbleFilter.type = "lowpass";
  rumbleFilter.frequency.setValueAtTime(240, t);
  rumbleFilter.frequency.exponentialRampToValueAtTime(58, t + rumbleDuration);
  const rumbleGain = audioCtx.createGain();
  rumbleGain.gain.setValueAtTime(0.62, t + 0.015);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + rumbleDuration);
  rumble.connect(rumbleFilter).connect(rumbleGain).connect(master);
  rumble.start(t + 0.015);

  // Krótkie, nieregularne trzaski odłamków poszerzają wybuch bez tonalnego basu.
  for (let burst = 0; burst < 6; burst++) {
    const delay = 0.08 + burst * 0.055 + Math.random() * 0.045;
    const duration = 0.055 + Math.random() * 0.07;
    const debrisBuffer = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * duration), audioCtx.sampleRate);
    const debrisData = debrisBuffer.getChannelData(0);
    for (let i = 0; i < debrisData.length; i++) {
      debrisData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / debrisData.length, 3);
    }
    const debris = audioCtx.createBufferSource();
    debris.buffer = debrisBuffer;
    const debrisFilter = audioCtx.createBiquadFilter();
    debrisFilter.type = "bandpass";
    debrisFilter.frequency.value = 900 + Math.random() * 2800;
    debrisFilter.Q.value = 0.65;
    const debrisGain = audioCtx.createGain();
    debrisGain.gain.setValueAtTime(0.26, t + delay);
    debrisGain.gain.exponentialRampToValueAtTime(0.001, t + delay + duration);
    debris.connect(debrisFilter).connect(debrisGain).connect(master);
    debris.start(t + delay);
  }
}

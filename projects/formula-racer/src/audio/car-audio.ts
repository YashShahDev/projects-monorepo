import type { SoundMix } from "./sound-model.ts";

export interface CarAudio {
  /** Starts output; browsers only allow it from a user gesture such as a key press. */
  resume(): void;
  setEnabled(on: boolean): void;
  update(mix: SoundMix): void;

  /** The output's state as the browser reports it. */
  state(): AudioContextState;
  dispose(): void;
}

const MASTER_GAIN = 0.35;

// Short time constants smooth per-frame steps without audibly lagging the car.
const SMOOTH_S = 0.03;
const SUSPEND_AFTER_MS = 5 * SMOOTH_S * 1000;

/**
 * Engine: a sawtooth at the firing frequency plus its sub-octave, low-passed so it
 * reads as an exhaust note. Tyres: band-passed noise. Kerbs: low noise chopped by a
 * square wave at the stripe rate.
 */
export function createCarAudio(): CarAudio {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(context.destination);

  const engineGain = context.createGain();
  engineGain.gain.value = 0;
  const exhaust = context.createBiquadFilter();
  exhaust.type = "lowpass";
  exhaust.frequency.value = 1800;
  exhaust.connect(engineGain).connect(master);
  const engine = context.createOscillator();
  engine.type = "sawtooth";
  const sub = context.createOscillator();
  sub.type = "square";
  const subLevel = context.createGain();
  subLevel.gain.value = 0.3;
  engine.connect(exhaust);
  sub.connect(subLevel).connect(exhaust);

  // One second of seeded white noise, looped, feeds both tyres and kerbs.
  const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = noise.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < samples.length; i += 1) {
    // xorshift32; its state stays within 32-bit integers, unlike a multiplying LCG.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    samples[i] = Math.trunc(seed) / 2_147_483_648;
  }

  const hiss = context.createBufferSource();
  hiss.buffer = noise;
  hiss.loop = true;

  const tyreGain = context.createGain();
  tyreGain.gain.value = 0;
  const squeal = context.createBiquadFilter();
  squeal.type = "bandpass";
  squeal.frequency.value = 2400;
  squeal.Q.value = 6;
  hiss.connect(squeal).connect(tyreGain).connect(master);

  const kerbGain = context.createGain();
  kerbGain.gain.value = 0;
  const rumble = context.createBiquadFilter();
  rumble.type = "lowpass";
  rumble.frequency.value = 180;
  const chop = context.createGain();
  chop.gain.value = 0.5;
  const stripes = context.createOscillator();
  stripes.type = "square";
  const depth = context.createGain();
  depth.gain.value = 0.5;
  stripes.connect(depth).connect(chop.gain);
  hiss.connect(rumble).connect(chop).connect(kerbGain).connect(master);

  for (const source of [engine, sub, hiss, stripes]) {
    source.start();
  }

  let enabled = true;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;

  return {
    resume() {
      if (enabled && context.state === "suspended") {
        void context.resume();
      }
    },
    setEnabled(on) {
      enabled = on;
      clearTimeout(suspendTimer);
      master.gain.setTargetAtTime(on ? MASTER_GAIN : 0, context.currentTime, SMOOTH_S);

      // Suspend only once the fade has played out, or muting clicks.
      if (!on) {
        suspendTimer = setTimeout(() => {
          void context.suspend();
        }, SUSPEND_AFTER_MS);
      }
    },
    update(mix) {
      const t = context.currentTime;
      engine.frequency.setTargetAtTime(mix.engineHz, t, SMOOTH_S);
      sub.frequency.setTargetAtTime(mix.engineHz / 2, t, SMOOTH_S);
      engineGain.gain.setTargetAtTime(mix.engineGain, t, SMOOTH_S);
      tyreGain.gain.setTargetAtTime(mix.tyreGain * 0.4, t, SMOOTH_S);
      kerbGain.gain.setTargetAtTime(mix.kerbGain, t, SMOOTH_S);
      stripes.frequency.setTargetAtTime(Math.max(mix.kerbRateHz, 0.1), t, SMOOTH_S);
    },
    state: () => context.state,
    dispose() {
      clearTimeout(suspendTimer);
      void context.close();
    },
  };
}

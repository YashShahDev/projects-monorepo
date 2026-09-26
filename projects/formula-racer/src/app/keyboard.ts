// Only the fields used here, so DOM-free unit tests can dispatch plain Events.
interface KeyFields {
  code: string;
  repeat: boolean;
}

const EDITABLE = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// Typing into a form field (the dev tuning panel) must not steer the car.
const isEditable = (target: EventTarget | null): boolean => {
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  return (
    element?.isContentEditable === true ||
    (typeof element?.tagName === "string" && EDITABLE.has(element.tagName))
  );
};

const keyFields = (event: Event): KeyFields => {
  const { code, repeat } = event as Event & Partial<KeyFields>;
  return { code: code ?? "", repeat: repeat ?? false };
};

export interface HeldKeys {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  /** Held Shift: request full ERS deployment. */
  deploy: boolean;
}

const DRIVE_KEYS: Record<string, keyof HeldKeys> = {
  ArrowUp: "throttle",
  KeyW: "throttle",
  ArrowDown: "brake",
  KeyS: "brake",
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ShiftLeft: "deploy",
  ShiftRight: "deploy",
};

export type KeyAction = "reset" | "camera" | "pause" | "energyMode";

const ACTION_KEYS: Record<string, KeyAction> = {
  KeyR: "reset",
  KeyC: "camera",
  Escape: "pause",
  KeyE: "energyMode",
};

export interface Keyboard {
  held(): HeldKeys;
  onAction(listener: (action: KeyAction) => void): void;
  dispose(): void;
}

export function createKeyboard(
  window: EventTarget,
  document: EventTarget & { visibilityState: string },
): Keyboard {
  const down = new Set<string>();
  const listeners: ((action: KeyAction) => void)[] = [];
  const onKeyDown = (event: Event) => {
    if (isEditable(event.target)) return;
    const { code, repeat } = keyFields(event);
    const action = ACTION_KEYS[code];
    if (DRIVE_KEYS[code]) down.add(code);
    else if (!action) return;
    event.preventDefault();
    if (action && !repeat) for (const listener of listeners) listener(action);
  };
  const onKeyUp = (event: Event) => {
    down.delete(keyFields(event).code);
  };
  const release = () => down.clear();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") release();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", onVisibility);
  return {
    held() {
      const held: HeldKeys = {
        throttle: false,
        brake: false,
        left: false,
        right: false,
        deploy: false,
      };
      for (const code of down) {
        const control = DRIVE_KEYS[code];
        if (control) held[control] = true;
      }
      return held;
    },
    onAction(listener) {
      listeners.push(listener);
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

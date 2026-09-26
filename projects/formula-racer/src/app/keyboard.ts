// Only the fields used here, so DOM-free unit tests can dispatch plain Events.
interface KeyFields {
  code: string;
  repeat: boolean;
}

// Inputs that take typed text. A focused checkbox or button (the pause menu) must still
// let Escape and the driving keys through.
const TEXT_INPUTS = new Set(["text", "number", "search", "email", "password", "tel", "url"]);

// Typing into a text field (the dev tuning panel) must not steer the car.
const isEditable = (target: EventTarget | null): boolean => {
  if (target === null) {
    return false;
  }

  if ("isContentEditable" in target && target.isContentEditable === true) {
    return true;
  }

  const tagName = "tagName" in target ? target.tagName : undefined;
  if (tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  const type = "type" in target && typeof target.type === "string" ? target.type : "text";

  return tagName === "INPUT" && TEXT_INPUTS.has(type);
};

const keyFields = (event: Event): KeyFields => ({
  code: "code" in event && typeof event.code === "string" ? event.code : "",
  repeat: "repeat" in event && event.repeat === true,
});

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

export function createKeyboard(window: EventTarget, document: EventTarget & { visibilityState: string }): Keyboard {
  const down = new Set<string>();
  const listeners: ((action: KeyAction) => void)[] = [];
  const onKeyDown = (event: Event) => {
    if (isEditable(event.target)) {
      return;
    }

    const { code, repeat } = keyFields(event);
    const action = ACTION_KEYS[code];
    if (DRIVE_KEYS[code]) {
      down.add(code);
    } else if (!action) {
      return;
    }

    event.preventDefault();
    if (action && !repeat) {
      for (const listener of listeners) {
        listener(action);
      }
    }
  };

  const onKeyUp = (event: Event) => {
    down.delete(keyFields(event).code);
  };

  const release = () => {
    down.clear();
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      release();
    }
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
        if (control) {
          held[control] = true;
        }
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

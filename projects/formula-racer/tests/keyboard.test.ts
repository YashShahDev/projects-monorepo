import { describe, expect, test } from "bun:test";
import { CONTROLS_HELP, createKeyboard } from "../src/app/keyboard.ts";

function page() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const key = (type: "keydown" | "keyup", code: string, repeat = false, typed = "") => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat, key: typed });
    window.dispatchEvent(event);

    return event;
  };

  return { window, document, key };
}

describe("keyboard input", () => {
  test("arrow keys and WASD both drive", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    key("keydown", "ArrowUp");
    key("keydown", "KeyA");
    expect(keyboard.held()).toEqual({
      throttle: true,
      brake: false,
      left: true,
      right: false,
      deploy: false,
    });
    key("keyup", "ArrowUp");
    expect(keyboard.held().throttle).toBe(false);
  });

  test("losing focus releases every held key", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    key("keydown", "KeyW");
    key("keydown", "ArrowRight");
    window.dispatchEvent(new Event("blur"));
    expect(keyboard.held()).toEqual({
      throttle: false,
      brake: false,
      left: false,
      right: false,
      deploy: false,
    });
  });

  test("hiding the tab releases every held key", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    key("keydown", "KeyS");
    document.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(keyboard.held().brake).toBe(false);
  });

  test("R, C and Escape fire one action per press, ignoring auto-repeat", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    const actions: string[] = [];
    keyboard.onAction((action) => actions.push(action));
    key("keydown", "KeyR");
    key("keydown", "KeyR", true);
    key("keydown", "KeyC");
    key("keydown", "Escape");
    key("keydown", "KeyQ");
    expect(actions).toEqual(["reset", "camera", "pause"]);
  });

  test("game keys do not scroll the page; other keys keep their default", () => {
    const { window, document, key } = page();
    createKeyboard(window, document);
    expect(key("keydown", "ArrowDown").defaultPrevented).toBe(true);
    expect(key("keydown", "KeyR").defaultPrevented).toBe(true);
    expect(key("keydown", "Tab").defaultPrevented).toBe(false);
  });

  test("stops listening after dispose", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    const actions: string[] = [];
    keyboard.onAction((action) => actions.push(action));
    keyboard.dispose();
    key("keydown", "KeyW");
    key("keydown", "KeyR");
    expect(keyboard.held().throttle).toBe(false);
    expect(actions).toEqual([]);
  });

  test("keys typed into a form field neither drive nor lose their default", () => {
    const { window, document } = page();
    const keyboard = createKeyboard(window, document);
    const input = Object.assign(new EventTarget(), { tagName: "INPUT" });
    const event = Object.assign(new Event("keydown", { cancelable: true, bubbles: true }), {
      code: "ArrowUp",
      repeat: false,
    });

    // Dispatch on the field, then let it reach the window listener as a bubbled event.
    Object.defineProperty(event, "target", { value: input });
    window.dispatchEvent(event);
    expect(keyboard.held().throttle).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  test("either Shift key held requests deployment; E cycles the energy mode", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    const actions: string[] = [];
    keyboard.onAction((action) => actions.push(action));
    key("keydown", "ShiftLeft");
    expect(keyboard.held().deploy).toBe(true);
    key("keyup", "ShiftLeft");
    key("keydown", "ShiftRight");
    expect(keyboard.held().deploy).toBe(true);
    key("keydown", "KeyE");
    expect(actions).toEqual(["energyMode"]);
  });

  test("X shifts up and Z shifts down, once per press", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    const actions: string[] = [];
    keyboard.onAction((action) => actions.push(action));
    key("keydown", "KeyX");
    key("keyup", "KeyX");
    key("keydown", "KeyZ");
    expect(actions).toEqual(["shiftUp", "shiftDown"]);
  });

  test("H or ? opens the controls help, whatever key the layout puts ? on", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    const actions: string[] = [];
    keyboard.onAction((action) => actions.push(action));
    key("keydown", "KeyH");
    key("keydown", "Minus", false, "?");
    expect(actions).toEqual(["help", "help"]);
  });

  test("the controls help lists every bound key, and each key once", () => {
    const codes = CONTROLS_HELP.flatMap((row) => row.codes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of ["ArrowUp", "KeyW", "KeyS", "KeyA", "KeyD", "ShiftLeft", "KeyR", "KeyC", "Escape", "KeyE"]) {
      expect(codes).toContain(code);
    }

    for (const code of ["KeyX", "KeyZ", "KeyH"]) {
      expect(codes).toContain(code);
    }

    for (const row of CONTROLS_HELP) {
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.keys.length).toBeGreaterThanOrEqual(row.codes.length);
    }

    // ? has no fixed key code, so the help row shows it as an extra keycap.
    expect(CONTROLS_HELP.find((row) => row.codes.includes("KeyH"))?.keys).toEqual(["H", "?"]);
  });

  test("a focused checkbox or button still lets game keys through", () => {
    const { window, document } = page();
    const keyboard = createKeyboard(window, document);
    const actions: string[] = [];
    keyboard.onAction((action) => actions.push(action));
    for (const target of [
      { tagName: "INPUT", type: "checkbox" },
      { tagName: "BUTTON", type: "button" },
    ]) {
      const event = Object.assign(new Event("keydown", { cancelable: true }), {
        code: "Escape",
        repeat: false,
      });
      Object.defineProperty(event, "target", { value: Object.assign(new EventTarget(), target) });
      window.dispatchEvent(event);
    }

    expect(actions).toEqual(["pause", "pause"]);
  });
});

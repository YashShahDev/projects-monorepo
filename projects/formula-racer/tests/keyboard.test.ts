import { describe, expect, test } from "bun:test";
import { createKeyboard } from "../src/app/keyboard.ts";

function page() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const key = (type: "keydown" | "keyup", code: string, repeat = false) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat });
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
    expect(keyboard.held()).toEqual({ throttle: true, brake: false, left: true, right: false });
    key("keyup", "ArrowUp");
    expect(keyboard.held().throttle).toBe(false);
  });

  test("losing focus releases every held key", () => {
    const { window, document, key } = page();
    const keyboard = createKeyboard(window, document);
    key("keydown", "KeyW");
    key("keydown", "ArrowRight");
    window.dispatchEvent(new Event("blur"));
    expect(keyboard.held()).toEqual({ throttle: false, brake: false, left: false, right: false });
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
});

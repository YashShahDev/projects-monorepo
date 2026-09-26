import type { TrackGeometry } from "../simulation/track-geometry.ts";
import type { VehicleSnapshot } from "../simulation/vehicle.ts";
import { createGMeter, shiftLights } from "./telemetry.ts";
import { findCorners, mapProjection, nextCorner, previewPath } from "./track-map.ts";

const SVG = "http://www.w3.org/2000/svg";
const SHIFT_LIGHTS = 8;
const MAP_SIZE = { width: 220, height: 150, padding: 10 };

// The preview shows the corner ahead once it is this close, and this much road.
const PREVIEW_FROM_M = 320;
const PREVIEW_AHEAD_M = 260;
const PREVIEW_BEHIND_M = 40;

// The g-force dot reaches the ring's edge at this many g.
const G_RING = 5;

export interface DashboardElements {
  /** Telemetry: shift lights, rpm, pedals and g-force. */
  telemetry: HTMLElement;
  map: SVGSVGElement;
  preview: HTMLElement;
}

export interface Dashboard {
  update(car: VehicleSnapshot, frameSeconds: number): void;

  /** The car was put back on the grid: readings that compare frames start again. */
  reset(): void;
}

const svg = <K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string> = {}) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }

  return node;
};

const html = (tag: string, attributes: Record<string, string> = {}, text = "") => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }

  node.textContent = text;

  return node;
};

/** A labelled horizontal bar whose fill is set as a 0–1 share. */
function bar(label: string, id: string) {
  const fill = html("i", { id });
  const track = html("span", { class: "bar" });
  track.append(fill);
  const row = html("div", { class: "pedal" });
  row.append(html("span", { class: "label" }, label), track);

  return {
    row,
    set: (share: number) => (fill.style.transform = `scaleX(${Math.max(0, Math.min(1, share)).toFixed(3)})`),
  };
}

/**
 * The on-screen telemetry dashboard, a track map with the car's position, and a
 * heading-up preview of the next corner as the car approaches it.
 */
const ledColour = (index: number) => {
  if (index < 3) {
    return "green";
  }

  return index < 6 ? "amber" : "red";
};

export function createDashboard(
  elements: DashboardElements,
  track: TrackGeometry,
  gearbox: { upshiftRpm: number; redlineRpm: number },
  startDistanceM: number,
): Dashboard {
  // Telemetry.
  const lights = html("div", { id: "shift-lights", "aria-hidden": "true" });
  const leds = Array.from({ length: SHIFT_LIGHTS }, (_, i) => html("i", { class: ledColour(i) }));
  lights.append(...leds);
  const rpm = html("span", { id: "rpm" }, "0");
  const rpmRow = html("div", { class: "rpm" });
  rpmRow.append(rpm, html("span", { class: "unit" }, " rpm"));
  const throttle = bar("Throttle", "throttle-bar");
  const brake = bar("Brake", "brake-bar");
  const ring = svg("svg", { viewBox: "-1.1 -1.1 2.2 2.2", class: "g-ring", "aria-hidden": "true" });
  ring.append(
    svg("circle", { r: "1", class: "outer" }),
    svg("circle", { r: "0.5", class: "inner" }),
    svg("line", { x1: "-1", y1: "0", x2: "1", y2: "0" }),
    svg("line", { x1: "0", y1: "-1", x2: "0", y2: "1" }),
  );
  const dot = svg("circle", { r: "0.12", id: "g-dot" });
  ring.append(dot);
  const gText = html("span", { id: "g-force" }, "0.0 g");
  const gBox = html("div", { class: "g-box" });
  gBox.append(ring, gText);
  elements.telemetry.replaceChildren(lights, rpmRow, throttle.row, brake.row, gBox);
  const meter = createGMeter();

  // Map.
  const map = mapProjection(track, MAP_SIZE.width, MAP_SIZE.height, MAP_SIZE.padding);
  elements.map.setAttribute("viewBox", `0 0 ${String(MAP_SIZE.width)} ${String(MAP_SIZE.height)}`);
  const start = track.pointAt(startDistanceM);
  const [su, sv] = map.toMap(start.x, start.z);
  const carDot = svg("circle", { r: "4", id: "map-car" });
  elements.map.replaceChildren(
    svg("path", { d: map.path, class: "outline" }),
    svg("path", { d: map.path, class: "road" }),
    svg("circle", { cx: su.toFixed(1), cy: sv.toFixed(1), r: "3", class: "start" }),
    carDot,
  );

  // Corner preview.
  const corners = findCorners(track);
  const previewSvg = svg("svg", { viewBox: "0 0 100 100", "aria-hidden": "true" });
  const behind = svg("path", { class: "behind" });
  const ahead = svg("path", { class: "ahead" });
  previewSvg.append(behind, ahead, svg("circle", { cx: "50", cy: "90", r: "3.5", class: "car" }));
  const label = html("span", { id: "corner-label" });
  elements.preview.replaceChildren(previewSvg, label);
  elements.preview.hidden = true;
  let shownCorner = -1;

  // Starting each lookup from the last frame's sample avoids a full centreline scan.
  let hint: number | undefined;

  return {
    reset() {
      meter.reset();
      hint = undefined;
    },
    update(car, frameSeconds) {
      const location = track.locate(car.position.x, car.position.z, hint);
      hint = location.index;
      const lapDistanceM = location.distanceM;
      const lit = shiftLights(car.rpm, gearbox, SHIFT_LIGHTS);
      leds.forEach((led, i) => led.classList.toggle("on", i < lit));
      lights.classList.toggle("flash", lit === SHIFT_LIGHTS);
      rpm.textContent = String(Math.round(car.rpm / 10) * 10);
      throttle.set(car.applied.throttle);
      brake.set(car.applied.brake);
      const g = meter.update(car.speedMps, car.angularVelocity.y, frameSeconds);

      // Screen right is the driver's right, so a left turn's pull (to the right) moves
      // the dot right; braking pushes it up.
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      dot.setAttribute("cx", clamp(g.lateral / G_RING).toFixed(3));
      dot.setAttribute("cy", clamp(g.longitudinal / G_RING).toFixed(3));
      gText.textContent = `${Math.hypot(g.lateral, g.longitudinal).toFixed(1)} g`;

      const [u, v] = map.toMap(car.position.x, car.position.z);
      carDot.setAttribute("cx", u.toFixed(1));
      carDot.setAttribute("cy", v.toFixed(1));

      const next = nextCorner(corners, track.lengthM, lapDistanceM);
      const show = next !== undefined && next.inM < PREVIEW_FROM_M;
      elements.preview.hidden = !show;
      if (show) {
        const preview = previewPath(track, lapDistanceM, PREVIEW_AHEAD_M, PREVIEW_BEHIND_M);
        ahead.setAttribute("d", preview.path);
        behind.setAttribute("d", preview.behind);
        const { corner, inM } = next;
        const text = `Turn ${String(corner.number)} · ${corner.direction === "left" ? "Left" : "Right"} · ${
          inM > 0 ? `${String(Math.round(inM / 10) * 10)} m` : "now"
        }`;
        if (label.textContent !== text) {
          label.textContent = text;
        }

        if (shownCorner !== corner.number) {
          shownCorner = corner.number;
          elements.preview.dataset.corner = String(corner.number);
        }
      }
    },
  };
}

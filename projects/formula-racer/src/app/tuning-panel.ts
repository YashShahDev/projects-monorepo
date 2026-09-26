import type { CarDefinition } from "../content/car.ts";

export interface Tunable {
  car(): CarDefinition;
  retune(patch: Partial<CarDefinition>): void;
}

interface Field {
  label: string;
  /** Path into the car definition. */
  path: string[];
  step: string;
}

const FIELDS: Field[] = [
  { label: "Mass (kg)", path: ["massKg"], step: "10" },
  { label: "Tyre friction μ", path: ["wheels", "frictionCoefficient"], step: "0.05" },
  { label: "Spring stiffness", path: ["wheels", "suspensionStiffness"], step: "5" },
  { label: "Max power (W)", path: ["powertrain", "maxPowerW"], step: "10000" },
  { label: "Drag area (m²)", path: ["aero", "dragAreaM2"], step: "0.05" },
  { label: "Downforce area (m²)", path: ["aero", "downforceAreaM2"], step: "0.1" },
  { label: "Front downforce share", path: ["aero", "frontShare"], step: "0.01" },
];

type Tree = Record<string, unknown>;

const read = (car: CarDefinition, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node as Tree)[key], car);

function write(tree: Tree, path: string[], value: number): void {
  const [key, ...rest] = path;
  if (key === undefined) return;
  if (rest.length === 0) tree[key] = value;
  else write(tree[key] as Tree, rest, value);
}

/**
 * Development-only panel (F2) for live handling experiments. Changes go through the same
 * validation as shipped content and take effect on the next reset.
 */
export function installTuningPanel(target: Tunable): () => void {
  const form = document.createElement("form");
  form.id = "tuning";
  form.setAttribute("aria-label", "Tuning");
  form.hidden = true;
  // Content validation names the failing field; the browser's step checks would instead
  // silently block values like 1.36 that are not a multiple of the spinner step.
  form.noValidate = true;
  const inputs = FIELDS.map((field) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "number";
    input.step = field.step;
    label.append(field.label, input);
    form.append(label);
    return input;
  });
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.textContent = "Apply on reset";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  form.append(apply, status);
  document.body.append(form);

  const load = () => {
    const car = target.car();
    FIELDS.forEach((field, i) => {
      const input = inputs[i];
      if (input) input.value = String(read(car, field.path));
    });
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = structuredClone(target.car()) as unknown as Tree;
    FIELDS.forEach((field, i) => write(next, field.path, Number(inputs[i]?.value)));
    try {
      target.retune(next as unknown as CarDefinition);
      status.textContent = "Queued. Press R to reset with the new setup.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== "F2") return;
    event.preventDefault();
    form.hidden = !form.hidden;
    if (!form.hidden) load();
  };
  addEventListener("keydown", onKey);
  return () => {
    removeEventListener("keydown", onKey);
    form.remove();
  };
}

import type { CarDefinition } from "../content/car.ts";

export interface Tunable {
  car(): CarDefinition;
  retune(patch: Partial<CarDefinition>): void;
}

interface Field {
  label: string;
  step: string;
  get(car: CarDefinition): number;

  /** Writes into a cloned definition, which validation checks before it is used. */
  set(car: CarDefinition, value: number): void;
}

const FIELDS: Field[] = [
  {
    label: "Mass (kg)",
    step: "10",
    get: (c) => c.massKg,
    set: (c, v) => {
      c.massKg = v;
    },
  },
  {
    label: "Tyre friction μ",
    step: "0.05",
    get: (c) => c.wheels.frictionCoefficient,
    set: (c, v) => {
      c.wheels.frictionCoefficient = v;
    },
  },
  {
    label: "Spring stiffness",
    step: "5",
    get: (c) => c.wheels.suspensionStiffness,
    set: (c, v) => {
      c.wheels.suspensionStiffness = v;
    },
  },
  {
    label: "Max power (W)",
    step: "10000",
    get: (c) => c.powertrain.maxPowerW,
    set: (c, v) => {
      c.powertrain.maxPowerW = v;
    },
  },
  {
    label: "Drag area (m²)",
    step: "0.05",
    get: (c) => c.aero.dragAreaM2,
    set: (c, v) => {
      c.aero.dragAreaM2 = v;
    },
  },
  {
    label: "Downforce area (m²)",
    step: "0.1",
    get: (c) => c.aero.downforceAreaM2,
    set: (c, v) => {
      c.aero.downforceAreaM2 = v;
    },
  },
  {
    label: "Front downforce share",
    step: "0.01",
    get: (c) => c.aero.frontShare,
    set: (c, v) => {
      c.aero.frontShare = v;
    },
  },
];

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
      if (input) {
        input.value = String(field.get(car));
      }
    });
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = structuredClone(target.car());
    FIELDS.forEach((field, i) => {
      field.set(next, Number(inputs[i]?.value));
    });
    try {
      target.retune(next);
      status.textContent = "Queued. Press R to reset with the new setup.";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.code !== "F2") {
      return;
    }

    event.preventDefault();

    // `hidden` may also be "until-found"; anything but false counts as hidden.
    form.hidden = form.hidden === false;
    if (!form.hidden) {
      load();
    }
  };

  addEventListener("keydown", onKey);

  return () => {
    removeEventListener("keydown", onKey);
    form.remove();
  };
}

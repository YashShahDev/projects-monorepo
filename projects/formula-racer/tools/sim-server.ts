/**
 * The headless control server: one JSON message per line on stdin, one reply per line
 * on stdout, in order. See docs/CONTROL.md. Run with `bun run tools/sim-server.ts`.
 */
import { createInterface } from "node:readline";
import { createControlEnvironment } from "../src/control/environment.ts";
import { CONTROL_VERSION } from "../src/control/protocol.ts";
import { fileSessions } from "./control-sources.ts";

const environment = createControlEnvironment(fileSessions());
const reply = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.trim() === "") {
    continue;
  }

  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    reply({ type: "error", controlVersion: CONTROL_VERSION, error: "a message must be one line of JSON" });
    continue;
  }

  const answer = await environment.handle(message);
  reply(answer);
  if (answer.type === "closed") {
    break;
  }
}

environment.close();

// An open stdin would keep the process alive after `close`.
lines.close();
process.stdin.destroy();

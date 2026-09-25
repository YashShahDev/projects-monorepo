import { fetchProbeScene } from "../content/probe-scene.ts";

const status = document.querySelector<HTMLElement>("#status");
if (!status) throw new Error("index.html is missing #status");

try {
  // Resolve against the document so the build works from any URL subpath.
  await fetchProbeScene(new URL("assets/probe/scene.json", document.baseURI));
  status.textContent = "Probe scene loaded";
} catch (error) {
  status.setAttribute("role", "alert");
  status.textContent = `Could not start: ${error instanceof Error ? error.message : String(error)}`;
}

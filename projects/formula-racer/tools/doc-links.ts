import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export function checkDocLinks(root: string): string[] {
  const problems: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }

      if (!entry.name.endsWith(".md")) {
        continue;
      }

      const text = readFileSync(path, "utf8").replaceAll(/```[\s\S]*?```/gu, "");
      for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/gu)) {
        const target = match[1];
        if (target === undefined || /^(?:[a-z][a-z\d+.-]*:|#)/iu.test(target)) {
          continue;
        }

        const filename = target.split("#")[0];
        if (filename === undefined || filename === "") {
          continue;
        }

        let decoded: string;
        try {
          decoded = decodeURIComponent(filename);
        } catch {
          problems.push(`${relative(root, path)}: malformed link ${target}`);
          continue;
        }

        if (!existsSync(resolve(dirname(path), decoded))) {
          problems.push(`${relative(root, path)}: missing ${target}`);
        }
      }
    }
  };

  visit(root);

  return problems;
}

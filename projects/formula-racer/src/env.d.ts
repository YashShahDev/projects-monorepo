// Bun inlines this at bundle time; the browser has no `process` object.
declare const process: { env: { NODE_ENV?: string } };

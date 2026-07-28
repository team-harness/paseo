import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "schema"), { recursive: true });
await Promise.all([
  cp(join(root, "app.js"), join(dist, "app.js")),
  cp(join(root, "index.html"), join(dist, "index.html")),
  cp(join(root, "styles.css"), join(dist, "styles.css")),
  cp(
    join(root, "schema", "paseo-chat-history.v1.schema.json"),
    join(dist, "schema", "paseo-chat-history.v1.schema.json"),
  ),
]);

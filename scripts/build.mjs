import { build, context } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateIcons } from "./generate-icons.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const dist = path.join(root, "dist");
const watch = process.argv.includes("--watch");
const production = !watch && !process.argv.includes("--dev");

const shared = {
  bundle: true,
  target: ["chrome110"],
  logLevel: "info",
  minify: production,
  sourcemap: production ? false : "inline",
  legalComments: "none",
  charset: "utf8",
  define: {
    "process.env.NODE_ENV": JSON.stringify(production ? "production" : "development"),
  },
};

async function copyStatic() {
  await mkdir(path.join(dist, "popup"), { recursive: true });
  await mkdir(path.join(dist, "assets"), { recursive: true });

  await cp(path.join(src, "popup", "index.html"), path.join(dist, "popup", "index.html"));
  await cp(path.join(src, "popup", "popup.css"), path.join(dist, "popup", "popup.css"));

  for (const size of [16, 48, 128]) {
    await cp(
      path.join(root, "assets", `icon${size}.png`),
      path.join(dist, "assets", `icon${size}.png`),
    );
  }

  const manifest = JSON.parse(await readFile(path.join(src, "manifest.json"), "utf8"));
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  manifest.version = pkg.version;
  manifest.description = pkg.description;
  await writeFile(
    path.join(dist, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

const configs = [
  {
    ...shared,
    entryPoints: [path.join(src, "background", "service-worker.ts")],
    outfile: path.join(dist, "background", "service-worker.js"),
    format: "esm",
    platform: "browser",
  },
  {
    ...shared,
    entryPoints: [path.join(src, "content", "content.ts")],
    outfile: path.join(dist, "content", "content.js"),
    format: "iife",
    platform: "browser",
  },
  {
    ...shared,
    entryPoints: [path.join(src, "content", "bridge.ts")],
    outfile: path.join(dist, "content", "bridge.js"),
    format: "iife",
    platform: "browser",
  },
  {
    ...shared,
    entryPoints: [path.join(src, "popup", "popup.ts")],
    outfile: path.join(dist, "popup", "popup.js"),
    format: "iife",
    platform: "browser",
  },
];

async function buildOnce() {
  await rm(dist, { recursive: true, force: true });
  if (!existsSync(path.join(root, "assets", "icon128.png"))) {
    generateIcons();
  }
  await copyStatic();
  await Promise.all(configs.map((config) => build(config)));
  console.log(`\nTypeFlow built to ${path.relative(root, dist)} (${production ? "production" : "development"})`);
}

async function buildWatch() {
  await rm(dist, { recursive: true, force: true });
  if (!existsSync(path.join(root, "assets", "icon128.png"))) {
    generateIcons();
  }
  await copyStatic();
  const contexts = await Promise.all(configs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`\nWatching TypeFlow sources… built to ${path.relative(root, dist)}`);
  console.log("Reload the extension in chrome://extensions after changes.");
}

if (watch) {
  await buildWatch();
} else {
  await buildOnce();
}

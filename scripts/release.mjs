// Usage: npm run release -- 0.3.0
// Sets the version in package.json, tauri.conf.json and Cargo.toml (+ Cargo.lock), commits,
// and tags v0.3.0. Pushing the tag makes GitHub publish the release that Milo updates from.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Give a version like 0.3.0:  npm run release -- 0.3.0");
  process.exit(1);
}
const run = (cmd) => execSync(cmd, { stdio: "inherit" });
if (execSync("git status --porcelain").toString().trim()) {
  console.error("Commit or stash your changes first, so the release is exactly what is committed.");
  process.exit(1);
}

const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};
json("package.json", (d) => (d.version = version));
json("src-tauri/tauri.conf.json", (d) => (d.version = version));
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").replace(/^version = ".*"$/m, `version = "${version}"`);
writeFileSync("src-tauri/Cargo.toml", cargo);
execSync("cargo metadata --format-version 1 --manifest-path src-tauri/Cargo.toml", { stdio: "ignore" }); // updates Cargo.lock

run("git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock");
run(`git commit -m "Release v${version}"`);
run(`git tag v${version}`);
console.log(`\nReady. Publish it with:\n  git push && git push origin v${version}\n`);

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const targetVersion = process.env.npm_package_version;

// Fetch latest README from GitHub
try {
  execSync("git fetch origin && git checkout origin/main -- README.md", {
    stdio: "inherit",
  });
  console.log("Updated README.md from GitHub");
} catch {
  console.warn("Could not fetch README.md from GitHub");
}

// Update manifest.json
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

console.log(`Updated manifest.json to version ${targetVersion}`);

// Auto-update eslint-plugin-obsidianmd if outdated (review bot uses this plugin)
try {
  // npm outdated exits 0 when everything is current — nothing to do
  execSync("npm outdated eslint-plugin-obsidianmd --json", {
    encoding: "utf8",
  });
} catch (err) {
  // npm outdated exits 1 when a package is outdated, with JSON on stdout
  let info;
  try {
    info = JSON.parse(err.stdout)["eslint-plugin-obsidianmd"];
  } catch {
    // JSON parse failed — ignore silently
  }
  if (info) {
    console.log(
      `\nUpdating eslint-plugin-obsidianmd: ${info.current} → ${info.latest}`
    );
    execSync("npm update eslint-plugin-obsidianmd", { stdio: "inherit" });
    execSync("git add package.json package-lock.json", { stdio: "inherit" });

    // Verify no new lint errors from the updated plugin
    try {
      execSync("npx eslint .", { stdio: "inherit" });
      console.log("ESLint passed with updated plugin\n");
    } catch {
      console.error(
        "\n⚠ ESLint failed after updating eslint-plugin-obsidianmd. Fix lint errors before releasing.\n"
      );
      process.exit(1);
    }
  }
}

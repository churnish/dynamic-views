import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const targetVersion = process.env.npm_package_version;

// IMPORTANT: When creating git tags, use format "X.Y.Z" NOT "vX.Y.Z"
// The release workflow is configured to ignore v-prefixed tags

// Pull latest README from GitHub (since it's edited there)
console.log("Pulling latest README from GitHub...");
try {
  execSync(
    "curl -f -o README.md https://raw.githubusercontent.com/greetclammy/dynamic-views/main/README.md",
    { stdio: "inherit" },
  );
  console.log("README updated from GitHub");
} catch (error) {
  console.warn(
    "Warning: Could not fetch README from GitHub. Continuing with local version.",
  );
}

// Update manifest.json
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

console.log(`Updated manifest.json to version ${targetVersion}`);

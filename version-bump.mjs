import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { dirname, join } from "path";

const targetVersion = process.env.npm_package_version;

// ── Pre-flight check (abort before any side effects) ─────────────────

// Full lint + catch any console.debug that isn't behind a DEBUG_ gate
try {
  execSync(
    'npx eslint . --rule \'no-console: ["error", {"allow": ["log","warn","error","info"]}]\'',
    { stdio: "inherit" },
  );
} catch {
  console.error(
    "\n⚠ ESLint failed. Fix lint errors (or ungated console.debug) before releasing.\n",
  );
  process.exit(1);
}

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
      `\nUpdating eslint-plugin-obsidianmd: ${info.current} → ${info.latest}`,
    );
    execSync("npm update eslint-plugin-obsidianmd", { stdio: "inherit" });
    execSync("git add package.json package-lock.json", { stdio: "inherit" });

    // Verify no new lint errors from the updated plugin
    try {
      execSync("npx eslint .", { stdio: "inherit" });
      console.log("ESLint passed with updated plugin\n");
    } catch {
      console.error(
        "\n⚠ ESLint failed after updating eslint-plugin-obsidianmd. Fix lint errors before releasing.\n",
      );
      process.exit(1);
    }
  }
}

// ── Side effects ─────────────────────────────────────────────────────

// Fetch latest README from GitHub
try {
  execSync("git fetch origin && git checkout origin/main -- README.md", {
    stdio: "inherit",
  });
  console.log("Updated README.md from GitHub");
} catch {
  console.warn("Could not fetch README.md from GitHub");
}

// Sync Claude config files from manifest
try {
  const manifest_md = readFileSync("claude-publish.md", "utf8");
  const destDir = ".claude";

  // Clean previous copy
  if (existsSync(destDir)) rmSync(destDir, { recursive: true });

  // Extract entries from fenced code blocks
  const entries = [];
  let inBlock = false;
  for (const line of manifest_md.split("\n")) {
    if (line.startsWith("```")) {
      inBlock = !inBlock;
      continue;
    }
    if (inBlock && line.trim()) entries.push(line.trim());
  }

  for (const entry of entries) {
    let dest, source;
    if (entry.includes(" < ")) {
      [dest, source] = entry.split(" < ");
    } else {
      source = entry;
      // Strip ~/.claude/ prefix to derive dest
      const home = process.env.HOME;
      dest = source.replace(`${home}/.claude/`, "");
    }

    const target = join(destDir, dest);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, {
      recursive: true,
      filter: (src) => !src.endsWith(".DS_Store"),
    });
  }

  console.log(`Synced ${entries.length} Claude config entries to ${destDir}/`);
} catch (err) {
  console.warn(`Could not sync Claude config: ${err.message}`);
}

// Update manifest.json
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

console.log(`Updated manifest.json to version ${targetVersion}`);

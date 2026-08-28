import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { createInterface } from 'readline';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const isPreflight = process.argv.includes('--preflight');
const targetVersion = process.env.npm_package_version;

// ── Pre-flight checks ──

// release.yml re-runs every one of these, but only once postversion has pushed the tag — and a failure there strands a tag with no release attached. Gating here instead fails the bump while there is still nothing to roll back.
if (isPreflight) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  const gates = [
    {
      label: 'ESLint',
      command:
        'npx eslint . --rule \'no-console: ["error", {"allow": ["warn","error","debug"]}]\'',
      hint: 'Fix lint errors (or ungated console.log) before releasing.',
    },
    // esbuild strips types without checking them, so nothing else catches a type error before it ships. JS-only plugins carry no tsconfig.
    ...(existsSync('tsconfig.json')
      ? [
          {
            label: 'Typecheck',
            command: 'npx tsc --noEmit',
            hint: 'Fix type errors before releasing.',
          },
        ]
      : []),
    ...(pkg.scripts?.test
      ? [
          {
            label: 'Tests',
            command: 'npm test',
            hint: 'Fix failing tests before releasing.',
          },
        ]
      : []),
    {
      label: 'Build',
      command: 'npm run build',
      hint: 'Fix the build before releasing.',
    },
  ];

  for (const gate of gates) {
    console.log(`\n▶ ${gate.label}`);
    try {
      execSync(gate.command, { stdio: 'inherit' });
    } catch {
      console.error(`\n⚠ ${gate.label} failed. ${gate.hint}\n`);
      process.exit(1);
    }
  }

  console.log('\n✓ All pre-flight gates passed.\n');
  process.exit(0);
}

if (!targetVersion) {
  console.error('npm_package_version is not set. Run via npm version.');
  process.exit(1);
}

// ── Sync shared docs ──

const __dirname = dirname(fileURLToPath(import.meta.url));
// Source of truth for docs copied verbatim into every plugin. Not the odkb repo: these describe this workspace's own release machinery, not shared Obsidian knowledge.
const sharedDocsDir = join(__dirname, '..', 'local');

const sharedDocs = ['release-guide.md'];
for (const doc of sharedDocs) {
  const src = join(sharedDocsDir, doc);
  if (existsSync(src)) {
    const dest = join('docs', doc);
    writeFileSync(dest, readFileSync(src, 'utf8'));
    execSync(`git add "${dest}"`, { stdio: 'inherit' });
    console.log(`Synced ${doc} from local/`);
  } else {
    console.warn(`Skipping ${doc}: not found at ${src}`);
  }
}

try {
  execSync('npm outdated eslint-plugin-obsidianmd --json', {
    encoding: 'utf8',
  });
} catch (err) {
  let info;
  try {
    info = JSON.parse(err.stdout)['eslint-plugin-obsidianmd'];
  } catch {}
  if (info) {
    console.log(
      `\nUpdating eslint-plugin-obsidianmd: ${info.current} → ${info.latest}`
    );
    execSync('npm update eslint-plugin-obsidianmd', { stdio: 'inherit' });
    execSync('git add package.json', { stdio: 'inherit' });

    // The preflight lint ran against the previous plugin version, so its result no longer stands.
    try {
      execSync('npx eslint .', { stdio: 'inherit' });
      console.log('ESLint passed with updated plugin\n');
    } catch {
      console.error(
        '\n⚠ ESLint failed after updating eslint-plugin-obsidianmd. Fix lint errors before releasing.\n'
      );
      process.exit(1);
    }
  }
}

// ── Dependency freshness check ──

try {
  execSync('npm outdated --json', { encoding: 'utf8' });
} catch (err) {
  let outdated;
  try {
    outdated = JSON.parse(err.stdout);
  } catch {}

  // Deduplicate array entries and filter to packages npm update can fix
  const updatable = {};
  if (outdated) {
    for (const [pkg, entry] of Object.entries(outdated)) {
      const info = Array.isArray(entry) ? entry[0] : entry;
      if (info.current !== info.wanted) updatable[pkg] = info;
    }
  }

  if (Object.keys(updatable).length > 0) {
    console.log('\n📦 Updatable packages:');
    for (const [pkg, info] of Object.entries(updatable)) {
      console.log(`  ${pkg}: ${info.current} → ${info.wanted}`);
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await new Promise((resolve) => {
      rl.question('\nUpdate before releasing? (y/n) ', (a) => {
        rl.close();
        resolve(a.trim().toLowerCase());
      });
    });

    if (answer === 'y') {
      execSync('npm update', { stdio: 'inherit' });
      execSync('git add package.json', { stdio: 'inherit' });
      console.log('Dependencies updated.\n');
    }
  }
}

// ── Side effects ──

// GitHub is the source of truth for these: they are edited through the web UI, so a conflict is resolved by taking origin's copy whole rather than reconciling it hunk by hunk.
const webEditedDocs = ['README', 'CONTRIBUTING'];

try {
  execSync('git fetch origin', { stdio: 'inherit' });

  // Merging rather than copying keeps the web-edit commits in local history, which is what lets postversion fast-forward instead of force-pushing over them.
  try {
    execSync('git merge origin/main --no-commit --no-ff', { stdio: 'inherit' });
  } catch {
    // Expected whenever both sides touched these files; resolved just below.
  }

  const conflicted = execSync('git diff --name-only --diff-filter=U', {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  // A conflict anywhere else means the histories diverged in a way this script has no business resolving unattended.
  const unexpected = conflicted.filter(
    (f) => !webEditedDocs.some((prefix) => f.startsWith(prefix))
  );
  if (unexpected.length > 0) {
    execSync('git merge --abort', { stdio: 'inherit' });
    console.error(
      `\n⚠ Unexpected merge conflicts: ${unexpected.join(', ')}. Resolve manually before releasing.\n`
    );
    process.exit(1);
  }

  const files = execSync('git ls-tree --name-only origin/main', {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => webEditedDocs.some((prefix) => f.startsWith(prefix)));
  for (const file of files) {
    execSync(`git checkout origin/main -- ${file}`, { stdio: 'inherit' });
    execSync(`git add "${file}"`, { stdio: 'inherit' });
    console.log(`Updated ${file} from GitHub`);
  }

  // MERGE_HEAD is absent when origin had nothing new. Committing here keeps the merge as its own commit rather than folding it into npm's version commit.
  let isMerging = true;
  try {
    execSync('git rev-parse -q --verify MERGE_HEAD', { stdio: 'ignore' });
  } catch {
    isMerging = false;
  }
  if (isMerging) {
    execSync('git commit --no-edit', { stdio: 'inherit' });
    console.log('Merged origin/main');
  }
} catch {
  console.warn('Could not sync README and CONTRIBUTING from GitHub');
}

let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');
execSync('git add manifest.json', { stdio: 'inherit' });

let versions = existsSync('versions.json')
  ? JSON.parse(readFileSync('versions.json', 'utf8'))
  : {};
const lastMinVersion = Object.values(versions).pop();
if (lastMinVersion !== manifest.minAppVersion) {
  versions[targetVersion] = manifest.minAppVersion;
  writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');
  execSync('git add versions.json', { stdio: 'inherit' });
  console.log(`Updated versions.json for ${targetVersion}`);
}

console.log(`Updated manifest.json to version ${targetVersion}`);

const pluginName = basename(__dirname);
const deepwikiPlugins = ['dynamic-views', 'first-line-is-title'];
if (deepwikiPlugins.includes(pluginName)) {
  console.log(
    `\n🔄 After release, refresh the wiki: https://deepwiki.com/churnish/${pluginName}\n`
  );
}

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const isPreflight = process.argv.includes('--preflight');
const targetVersion = process.env.npm_package_version;

// ── Pre-flight checks ──

try {
  execSync(
    'npx eslint . --rule \'no-console: ["error", {"allow": ["log","warn","error","info"]}]\'',
    { stdio: 'inherit' }
  );
} catch {
  console.error(
    '\n⚠ ESLint failed. Fix lint errors (or ungated console.debug) before releasing.\n'
  );
  process.exit(1);
}

if (isPreflight) process.exit(0);

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

if (!targetVersion) {
  console.error('npm_package_version is not set. Run via npm version.');
  process.exit(1);
}

// ── Side effects ──

try {
  execSync('git fetch origin', { stdio: 'inherit' });
  const files = execSync('git ls-tree --name-only origin/main', {
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f.startsWith('README'));
  for (const file of files) {
    execSync(`git checkout origin/main -- ${file}`, { stdio: 'inherit' });
    console.log(`Updated ${file} from GitHub`);
  }
} catch {
  console.warn('Could not fetch README files from GitHub');
}

let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');
execSync('git add manifest.json', { stdio: 'inherit' });

if (existsSync('versions.json')) {
  let versions = JSON.parse(readFileSync('versions.json', 'utf8'));
  const lastMinVersion = Object.values(versions).pop();
  if (lastMinVersion !== manifest.minAppVersion) {
    versions[targetVersion] = manifest.minAppVersion;
    writeFileSync('versions.json', JSON.stringify(versions, null, '\t') + '\n');
    execSync('git add versions.json', { stdio: 'inherit' });
    console.log(`Updated versions.json for ${targetVersion}`);
  }
}

console.log(`Updated manifest.json to version ${targetVersion}`);

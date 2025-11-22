import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// Update manifest.json
let manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = targetVersion;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');

console.log(`Updated manifest.json to version ${targetVersion}`);

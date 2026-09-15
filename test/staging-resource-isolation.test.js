import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readConfig(name) {
  return fs.readFileSync(path.join(repoRoot, name), 'utf8');
}

function resourceValue(config, key) {
  return config.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1] ?? null;
}

describe('staging resource isolation', () => {
  const production = readConfig('wrangler.toml');
  const staging = readConfig('wrangler.staging.toml');

  it('uses a staging-only R2 photo bucket', () => {
    const productionBucket = resourceValue(production, 'bucket_name');
    const stagingBucket = resourceValue(staging, 'bucket_name');

    expect(productionBucket).toBe('timothy-connect-photos');
    expect(stagingBucket).toBe('timothy-connect-photos-staging');
    expect(stagingBucket).not.toBe(productionBucket);
    expect(stagingBucket).toMatch(/-staging$/);
  });

  it('keeps staging cron triggers disabled', () => {
    expect(staging).toMatch(/\[triggers\]\s*\ncrons\s*=\s*\[\]/m);
  });

  it('uses the US jurisdiction for newly isolated photo storage', () => {
    expect(staging).toMatch(/bucket_name\s*=\s*"timothy-connect-photos-staging"\s*\njurisdiction\s*=\s*"us"/m);
  });
});

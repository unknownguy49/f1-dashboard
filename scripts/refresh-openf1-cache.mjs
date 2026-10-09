import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = 'https://api.openf1.org/v1';
const CACHE_DIR = path.resolve('data/cache');
const YEAR = 2026;
const WAIT_MS = 180;
const failures = [];
let updated = 0;

function cacheKey(endpoint, params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}-${value}`)
    .join('__');
  return `${endpoint}${query ? `__${query}` : ''}`
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .toLowerCase();
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeCache(endpoint, params, data) {
  const key = cacheKey(endpoint, params);
  const target = path.join(CACHE_DIR, `${key}.json`);
  await fs.mkdir(CACHE_DIR, { recursive: true });

  let existing = null;
  try {
    existing = JSON.parse(await fs.readFile(target, 'utf8'));
  } catch {}

  if (Array.isArray(data) && data.length === 0 && Array.isArray(existing?.data) && existing.data.length > 0) {
    console.log(`Kept existing non-empty cache for ${key}`);
    return;
  }

  if (existing && JSON.stringify(existing.data) === JSON.stringify(data)) return;

  await fs.writeFile(target, `${JSON.stringify({ fetchedAt: new Date().toISOString(), data }, null, 2)}\n`);
  updated += 1;
}

async function fetchAndCache(endpoint, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const url = `${BASE_URL}/${endpoint}${query.size ? `?${query.toString()}` : ''}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 240).replace(/\s+/g, ' ');
        const error = new Error(`HTTP ${response.status}${body ? `: ${body}` : ''}`);
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await delay(700 * (attempt + 1));
          continue;
        }
        throw error;
      }
      const data = await response.json();
      await writeCache(endpoint, params, data);
      await delay(WAIT_MS);
      return data;
    } catch (error) {
      if (attempt < 2 && (error.name === 'TypeError' || /fetch failed/i.test(error.message))) {
        await delay(500 * (attempt + 1));
        continue;
      }
      failures.push({ endpoint, params, error: error.message });
      console.warn(`Failed ${cacheKey(endpoint, params)}: ${error.message}`);
      return null;
    }
  }
  return null;
}

function sessionHasEnded(session, now = Date.now()) {
  const end = Date.parse(session.date_end || session.date_start || '');
  return Number.isFinite(end) && end < now && !session.is_cancelled;
}

async function main() {
  const meetings = await fetchAndCache('meetings', { year: YEAR });
  const sessionGroups = {};

  for (const name of ['Race', 'Qualifying', 'Sprint', 'Sprint Qualifying']) {
    sessionGroups[name] = await fetchAndCache('sessions', { year: YEAR, session_name: name });
  }

  if (!meetings || !sessionGroups.Race) {
    console.warn('Core calendar data could not be fully refreshed. Existing cached files were left intact where requests failed.');
  }

  const allSessions = Object.values(sessionGroups).flatMap((items) => Array.isArray(items) ? items : []);
  const completedSessions = allSessions.filter((session) => sessionHasEnded(session));
  const completedRaces = (sessionGroups.Race || []).filter((session) => sessionHasEnded(session));

  for (const session of completedSessions) {
    const key = session.session_key;
    if (!key) continue;
    await fetchAndCache('session_result', { session_key: key });
    await fetchAndCache('drivers', { session_key: key });

    if (session.session_name === 'Race' || session.session_name === 'Sprint') {
      await fetchAndCache('laps', { session_key: key });
      await fetchAndCache('starting_grid', { session_key: key });
    }
  }

  for (const session of completedRaces) {
    if (!session.session_key) continue;
    await fetchAndCache('championship_drivers', { session_key: session.session_key });
    await fetchAndCache('championship_teams', { session_key: session.session_key });
  }

  const metadataPath = path.join(CACHE_DIR, 'metadata.json');
  let metadataExists = true;
  try { await fs.access(metadataPath); } catch { metadataExists = false; }
  if (updated > 0 || !metadataExists) {
    const metadata = {
      season: YEAR,
      refreshedAt: new Date().toISOString(),
      filesUpdated: updated,
      requestFailures: failures.length,
      failedRequests: failures,
    };
    await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  }
  console.log(`OpenF1 cache refresh complete: ${updated} cache files changed, ${failures.length} requests failed.`);
  if (failures.length) {
    console.log('Existing valid cache files were preserved for failed requests. Review the workflow log for failure details.');
  }
}

await main();

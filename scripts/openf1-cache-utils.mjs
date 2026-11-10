
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://api.openf1.org/v1";
const CACHE_DIR = path.resolve("data/cache");
const KNOWN_404S_PATH = path.join(CACHE_DIR, "known-404s.json");
const ALL_YEARS = [2023, 2024, 2025, 2026];
const MIN_REQUEST_INTERVAL_MS = 2300;
const MAX_ATTEMPTS = 5;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cacheKey(endpoint, params = {})
{
    const query = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}-${value}`)
        .join("__");

    return `${endpoint}${query ? `__${query}` : ""}`
        .replace(/[^a-zA-Z0-9_-]/g, "-")
        .toLowerCase();
}

function retryDelay(response, attempt)
{
    const retryAfter = response?.headers?.get("retry-after");

    if (retryAfter)
    {
        const seconds = Number(retryAfter);

        if (Number.isFinite(seconds) && seconds >= 0)
        {
            return seconds * 1000;
        }

        const date = Date.parse(retryAfter);

        if (Number.isFinite(date))
        {
            return Math.max(0, date - Date.now());
        }
    }

    return Math.min(5000 * 2 ** attempt, 60000);
}

async function loadKnown404s()
{
    try
    {
        const data = JSON.parse(await fs.readFile(KNOWN_404S_PATH, "utf8"));

        if (!data || typeof data !== "object" || Array.isArray(data))
        {
            throw new Error("Invalid known-404s.json format.");
        }

        return data;
    }
    catch (error)
    {
        if (error.code === "ENOENT")
        {
            return {};
        }

        throw error;
    }
}

async function saveKnown404s(known404s)
{
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const temporary = `${KNOWN_404S_PATH}.tmp`;

    await fs.writeFile(
        temporary,
        `${JSON.stringify(known404s, null, 2)}\n`,
    );

    await fs.rename(temporary, KNOWN_404S_PATH);
}

function sessionHasEnded(session, now = Date.now())
{
    const end = Date.parse(session.date_end || session.date_start || "");

    return Number.isFinite(end) && end < now && !session.is_cancelled;
}

async function runRefresh(years, refreshLatest, workflowName)
{
    const failures = [];
    const known404s = await loadKnown404s();

    let updated = 0;
    let successful = 0;
    let retries = 0;
    let known404sAdded = 0;
    let known404sSkipped = 0;
    let lastRequestAt = 0;

    async function waitForRequestSlot()
    {
        const elapsed = Date.now() - lastRequestAt;
        const wait = MIN_REQUEST_INTERVAL_MS - elapsed;

        if (wait > 0)
        {
            await delay(wait);
        }

        lastRequestAt = Date.now();
    }

    async function writeCache(endpoint, params, data)
    {
        const key = cacheKey(endpoint, params);
        const target = path.join(CACHE_DIR, `${key}.json`);

        await fs.mkdir(CACHE_DIR, { recursive: true });

        let existing = null;

        try
        {
            existing = JSON.parse(await fs.readFile(target, "utf8"));
        }
        catch {}

        if (
            Array.isArray(data) &&
            data.length === 0 &&
            Array.isArray(existing?.data) &&
            existing.data.length > 0
        )
        {
            console.log(`Kept existing non-empty cache for ${key}`);
            return;
        }

        if (existing && JSON.stringify(existing.data) === JSON.stringify(data))
        {
            return;
        }

        const temporary = `${target}.tmp`;

        await fs.writeFile(
            temporary,
            `${JSON.stringify({
                fetchedAt: new Date().toISOString(),
                data,
            }, null, 2)}\n`,
        );

        await fs.rename(temporary, target);
        updated += 1;
    }

    async function fetchAndCache(endpoint, params = {})
    {
        const key = cacheKey(endpoint, params);

        if (known404s[key])
        {
            known404sSkipped += 1;
            console.log(`Skipped known 404: ${key}`);
            return null;
        }

        const query = new URLSearchParams();

        Object.entries(params).forEach(([param, value]) =>
        {
            if (value !== undefined && value !== null && value !== "")
            {
                query.set(param, String(value));
            }
        });

        const url = `${BASE_URL}/${endpoint}${query.size ? `?${query.toString()}` : ""}`;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1)
        {
            try
            {
                await waitForRequestSlot();

                const response = await fetch(url, {
                    headers: { Accept: "application/json" },
                    signal: AbortSignal.timeout(30000),
                });

                if (response.status === 404)
                {
                    const body = (await response.text())
                        .slice(0, 240)
                        .replace(/\s+/g, " ");

                    const now = new Date().toISOString();

                    known404s[key] = {
                        endpoint,
                        params,
                        firstSeen: now,
                        lastSeen: now,
                        response: body,
                    };

                    await saveKnown404s(known404s);
                    known404sAdded += 1;

                    console.warn(`Recorded permanent 404: ${key}`);
                    return null;
                }

                if (!response.ok)
                {
                    const body = (await response.text())
                        .slice(0, 240)
                        .replace(/\s+/g, " ");

                    const message = `HTTP ${response.status}${body ? `: ${body}` : ""}`;
                    const retryable = response.status === 429 || response.status >= 500;

                    if (retryable && attempt < MAX_ATTEMPTS - 1)
                    {
                        retries += 1;

                        const wait = retryDelay(response, attempt);

                        console.warn(
                            `${key}: ${message}. Retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${Math.ceil(wait / 1000)}s.`,
                        );

                        await delay(wait);
                        continue;
                    }

                    throw new Error(message);
                }

                const data = await response.json();

                if (!Array.isArray(data))
                {
                    throw new Error("Unexpected API response: expected a JSON array");
                }

                await writeCache(endpoint, params, data);
                successful += 1;

                if (attempt > 0)
                {
                    console.log(`Recovered ${key} after ${attempt} retries`);
                }

                return data;
            }
            catch (error)
            {
                const retryable =
                    error.name === "TypeError" ||
                    error.name === "TimeoutError" ||
                    error.name === "AbortError" ||
                    /fetch failed/i.test(error.message) ||
                    /Unexpected API response/i.test(error.message);

                if (retryable && attempt < MAX_ATTEMPTS - 1)
                {
                    retries += 1;

                    const wait = Math.min(3000 * 2 ** attempt, 30000);

                    console.warn(
                        `${key}: ${error.message}. Retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${Math.ceil(wait / 1000)}s.`,
                    );

                    await delay(wait);
                    continue;
                }

                failures.push({
                    endpoint,
                    params,
                    error: error.message,
                });

                console.warn(`Failed ${key}: ${error.message}`);
                return null;
            }
        }

        return null;
    }

    async function processSeason(year)
    {
        console.log(`\n========== Refreshing ${year} ==========`);

        const sessionNames = [
            "Race",
            "Qualifying",
            "Sprint",
            "Sprint Qualifying",
            "Sprint Shootout",
            "Practice 1",
            "Practice 2",
            "Practice 3",
        ];

        const meetings = await fetchAndCache("meetings", { year });
        const sessionGroups = {};

        for (const name of sessionNames)
        {
            sessionGroups[name] = await fetchAndCache("sessions", {
                year,
                session_name: name,
            });
        }

        if (!meetings || !sessionGroups.Race)
        {
            console.warn(
                `${year}: Core calendar data could not be fully refreshed. Existing cache files were preserved where requests failed.`,
            );
        }

        const allSessions = Object.values(sessionGroups).flatMap((items) =>
            Array.isArray(items) ? items : [],
        );

        const completedSessions = allSessions.filter((session) =>
            sessionHasEnded(session),
        );

        const completedRaces = completedSessions.filter(
            (session) => session.session_name === "Race",
        );

        for (const session of completedSessions)
        {
            const key = session.session_key;

            if (!key)
            {
                continue;
            }

            await fetchAndCache("session_result", { session_key: key });
            await fetchAndCache("drivers", { session_key: key });

            if (
                session.session_name === "Race" ||
                session.session_name === "Sprint"
            )
            {
                await fetchAndCache("laps", { session_key: key });
                await fetchAndCache("stints", { session_key: key });
                await fetchAndCache("pit", { session_key: key });
            }

            if (session.session_name === "Race")
            {
                const qualifyingSession = allSessions.find(
                    (candidate) =>
                        String(candidate.meeting_key) === String(session.meeting_key) &&
                        candidate.session_name === "Qualifying" &&
                        !candidate.is_cancelled &&
                        sessionHasEnded(candidate),
                );

                if (qualifyingSession?.session_key)
                {
                    await fetchAndCache("starting_grid", {
                        session_key: qualifyingSession.session_key,
                    });
                }
                else
                {
                    console.warn(
                        `${year}: Skipped race starting_grid for session ${key}: matching Qualifying session not found or not completed.`,
                    );
                }
            }

            if (session.session_name === "Sprint")
            {
                await fetchAndCache("starting_grid", { session_key: key });
            }
        }

        for (const session of completedRaces)
        {
            await fetchAndCache("championship_drivers", {
                session_key: session.session_key,
            });

            await fetchAndCache("championship_teams", {
                session_key: session.session_key,
            });
        }

        console.log(`${year}: season cache pass complete.`);
    }

    console.log(`Starting ${workflowName} refresh.`);

    for (const year of years)
    {
        await processSeason(year);
    }

    if (refreshLatest)
    {
        await fetchAndCache("championship_drivers", { session_key: "latest" });
        await fetchAndCache("championship_teams", { session_key: "latest" });
    }

    const metadataPath = path.join(CACHE_DIR, "metadata.json");

    await fs.mkdir(CACHE_DIR, { recursive: true });

    let existingMetadata = {};

    try
    {
        existingMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    }
    catch (error)
    {
        if (error.code !== "ENOENT")
        {
            throw error;
        }
    }

    const runStats = {
        refreshedAt: new Date().toISOString(),
        seasons: years,
        filesUpdated: updated,
        successfulRequests: successful,
        retries,
        requestFailures: failures.length,
        failedRequests: failures,
        known404sAdded,
        known404sSkipped,
    };

    const metadata = {
        ...existingMetadata,
        seasons: ALL_YEARS,
        refreshedAt: runStats.refreshedAt,
        filesUpdated: updated,
        successfulRequests: successful,
        retries,
        requestFailures: failures.length,
        failedRequests: failures,
        known404sAdded,
        known404sSkipped,
        known404sTotal: Object.keys(known404s).length,
        replayTelemetryCached: false,
        refreshes: {
            ...(existingMetadata.refreshes || {}),
            [workflowName]: runStats,
        },
    };

    await fs.writeFile(
        metadataPath,
        `${JSON.stringify(metadata, null, 2)}\n`,
    );

    console.log("");
    console.log(`${workflowName} cache refresh complete.`);
    console.log(`Seasons processed: ${years.join(", ")}`);
    console.log(`Successful requests: ${successful}`);
    console.log(`Retries performed: ${retries}`);
    console.log(`Cache files changed: ${updated}`);
    console.log(`New 404s recorded: ${known404sAdded}`);
    console.log(`Known 404s skipped: ${known404sSkipped}`);
    console.log(`Total known 404s: ${Object.keys(known404s).length}`);
    console.log(`Other failed requests: ${failures.length}`);

    if (failures.length)
    {
        console.log("Some requests failed. Existing valid cache files were preserved where possible.");
        console.log("Review the individual failure messages above.");
    }
}

export { runRefresh };

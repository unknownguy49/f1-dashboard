/* =====================================================
   OPENF1 RACE STATE
===================================================== */

let races = [];
let activeRaceSession = "race";

/* =====================================================
   OPENF1 DATA LAYER
===================================================== */

const OPENF1_BASE_URL = "https://api.openf1.org/v1";
const OPENF1_CACHE_DIRECTORY = "data/cache";
const OPENF1_LOCAL_CACHE_PREFIX = "f1_openf1_cache:";
let openF1CacheUsed = false;
let openF1RequestFailedWithoutCache = false;
let openF1SuccessfulRequest = false;

function openF1CacheKey(path, params = {}) {
  const query = Object.entries(params)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}-${value}`)
    .join("__");

  return `${path}${query ? `__${query}` : ""}`
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();
}

function openF1SetStatus(state, detail = "") {
  const banner = document.getElementById("apiStatusBanner");
  const label = document.getElementById("apiStatusLabel");
  const message = document.getElementById("apiStatusMessage");
  const retry = document.getElementById("apiStatusRetry");
  const toggle = document.getElementById("apiStatusToggle");
  if (!banner || !label || !message) return;

  banner.dataset.state = state;
  const states = {
    checking: ["CHECKING API", "Checking OpenF1 data availability."],
    operational: [
      "API OPERATIONAL",
      "Latest requested data was retrieved successfully.",
    ],
    cached: ["USING CACHED DATA", "Showing previously saved data."],
    unavailable: [
      "DATA UNAVAILABLE",
      "No saved copy was available for the requested data.",
    ],
  };
  const current = states[state] || states.checking;
  label.textContent = current[0];
  message.textContent = detail || current[1];
  if (retry) retry.hidden = state === "checking" || state === "operational";

  const shouldShowByDefault = state === "cached" || state === "unavailable";
  banner.hidden = !shouldShowByDefault;
  if (toggle) {
    toggle.dataset.state = state;
    toggle.setAttribute(
      "aria-label",
      shouldShowByDefault
        ? "Hide API status details"
        : "Show API status details",
    );
    toggle.setAttribute("aria-expanded", String(shouldShowByDefault));
    toggle.title = current[0];
  }
}

function openF1ToggleStatusBanner() {
  const banner = document.getElementById("apiStatusBanner");
  const toggle = document.getElementById("apiStatusToggle");
  if (!banner || !toggle || banner.dataset.state === "checking") return;
  banner.hidden = !banner.hidden;
  toggle.setAttribute("aria-expanded", String(!banner.hidden));
  toggle.setAttribute(
    "aria-label",
    banner.hidden ? "Show API status details" : "Hide API status details",
  );
}

function openF1FormatTimestamp(value) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function openF1SaveLocalCache(key, data, fetchedAt) {
  try {
    const payload = JSON.stringify({ data, fetchedAt });
    if (payload.length > 900000) return;
    localStorage.setItem(`${OPENF1_LOCAL_CACHE_PREFIX}${key}`, payload);
  } catch (error) {}
}

function openF1ReadLocalCache(key) {
  try {
    const raw = localStorage.getItem(`${OPENF1_LOCAL_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (
      !payload ||
      (!Array.isArray(payload.data) && typeof payload.data !== "object")
    )
      return null;
    return payload;
  } catch (error) {
    return null;
  }
}

async function openF1ReadStaticCache(key) {
  try {
    const response = await fetch(`${OPENF1_CACHE_DIRECTORY}/${key}.json`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = await response.json();
    if (
      !payload ||
      (!Array.isArray(payload.data) && typeof payload.data !== "object")
    )
      return null;
    return payload;
  } catch (error) {
    return null;
  }
}

async function openF1GetCachedData(path, params) {
  const key = openF1CacheKey(path, params);
  const [local, staticCache] = await Promise.all([
    Promise.resolve(openF1ReadLocalCache(key)),
    openF1ReadStaticCache(key),
  ]);
  if (!local) return staticCache;
  if (!staticCache) return local;
  return Date.parse(staticCache.fetchedAt || "") >
    Date.parse(local.fetchedAt || "")
    ? staticCache
    : local;
}

function openF1MarkCached(payload) {
  openF1CacheUsed = true;
  const timestamp = openF1FormatTimestamp(payload.fetchedAt);
  openF1SetStatus(
    "cached",
    `OpenF1 unavailable. Using cached data; last saved ${timestamp}. Some data may be outdated, incomplete, or unavailable. API access is restricted during live sessions, please try again 30 minutes after the session ends.`,
  );
}

const openF1CircuitImages = {
  15: "images/barcelona-catalunya.avif",
  153: "images/spain.avif",
};

const localCircuitImages = {
  Australia: "images/australia.avif",
  China: "images/china.avif",
  Japan: "images/japan.avif",
  Bahrain: "images/bahrain.avif",
  Miami: "images/miami.avif",
  "Emilia-Romagna": "images/italy.avif",
  Monaco: "images/monaco.avif",
  Spain: "images/spain.avif",
  Madring: "images/spain.avif",
  Canada: "images/canada.avif",
  Austria: "images/austria.avif",
  "Great Britain": "images/great-britain.avif",
  Belgium: "images/belgium.avif",
  Hungary: "images/hungary.avif",
  Netherlands: "images/netherlands.avif",
  Italy: "images/italy.avif",
  Azerbaijan: "images/azerbaijan.avif",
  Singapore: "images/singapore.avif",
  "United States": "images/usa.avif",
  Mexico: "images/mexico.avif",
  Brazil: "images/brazil.avif",
  "Las Vegas": "images/las-vegas.avif",
  Qatar: "images/qatar.avif",
  "Abu Dhabi": "images/abu-dhabi.avif",
};

function openF1Url(path, params = {}) {
  const url = new URL(`${OPENF1_BASE_URL}/${path}`);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

async function fetchOpenF1(path, params = {}, options = {}) {
  let lastError = null;
  const key = openF1CacheKey(path, params);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(openF1Url(path, params), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        const error = new Error(`OpenF1 request failed: ${response.status}`);
        error.status = response.status;

        if (response.status === 404 && options.allow404) {
          const local = openF1ReadLocalCache(key);

          if (local) {
            openF1MarkCached(local);
            return local.data;
          }

          return [];
        }

        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < 2
        ) {
          lastError = error;
          const retryAfter = Number(response.headers.get("Retry-After"));
          const wait =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(2000 * 2 ** attempt, 10000);

          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }

        lastError = error;
        break;
      }

      const data = await response.json();
      const fetchedAt = new Date().toISOString();

      openF1SaveLocalCache(key, data, fetchedAt);
      openF1SuccessfulRequest = true;

      if (!openF1CacheUsed) {
        openF1SetStatus(
          "operational",
          `OpenF1 responded successfully. Last successful request: ${openF1FormatTimestamp(fetchedAt)}.`,
        );
      }

      return data;
    } catch (error) {
      lastError = error;

      if (attempt < 2 && !error.status) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1)),
        );
        continue;
      }

      break;
    }
  }

  const cached = await openF1GetCachedData(path, params);

  if (cached) {
    openF1MarkCached(cached);
    return cached.data;
  }

  if (!openF1CacheUsed && !openF1SuccessfulRequest) {
    openF1RequestFailedWithoutCache = true;
    openF1SetStatus(
      "unavailable",
      "OpenF1 data could not be retrieved and no saved copy is available. This can happen during a live-session restriction. Please try again after the session ends.",
    );
  }

  throw new Error(
    `OpenF1 request failed and no cached copy is available for ${path}: ${lastError?.message || "network error"}`,
  );
}

const circuitImageAliases = {
  Melbourne: "Australia",
  "Albert Park": "Australia",
  Shanghai: "China",
  Suzuka: "Japan",
  Sakhir: "Bahrain",
  Jeddah: "Saudi Arabia",
  Miami: "Miami",
  Imola: "Emilia-Romagna",
  "Emilia-Romagna": "Emilia-Romagna",
  "Monte Carlo": "Monaco",
  Monaco: "Monaco",
  Madring: "Spain",
  Madrid: "Spain",
  Catalunya: "Barcelona-Catalunya",
  "Barcelona-Catalunya": "Barcelona-Catalunya",
  Montreal: "Canada",
  Spielberg: "Austria",
  Silverstone: "Great Britain",
  "Spa-Francorchamps": "Belgium",
  Budapest: "Hungary",
  Zandvoort: "Netherlands",
  Monza: "Italy",
  Baku: "Azerbaijan",
  Singapore: "Singapore",
  Austin: "United States",
  "Mexico City": "Mexico",
  "Sao Paulo": "Brazil",
  "São Paulo": "Brazil",
  "Las Vegas": "Las Vegas",
  Lusail: "Qatar",
  "Yas Marina": "Abu Dhabi",
};

function normalizeCircuitName(value = "") {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

const normalizedCircuitImageMap = new Map(
  Object.entries(localCircuitImages).map(([name, image]) => [
    normalizeCircuitName(name),
    image,
  ]),
);

const normalizedCircuitAliases = new Map(
  Object.entries(circuitImageAliases).map(([name, target]) => [
    normalizeCircuitName(name),
    target,
  ]),
);

function getLocalCircuitImage(
  shortName,
  location = "",
  meetingName = "",
  circuitKey = null,
) {
  if (circuitKey !== null && openF1CircuitImages[circuitKey]) {
    return openF1CircuitImages[circuitKey];
  }

  const candidates = [shortName, location, meetingName]
    .filter(Boolean)
    .flatMap((value) => [value, value.replace(/\bGrand Prix\b/gi, "").trim()]);

  for (const candidate of candidates) {
    const normalized = normalizeCircuitName(candidate);
    const direct = normalizedCircuitImageMap.get(normalized);

    if (direct) return direct;

    const alias = normalizedCircuitAliases.get(normalized);

    if (alias) {
      const aliased = normalizedCircuitImageMap.get(
        normalizeCircuitName(alias),
      );

      if (aliased) return aliased;
    }
  }

  return null;
}

function getDriverImage(driver) {
  const driverName = (driver.full_name || driver.driver || "")
    .trim()
    .toLowerCase();

  const local = Object.entries(driverImages).find(
    ([name]) => name.trim().toLowerCase() === driverName,
  )?.[1];

  return local || null;
}

function formatRaceDate(date) {
  if (!date) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
  }).format(new Date(date));
}

function formatWeekendDateRange(start, end) {
  if (!start && !end) return "—";

  const startDate = new Date(start || end);
  const endDate = new Date(end || start);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return "—";
  }

  const startParts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(startDate);
  const endParts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(endDate);

  const getPart = (parts, type) =>
    parts.find((part) => part.type === type)?.value || "";
  const startDay = getPart(startParts, "day");
  const startMonth = getPart(startParts, "month");
  const startYear = getPart(startParts, "year");
  const endDay = getPart(endParts, "day");
  const endMonth = getPart(endParts, "month");
  const endYear = getPart(endParts, "year");

  if (startYear !== endYear) {
    return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`;
  }

  if (startMonth === endMonth) {
    return `${startDay}–${endDay} ${endMonth}`;
  }

  return `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
}

function getSessionStatus(meeting, session) {
  if (meeting.is_cancelled) return "CANCELLED";

  const end = session?.date_end || meeting.date_end;
  const start = session?.date_start || meeting.date_start;
  const now = Date.now();

  if (end && new Date(end).getTime() < now) return "COMPLETED";
  if (start && new Date(start).getTime() <= now) return "LIVE";
  return "UPCOMING";
}

function getRaceStatus(meeting, raceSession) {
  return getSessionStatus(meeting, raceSession);
}

async function loadOpenF1Calendar() {
  const [
    meetings,
    raceSessions,
    qualifyingSessions,
    sprintSessions,
    sprintQualifyingSessions,
  ] = await Promise.all([
    fetchOpenF1("meetings", { year: 2026 }),
    fetchOpenF1("sessions", {
      year: 2026,
      session_name: "Race",
    }),
    fetchOpenF1("sessions", {
      year: 2026,
      session_name: "Qualifying",
    }),
    fetchOpenF1("sessions", {
      year: 2026,
      session_name: "Sprint",
    }),
    fetchOpenF1("sessions", {
      year: 2026,
      session_name: "Sprint Qualifying",
    }),
  ]);

  const sessionByMeeting = new Map(
    raceSessions
      .filter(
        (session) => session.session_name === "Race" && !session.is_cancelled,
      )
      .map((session) => [session.meeting_key, session]),
  );

  const qualifyingByMeeting = new Map(
    qualifyingSessions
      .filter(
        (session) =>
          session.session_name === "Qualifying" && !session.is_cancelled,
      )
      .map((session) => [session.meeting_key, session]),
  );

  const sprintByMeeting = new Map(
    sprintSessions
      .filter(
        (session) => session.session_name === "Sprint" && !session.is_cancelled,
      )
      .map((session) => [session.meeting_key, session]),
  );

  const sprintQualifyingByMeeting = new Map(
    sprintQualifyingSessions
      .filter(
        (session) =>
          session.session_name === "Sprint Qualifying" && !session.is_cancelled,
      )
      .map((session) => [session.meeting_key, session]),
  );

  return meetings
    .filter((meeting) => meeting.year === 2026)
    .filter((meeting) => !meeting.is_cancelled)
    .filter((meeting) => sessionByMeeting.has(meeting.meeting_key))
    .filter((meeting) => {
      const name =
        `${meeting.meeting_name || ""} ${meeting.location || ""} ${meeting.circuit_short_name || ""}`.toLowerCase();
      return !name.includes("saudi") && !name.includes("jeddah");
    })
    .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
    .slice(0, 23)
    .map((meeting, index) => {
      const raceSession = sessionByMeeting.get(meeting.meeting_key);
      const qualifyingSession = qualifyingByMeeting.get(meeting.meeting_key);
      const sprintSession = sprintByMeeting.get(meeting.meeting_key);
      const sprintQualifyingSession = sprintQualifyingByMeeting.get(
        meeting.meeting_key,
      );
      const raceDisplayNames = {
        Melbourne: "Australia",
        Shanghai: "China",
        Suzuka: "Japan",
        Montreal: "Canada",
        "Monte Carlo": "Monaco",
        Catalunya: "Barcelona",
        Spielberg: "Austria",
        Silverstone: "Great Britain",
        "Spa-Francorchamps": "Belgium",
        Hungaroring: "Hungary",
        Zandvoort: "Netherlands",
        Monza: "Italy",
        Madring: "Spain",
        Baku: "Azerbaijan",
        "Kuala Lumpur": "Bahrain",
        Singapore: "Singapore",
        Austin: "United States",
        "Mexico City": "Mexico",
        Interlagos: "Brazil",
        "Las Vegas": "Las Vegas",
        Lusail: "Qatar",
        "Yas Marina Circuit": "Abu Dhabi",
      };

      const shortName =
        raceDisplayNames[meeting.circuit_short_name] ||
        meeting.circuit_short_name ||
        meeting.location;

      return {
        meetingKey: meeting.meeting_key,
        sessionKey: raceSession?.session_key || null,
        qualifyingSessionKey: qualifyingSession?.session_key || null,
        qualifyingDateStart: qualifyingSession?.date_start || null,
        qualifyingDateEnd: qualifyingSession?.date_end || null,
        qualifyingStatus: qualifyingSession
          ? getSessionStatus(meeting, qualifyingSession)
          : null,
        sprintSessionKey: sprintSession?.session_key || null,
        sprintDateStart: sprintSession?.date_start || null,
        sprintDateEnd: sprintSession?.date_end || null,
        sprintQualifyingSessionKey:
          sprintQualifyingSession?.session_key || null,
        sprintQualifyingDateStart: sprintQualifyingSession?.date_start || null,
        sprintQualifyingDateEnd: sprintQualifyingSession?.date_end || null,
        sprintStatus: sprintSession
          ? getSessionStatus(meeting, sprintSession)
          : null,
        sprintQualifyingStatus: sprintQualifyingSession
          ? getSessionStatus(meeting, sprintQualifyingSession)
          : null,
        round: index + 1,
        name: meeting.meeting_name,
        shortName,
        date: formatRaceDate(raceSession?.date_start || meeting.date_start),
        weekendDate: formatWeekendDateRange(
          meeting.date_start,
          meeting.date_end,
        ),
        dateStart: raceSession?.date_start || meeting.date_start,
        dateEnd: raceSession?.date_end || meeting.date_end,
        weekendDateStart: meeting.date_start,
        weekendDateEnd: meeting.date_end,
        location: meeting.location,
        image: getLocalCircuitImage(
          shortName,
          meeting.location,
          meeting.meeting_name,
          meeting.circuit_key,
        ),
        status: getRaceStatus(meeting, raceSession),
        hasSprint: Boolean(sprintSession),
        podium: null,
        raceResults: null,
        qualifying: null,
        fastestLap: null,
        startingGrid: null,
        sprintPodium: null,
        sprintResults: null,
        sprintQualifying: null,
        sprintFastestLap: null,
        sprintStartingGrid: null,
      };
    });
}

async function loadRaceDetails(race) {
  if (!race.sessionKey || race.status !== "COMPLETED") {
    return race;
  }

  if (race.detailsLoading) {
    return race.detailsLoading;
  }

  race.detailsLoading = (async () => {
    let results = [];
    let drivers = [];
    let startingGrid = [];

    try {
      [results, startingGrid] = await Promise.all([
        fetchOpenF1("session_result", {
          session_key: race.sessionKey,
        }),
        loadStartingGrid(race),
      ]);
    } catch (error) {
      console.error("OpenF1 race result load failed:", error);
      race.detailsLoading = null;
      throw error;
    }

    try {
      drivers = await fetchOpenF1("drivers", {
        session_key: race.sessionKey,
      });
    } catch (error) {
      console.warn(
        "OpenF1 race driver list unavailable; using championship driver data:",
        error,
      );
      drivers = [];
    }

    const fallbackDriverMap = new Map(
      phase2State.drivers.map((driver) => [
        driver.number,
        {
          driver_number: driver.number,
          full_name: driver.name,
          team_name: driver.team,
        },
      ]),
    );

    const driverByNumber = new Map(
      drivers.map((driver) => [driver.driver_number, driver]),
    );

    fallbackDriverMap.forEach((driver, number) => {
      if (!driverByNumber.has(number)) {
        driverByNumber.set(number, driver);
      }
    });

    const mappedResults = results
      .filter((result) => Number.isFinite(Number(result.position)))
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((result) => {
        const driver = driverByNumber.get(result.driver_number) || {};
        const fullName = driver.full_name || `Driver #${result.driver_number}`;

        return {
          position: Number(result.position),
          number: result.driver_number,
          driver: fullName,
          team: driver.team_name || "—",
          class: getTeamClass(driver.team_name),
          color: driver.team_colour
            ? `#${String(driver.team_colour).replace(/^#/, "")}`
            : null,
          image: getDriverImage(driver),
          gap: formatRaceGap(result.gap_to_leader),
          laps: result.number_of_laps,
          dnf: result.dnf,
          dns: result.dns,
          dsq: result.dsq,
        };
      });

    race.raceResults = mappedResults;
    race.podium = mappedResults.filter(
      (driver) => driver.position >= 1 && driver.position <= 3,
    );
    race.startingGrid = Array.isArray(startingGrid)
      ? startingGrid
          .filter((item) => Number.isFinite(Number(item.position)))
          .sort((a, b) => Number(a.position) - Number(b.position))
      : [];

    if (race.qualifyingSessionKey) {
      try {
        const qualifyingResults = await fetchOpenF1("session_result", {
          session_key: race.qualifyingSessionKey,
        });

        let qualifyingDrivers = [];

        try {
          qualifyingDrivers = await fetchOpenF1("drivers", {
            session_key: race.qualifyingSessionKey,
          });
        } catch (error) {
          console.warn(
            "OpenF1 qualifying driver list unavailable; using race driver data:",
            error,
          );
        }

        const qualifyingDriverByNumber = new Map(
          qualifyingDrivers.map((driver) => [driver.driver_number, driver]),
        );

        driverByNumber.forEach((driver, number) => {
          if (!qualifyingDriverByNumber.has(number)) {
            qualifyingDriverByNumber.set(number, driver);
          }
        });

        race.qualifying = qualifyingResults
          .filter((result) => Number.isFinite(Number(result.position)))
          .sort((a, b) => Number(a.position) - Number(b.position))
          .map((result) => {
            const driver =
              qualifyingDriverByNumber.get(result.driver_number) || {};
            const duration = Array.isArray(result.duration)
              ? result.duration
              : [result.duration];
            const q1 = duration[0] ?? null;
            const q2 = duration[1] ?? null;
            const q3 = duration[2] ?? null;
            const finalTime = q3 ?? q2 ?? q1 ?? result.duration ?? null;

            return {
              position: Number(result.position),
              number: result.driver_number,
              driver: driver.full_name || `Driver #${result.driver_number}`,
              team: driver.team_name || "—",
              class: getTeamClass(driver.team_name),
              color: driver.team_colour
                ? `#${String(driver.team_colour).replace(/^#/, "")}`
                : null,
              image: getDriverImage(driver),
              time: formatQualifyingTime(finalTime),
              q1: formatQualifyingTime(q1),
              q2: formatQualifyingTime(q2),
              q3: formatQualifyingTime(q3),
            };
          });
      } catch (error) {
        console.warn("OpenF1 qualifying result load failed:", error);
        race.qualifying = null;
      }
    } else {
      race.qualifying = null;
    }

    try {
      const laps = await fetchOpenF1("laps", {
        session_key: race.sessionKey,
      });

      const completedLapCounts = results
        .map((result) => Number(result.number_of_laps))
        .filter(Number.isFinite);

      const lastRecordedLap = laps
        .map((lap) => Number(lap.lap_number))
        .filter(Number.isFinite);

      race.totalLaps = completedLapCounts.length
        ? Math.max(...completedLapCounts)
        : lastRecordedLap.length
          ? Math.max(...lastRecordedLap)
          : null;

      const validLaps = laps.filter(
        (lap) =>
          Number.isFinite(Number(lap.lap_duration)) &&
          Number(lap.lap_duration) > 0,
      );

      if (validLaps.length) {
        const fastest = validLaps.reduce(
          (best, lap) =>
            Number(lap.lap_duration) < Number(best.lap_duration) ? lap : best,
          validLaps[0],
        );

        const driver = driverByNumber.get(fastest.driver_number) || {};

        race.fastestLap = {
          driver: driver.full_name || `Driver #${fastest.driver_number}`,
          number: fastest.driver_number,
          team: driver.team_name || "—",
          lap: fastest.lap_number,
          time: formatLapTime(Number(fastest.lap_duration)),
          image: getDriverImage(driver),
        };
      }
    } catch (error) {
      console.warn(
        "OpenF1 lap data unavailable; keeping race result data:",
        error,
      );
      race.totalLaps = race.totalLaps || null;
      race.fastestLap = race.fastestLap || null;
    }

    race.detailsLoading = null;
    return race;
  })();

  return race.detailsLoading;
}

async function loadSprintDetails(race) {
  const sprintCompleted = race.sprintStatus === "COMPLETED";
  const sprintQualifyingCompleted = race.sprintQualifyingStatus === "COMPLETED";

  if (
    !race.hasSprint ||
    !race.sprintSessionKey ||
    (!sprintCompleted && !sprintQualifyingCompleted)
  ) {
    return race;
  }

  if (race.sprintDetailsLoading) {
    return race.sprintDetailsLoading;
  }

  race.sprintDetailsLoading = (async () => {
    let results = [];
    let drivers = [];
    let startingGrid = [];

    if (sprintCompleted) {
      try {
        [results, startingGrid] = await Promise.all([
          fetchOpenF1("session_result", {
            session_key: race.sprintSessionKey,
          }),
          loadSprintStartingGrid(race),
        ]);
      } catch (error) {
        console.error("OpenF1 sprint result load failed:", error);
        race.sprintDetailsLoading = null;
        throw error;
      }
    }

    if (sprintCompleted) {
      try {
        drivers = await fetchOpenF1("drivers", {
          session_key: race.sprintSessionKey,
        });
      } catch (error) {
        console.warn(
          "OpenF1 sprint driver list unavailable; using championship driver data:",
          error,
        );
        drivers = [];
      }
    }

    const fallbackDriverMap = new Map(
      phase2State.drivers.map((driver) => [
        driver.number,
        {
          driver_number: driver.number,
          full_name: driver.name,
          team_name: driver.team,
        },
      ]),
    );

    const driverByNumber = new Map(
      drivers.map((driver) => [driver.driver_number, driver]),
    );

    fallbackDriverMap.forEach((driver, number) => {
      if (!driverByNumber.has(number)) {
        driverByNumber.set(number, driver);
      }
    });

    const mappedResults = results
      .filter((result) => Number.isFinite(Number(result.position)))
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((result) => {
        const driver = driverByNumber.get(result.driver_number) || {};
        return {
          position: Number(result.position),
          number: result.driver_number,
          driver: driver.full_name || `Driver #${result.driver_number}`,
          team: driver.team_name || "—",
          class: getTeamClass(driver.team_name),
          color: driver.team_colour
            ? `#${String(driver.team_colour).replace(/^#/, "")}`
            : null,
          image: getDriverImage(driver),
          gap: formatRaceGap(result.gap_to_leader),
          laps: result.number_of_laps,
          dnf: result.dnf,
          dns: result.dns,
          dsq: result.dsq,
        };
      });

    if (sprintCompleted) {
      race.sprintResults = mappedResults;
      race.sprintPodium = mappedResults.filter(
        (driver) => driver.position >= 1 && driver.position <= 3,
      );
      race.sprintStartingGrid = Array.isArray(startingGrid)
        ? startingGrid
            .filter((item) => Number.isFinite(Number(item.position)))
            .sort((a, b) => Number(a.position) - Number(b.position))
        : [];
    }

    if (race.sprintQualifyingSessionKey) {
      try {
        const sprintQualifyingResults = await fetchOpenF1("session_result", {
          session_key: race.sprintQualifyingSessionKey,
        });

        let sprintQualifyingDrivers = [];

        try {
          sprintQualifyingDrivers = await fetchOpenF1("drivers", {
            session_key: race.sprintQualifyingSessionKey,
          });
        } catch (error) {
          console.warn(
            "OpenF1 sprint qualifying driver list unavailable; using sprint driver data:",
            error,
          );
        }

        const sprintQualifyingDriverByNumber = new Map(
          sprintQualifyingDrivers.map((driver) => [
            driver.driver_number,
            driver,
          ]),
        );

        driverByNumber.forEach((driver, number) => {
          if (!sprintQualifyingDriverByNumber.has(number)) {
            sprintQualifyingDriverByNumber.set(number, driver);
          }
        });

        race.sprintQualifying = sprintQualifyingResults
          .filter((result) => Number.isFinite(Number(result.position)))
          .sort((a, b) => Number(a.position) - Number(b.position))
          .map((result) => {
            const driver =
              sprintQualifyingDriverByNumber.get(result.driver_number) || {};
            const duration = Array.isArray(result.duration)
              ? result.duration
              : [result.duration];
            const q1 = duration[0] ?? null;
            const q2 = duration[1] ?? null;
            const q3 = duration[2] ?? null;
            const finalTime = q3 ?? q2 ?? q1 ?? result.duration ?? null;

            return {
              position: Number(result.position),
              number: result.driver_number,
              driver: driver.full_name || `Driver #${result.driver_number}`,
              team: driver.team_name || "—",
              class: getTeamClass(driver.team_name),
              color: driver.team_colour
                ? `#${String(driver.team_colour).replace(/^#/, "")}`
                : null,
              image: getDriverImage(driver),
              time: formatQualifyingTime(finalTime),
              q1: formatQualifyingTime(q1),
              q2: formatQualifyingTime(q2),
              q3: formatQualifyingTime(q3),
            };
          });
      } catch (error) {
        console.warn("OpenF1 sprint qualifying result load failed:", error);
        race.sprintQualifying = null;
      }
    } else {
      race.sprintQualifying = null;
    }

    if (sprintCompleted) {
      try {
        const laps = await fetchOpenF1("laps", {
          session_key: race.sprintSessionKey,
        });

        const completedLapCounts = results
          .map((result) => Number(result.number_of_laps))
          .filter(Number.isFinite);

        const lastRecordedLap = laps
          .map((lap) => Number(lap.lap_number))
          .filter(Number.isFinite);

        race.sprintTotalLaps = completedLapCounts.length
          ? Math.max(...completedLapCounts)
          : lastRecordedLap.length
            ? Math.max(...lastRecordedLap)
            : null;

        const validLaps = laps.filter(
          (lap) =>
            Number.isFinite(Number(lap.lap_duration)) &&
            Number(lap.lap_duration) > 0,
        );

        if (validLaps.length) {
          const fastest = validLaps.reduce(
            (best, lap) =>
              Number(lap.lap_duration) < Number(best.lap_duration) ? lap : best,
            validLaps[0],
          );

          const driver = driverByNumber.get(fastest.driver_number) || {};

          race.sprintFastestLap = {
            driver: driver.full_name || `Driver #${fastest.driver_number}`,
            number: fastest.driver_number,
            team: driver.team_name || "—",
            lap: fastest.lap_number,
            time: formatLapTime(Number(fastest.lap_duration)),
            image: getDriverImage(driver),
          };
        }
      } catch (error) {
        console.warn(
          "OpenF1 sprint lap data unavailable; keeping sprint result data:",
          error,
        );
        race.sprintTotalLaps = race.sprintTotalLaps || null;
        race.sprintFastestLap = race.sprintFastestLap || null;
      }
    }

    race.sprintDetailsLoading = null;
    return race;
  })();

  return race.sprintDetailsLoading;
}

async function loadSprintStartingGrid(race) {
  if (!race.sprintSessionKey) return [];

  try {
    const data = await fetchOpenF1(
      "starting_grid",
      { session_key: race.sprintSessionKey },
      { allow404: true },
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn(
      "Sprint starting grid unavailable; keeping Sprint results:",
      error,
    );
    return [];
  }
}

function formatRaceGap(value) {
  if (value === null || value === undefined || value === "") return null;

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    const text = String(value).trim();
    if (!text) return null;
    return text.startsWith("+") ? text : `+${text}`;
  }

  if (numeric === 0) return "0.000";

  return `+${numeric.toFixed(3)}`;
}

function formatQualifyingTime(value) {
  if (value === null || value === undefined || value === "") return null;

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return String(value);

  const minutes = Math.floor(numeric / 60);
  const seconds = (numeric - minutes * 60).toFixed(3).padStart(6, "0");

  return `${minutes}:${seconds}`;
}

function formatLapTime(seconds) {
  if (!Number.isFinite(seconds)) return "—";

  const minutes = Math.floor(seconds / 60);
  const remaining = (seconds - minutes * 60).toFixed(3).padStart(6, "0");

  return `${minutes}:${remaining}`;
}

function getTeamClass(teamName = "") {
  const team = teamName.toLowerCase();

  if (team.includes("mercedes")) return "mercedes";
  if (team.includes("ferrari")) return "ferrari";
  if (team.includes("red bull")) return "redbull";
  if (team.includes("mclaren")) return "mclaren";
  if (team.includes("aston martin")) return "astonmartin";
  if (team.includes("alpine")) return "alpine";
  if (team.includes("williams")) return "williams";
  if (team.includes("racing bulls") || team.includes("rb f1"))
    return "racingbulls";
  if (team.includes("haas")) return "haas";
  if (team.includes("audi")) return "audi";
  if (team.includes("cadillac")) return "cadillac";
  return "";
}

async function initializeOpenF1() {
  loaderStatus.textContent = "CONNECTING TO OPENF1";

  try {
    const liveRaces = await loadOpenF1Calendar();

    if (!liveRaces.length) {
      throw new Error("No 2026 meetings returned");
    }

    races = liveRaces;
    const navigationControls = document.querySelector(".navigation-controls");
    if (navigationControls) navigationControls.hidden = false;
    if (emptyState) emptyState.hidden = false;
    loaderStatus.textContent = "BUILDING 2026 CALENDAR";
    raceTrack.innerHTML = "";
    buildRaceSelector();

    loaderProgressBar.style.width = "70%";
    loaderPercentage.textContent = "70%";
    loaderStatus.textContent = "RACE DATA READY";

    await new Promise((resolve) => setTimeout(resolve, 180));

    loaderProgressBar.style.width = "100%";
    loaderPercentage.textContent = "100%";

    return true;
  } catch (error) {
    console.error("OpenF1 initialization failed:", error);
    loaderProgressBar.style.width = "100%";
    loaderPercentage.textContent = "100%";
    loaderStatus.textContent = "OFFLINE DATA READY";
    raceTrack.innerHTML = "";
    buildRaceSelector();
    if (!races.length) {
      const navigationControls = document.querySelector(".navigation-controls");
      if (navigationControls) navigationControls.hidden = true;
      if (emptyState) emptyState.hidden = true;
      raceTrack.innerHTML = `
        <div class="calendar-api-unavailable">
          <span class="dashboard-empty-kicker">RACE DATA OFFLINE</span>
          <h2>Race calendar temporarily unavailable</h2>
          <p>We could not retrieve the 2026 race calendar, and no saved calendar is available on this visit. OpenF1 public access may be restricted during a live session. Please try again after the session ends.</p>
          <button class="dashboard-empty-retry" type="button" onclick="window.location.reload()">TRY AGAIN</button>
        </div>`;
    }
    return false;
  }
}

/* =====================================================
   DOM ELEMENTS
===================================================== */

const raceTrack = document.getElementById("raceTrack");

const scrollLeftButton = document.getElementById("scrollLeft");

const scrollRightButton = document.getElementById("scrollRight");

const emptyState = document.getElementById("emptyState");

const raceView = document.getElementById("raceView");

const trackName = document.getElementById("trackName");

const trackLocation = document.getElementById("trackLocation");

const trackImage = document.getElementById("trackImage");

const trackShortName = document.getElementById("trackShortName");

const roundNumber = document.getElementById("roundNumber");

const raceDate = document.getElementById("raceDate");

const raceStatus = document.getElementById("raceStatus");

const raceStatusLabel = document.getElementById("raceStatusLabel");

const podium = document.getElementById("podium");

const fastestLapCard = document.getElementById("fastestLapCard");
const sessionSelector = document.getElementById("sessionSelector");
const raceSessionButton = document.getElementById("raceSessionButton");
const sprintSessionButton = document.getElementById("sprintSessionButton");
const raceClassificationTitle = document.getElementById(
  "raceClassificationTitle",
);
const qualifyingTitle = document.getElementById("qualifyingTitle");

/* =====================================================
   DRIVER IMAGES
===================================================== */

const driverImages = {
  "George Russell": "images/drivers/george-russell.png",

  "Kimi Antonelli": "images/drivers/kimi-antonelli.png",

  "Charles Leclerc": "images/drivers/charles-leclerc.png",

  "Lewis Hamilton": "images/drivers/lewis-hamilton.png",

  "Max Verstappen": "images/drivers/max-verstappen.png",

  "Lando Norris": "images/drivers/lando-norris.png",

  "Oscar Piastri": "images/drivers/oscar-piastri.png",

  "Isack Hadjar": "images/drivers/isack-hadjar.png",

  "Pierre Gasly": "images/drivers/pierre-gasly.png",
};

/* =====================================================
   INITIAL IMAGE PRELOADER
===================================================== */

const pageLoader = document.getElementById("pageLoader");
const loaderProgressBar = document.getElementById("loaderProgressBar");
const loaderPercentage = document.getElementById("loaderPercentage");
const loaderStatus = document.getElementById("loaderStatus");

/*
   Preload the assets needed for the first useful interaction.
   Completed-race circuits and all driver images are ready before
   the dashboard is revealed. Future-race circuits load when selected.
*/
const initialImages = [
  ...races
    .filter((race) => race.status === "COMPLETED")
    .map((race) => race.image),
  ...Object.values(driverImages),
];

const uniqueInitialImages = [...new Set(initialImages)];

function preloadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    image.onload = finish;
    image.onerror = finish;
    image.src = src;

    if (image.decode) {
      image
        .decode()
        .then(finish)
        .catch(() => {});
    }
  });
}

async function preloadInitialImages() {
  const total = uniqueInitialImages.length;

  if (!total) {
    pageLoader.classList.add("hidden");
    return;
  }

  let loaded = 0;

  const updateProgress = () => {
    loaded++;
    const percentage = Math.round((loaded / total) * 40);
    loaderProgressBar.style.width = `${percentage}%`;
    loaderPercentage.textContent = `${percentage}%`;
  };

  await Promise.all(
    uniqueInitialImages.map((src) => preloadImage(src).then(updateProgress)),
  );
}

/* =====================================================
   BUILD CALENDAR
===================================================== */

function buildRaceSelector() {
  races.forEach((race, index) => {
    const button = document.createElement("button");

    button.type = "button";

    button.className = "race-button";

    button.classList.add(race.status.toLowerCase());

    button.dataset.index = index;

    button.innerHTML = `

                <span class="race-number">
                    ${String(race.round).padStart(2, "0")}
                </span>

                <span class="race-name">
                    ${race.shortName}
                </span>

                <span class="race-state"></span>

            `;

    button.addEventListener("click", () => selectRace(index));

    raceTrack.appendChild(button);
  });
}

/* =====================================================
   SELECT RACE
===================================================== */

async function selectRace(index) {
  const race = races[index];

  if (!race) {
    return;
  }

  /* ---------------------------------------------
       Active race
    --------------------------------------------- */

  document.querySelectorAll(".race-button").forEach((button) => {
    button.classList.remove("active");
  });

  const selectedButton = document.querySelector(
    `.race-button[data-index="${index}"]`,
  );

  if (selectedButton) {
    selectedButton.classList.add("active");

    const centerSelectedButton = () => {
      const left = selectedButton.offsetLeft;
      const target =
        left - (raceTrack.clientWidth - selectedButton.offsetWidth) / 2;

      raceTrack.scrollTo({
        left: Math.max(
          0,
          Math.min(target, raceTrack.scrollWidth - raceTrack.clientWidth),
        ),
        behavior: "smooth",
      });
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(centerSelectedButton);
    });
  }

  /* ---------------------------------------------
       Remove initial screen
    --------------------------------------------- */

  emptyState.hidden = true;

  raceView.hidden = false;

  /* ---------------------------------------------
       Hero
    --------------------------------------------- */

  trackName.textContent = race.name;

  trackLocation.textContent = race.location;

  trackShortName.textContent = race.shortName.toUpperCase();

  roundNumber.textContent = race.round;

  raceDate.textContent = race.weekendDate;

  raceStatus.textContent = race.status;

  raceStatusLabel.textContent = race.status;

  raceStatus.classList.toggle(
    "upcoming-status",

    race.status === "UPCOMING",
  );

  /* ---------------------------------------------
       Track image
    --------------------------------------------- */

  trackImage.style.opacity = "0";

  trackImage.onload = () => {
    trackImage.style.opacity = "1";
  };

  trackImage.src = race.image;

  trackImage.alt = `${race.name} circuit`;

  /* ---------------------------------------------
       Session selector
    --------------------------------------------- */

  activeRaceSession = "race";
  updateSessionSelector(race);

  /* ---------------------------------------------
       Render immediately, then hydrate from OpenF1
    --------------------------------------------- */

  await selectRaceSession(race, "race");

  /* ---------------------------------------------
       Return to selected race
       when necessary
    --------------------------------------------- */

  if (
    window.scrollY >
    document.querySelector(".race-navigation").offsetHeight + 100
  ) {
    raceView.scrollIntoView({
      behavior: "smooth",

      block: "start",
    });
  }
}

/* =====================================================
   RACE / SPRINT SESSION SELECTOR
===================================================== */

function updateSessionSelector(race) {
  const hasSprint = Boolean(race?.hasSprint);

  if (sessionSelector) {
    sessionSelector.hidden = !hasSprint;
  }

  if (raceSessionButton) {
    raceSessionButton.classList.toggle("active", activeRaceSession === "race");
  }

  if (sprintSessionButton) {
    sprintSessionButton.classList.toggle(
      "active",
      activeRaceSession === "sprint",
    );
  }
}

async function selectRaceSession(race, sessionType) {
  if (!race) return;

  if (sessionType === "sprint" && !race.hasSprint) {
    activeRaceSession = "race";
    updateSessionSelector(race);
    return;
  }

  activeRaceSession = sessionType;
  updateSessionSelector(race);

  raceStatusLabel.textContent = race.status;
  raceStatus.textContent = race.status;
  raceStatus.classList.toggle("upcoming-status", race.status === "UPCOMING");

  const isSprint = sessionType === "sprint";

  if (raceClassificationTitle) {
    raceClassificationTitle.textContent = isSprint
      ? "Sprint Result"
      : "Race Result";
  }

  if (qualifyingTitle) {
    qualifyingTitle.textContent = isSprint
      ? "Sprint Qualifying Results"
      : "Qualifying Results";
  }

  renderPodium(race, sessionType);
  renderRaceClassification(race, sessionType);
  renderQualifying(race, sessionType);
  renderFastestLap(race, sessionType);

  if (isSprint) {
    const gridFinishSection = document.getElementById("gridFinishSection");
    if (gridFinishSection) gridFinishSection.hidden = true;

    if (
      race.sprintSessionKey &&
      (race.sprintStatus === "COMPLETED" ||
        race.sprintQualifyingStatus === "COMPLETED") &&
      !race.sprintResults &&
      !race.sprintQualifying
    ) {
      try {
        await loadSprintDetails(race);
      } catch (error) {
        console.error("OpenF1 sprint detail load failed:", error);
      }
    }

    if (activeRaceSession !== "sprint") return;

    renderPodium(race, "sprint");
    renderRaceClassification(race, "sprint");
    renderQualifying(race, "sprint");
    renderFastestLap(race, "sprint");
    return;
  }

  renderStartingGridFinish(race);

  if (race.status === "COMPLETED" && race.sessionKey && !race.podium) {
    raceStatusLabel.textContent = "LOADING RESULT";
    raceStatus.textContent = "SYNCING";

    try {
      await loadRaceDetails(race);
      if (activeRaceSession !== "race") return;
      renderPodium(race, "race");
      renderRaceClassification(race, "race");
      renderQualifying(race, "race");
      renderFastestLap(race, "race");
      renderStartingGridFinish(race);
      raceStatusLabel.textContent = race.status;
      raceStatus.textContent = race.status;
    } catch (error) {
      console.error("OpenF1 race detail load failed:", error);
      raceStatusLabel.textContent = race.status;
      raceStatus.textContent = "OFFLINE";
    }
  }
}

raceSessionButton?.addEventListener("click", () => {
  const activeButton = document.querySelector(".race-button.active");
  const raceIndex = activeButton ? Number(activeButton.dataset.index) : -1;
  const race = Number.isInteger(raceIndex) ? races[raceIndex] : null;
  if (race) selectRaceSession(race, "race");
});

sprintSessionButton?.addEventListener("click", () => {
  const activeButton = document.querySelector(".race-button.active");
  const raceIndex = activeButton ? Number(activeButton.dataset.index) : -1;
  const race = Number.isInteger(raceIndex) ? races[raceIndex] : null;
  if (race) selectRaceSession(race, "sprint");
});

/* =====================================================
   RENDER PODIUM
===================================================== */

function renderPodium(race, sessionType = "race") {
  const podiumData = sessionType === "sprint" ? race.sprintPodium : race.podium;

  /* ---------------------------------------------
       Future race
    --------------------------------------------- */

  if (!podiumData) {
    podium.innerHTML = `

            ${createEmptyPodiumCard(2, "second")}

            ${createEmptyPodiumCard(1, "first")}

            ${createEmptyPodiumCard(3, "third")}

        `;

    return;
  }

  /* ---------------------------------------------
       Completed race
    --------------------------------------------- */

  const first = podiumData.find((driver) => driver.position === 1);

  const second = podiumData.find((driver) => driver.position === 2);

  const third = podiumData.find((driver) => driver.position === 3);

  /*
       Visual order:

       2nd
       1st
       3rd
    */

  podium.innerHTML = `

        ${createPodiumCard(second)}

        ${createPodiumCard(first)}

        ${createPodiumCard(third)}

    `;
}

/* =====================================================
   CREATE PODIUM CARD
===================================================== */

function createPodiumCard(driver) {
  const driverImage = driver.image || driverImages[driver.driver];

  return `

        <div
            class="
                podium-card
                ${driver.position === 1 ? "first" : ""}
            "
            data-position="${driver.position}"
        >


            ${
              driverImage
                ? `
                        <img
                            class="driver-image"
                            src="${driverImage}"
                            alt="${driver.driver}"
                            loading="lazy"
                            draggable="false"
                        >

                        <div
                            class="driver-image-fade"
                        ></div>
                    `
                : ""
            }


            <div class="position">
                ${driver.position}
            </div>


            <div class="driver-info">

                <span class="driver-number">
                    #${driver.number}
                </span>


                <h3>
                    ${driver.driver}
                </h3>


                <p>
                    ${driver.team}
                </p>

            </div>


            <div class="
                team-color
                ${driver.class}
            "></div>


        </div>

    `;
}

/* =====================================================
   EMPTY PODIUM CARD
===================================================== */

function createEmptyPodiumCard(position, extraClass) {
  return `

        <div class="
            podium-card
            ${extraClass}
            upcoming-card
        ">


            <div class="position">
                ${position}
            </div>


            <div class="driver-info">

                <span class="driver-number">
                    —
                </span>


                <h3
                    class="upcoming-driver"
                >
                    —
                </h3>


                <p>
                    —
                </p>

            </div>


            <div class="team-color"></div>


        </div>

    `;
}

/* =====================================================
   RACE CLASSIFICATION
===================================================== */

function renderRaceClassification(race, sessionType = "race") {
  const section = document.getElementById("raceClassificationSection");
  const visible = document.getElementById("raceClassificationVisible");
  const remaining = document.getElementById("raceClassificationRemaining");
  const button = document.getElementById("raceClassificationMore");

  if (!section || !visible || !remaining || !button) return;

  const resultsData =
    sessionType === "sprint" ? race.sprintResults : race.raceResults;

  section.hidden = false;
  remaining.hidden = true;
  button.textContent = "VIEW MORE";

  if (!resultsData?.length) {
    visible.innerHTML = createClassificationPlaceholder();
    remaining.innerHTML = "";
    button.hidden = true;
    return;
  }

  const results = resultsData.slice().sort((a, b) => a.position - b.position);
  const firstVisible = results.filter(
    (result) => result.position >= 4 && result.position <= 6,
  );
  const rest = results.filter((result) => result.position >= 7);

  visible.innerHTML = firstVisible.map(createClassificationRow).join("");
  remaining.innerHTML = rest.map(createClassificationRow).join("");
  button.hidden = rest.length === 0;

  button.onclick = () => {
    const opening = remaining.hidden;
    remaining.hidden = !opening;
    button.textContent = opening ? "VIEW LESS" : "VIEW MORE";
  };
}

function createClassificationCard(driver) {
  return `
        <article class="classification-card team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
            <div class="classification-position">${String(driver.position).padStart(2, "0")}</div>
            <div class="classification-driver">
                <span>#${driver.number}</span>
                <strong>${driver.driver}</strong>
                <small>${driver.team}</small>
            </div>
            <div class="classification-status">${driver.dsq ? "DSQ" : driver.dnf ? "DNF" : driver.dns ? "DNS" : driver.gap ? driver.gap : "FINISHED"}</div>
        </article>
    `;
}

function createClassificationRow(driver) {
  return `
        <div class="classification-row team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
            <span class="classification-row-position">${String(driver.position).padStart(2, "0")}</span>
            <div>
                <strong>${driver.driver}</strong>
                <span>${driver.team}</span>
            </div>
            <span>${driver.dsq ? "DSQ" : driver.dnf ? "DNF" : driver.dns ? "DNS" : driver.gap || "—"}</span>
        </div>
    `;
}

function createClassificationPlaceholder() {
  return [4, 5, 6]
    .map(
      (position) => `
        <div class="classification-row upcoming-classification">
            <span class="classification-row-position">${String(position).padStart(2, "0")}</span>
            <div>
                <strong>—</strong>
                <span>—</span>
            </div>
            <span>—</span>
        </div>
    `,
    )
    .join("");
}

/* =====================================================
   QUALIFYING
===================================================== */

function renderQualifying(race, sessionType = "race") {
  const section = document.getElementById("qualifyingSection");
  const pole = document.getElementById("polePositionCard");
  const visible = document.getElementById("qualifyingVisible");
  const remaining = document.getElementById("qualifyingRemaining");
  const button = document.getElementById("qualifyingMore");

  if (!section || !pole || !visible || !remaining || !button) return;

  const qualifyingData =
    sessionType === "sprint" ? race.sprintQualifying : race.qualifying;

  section.hidden = false;
  remaining.hidden = true;
  button.textContent = "VIEW MORE";

  if (!qualifyingData?.length) {
    pole.innerHTML = createPolePlaceholder(sessionType);
    visible.innerHTML = [2, 3]
      .map((position) => createQualifyingCard(null, position))
      .join("");
    remaining.innerHTML = "";
    button.hidden = true;
    return;
  }

  const results = qualifyingData;
  const first = results[0];
  const nextTwo = results.slice(1, 3);
  const rest = results.slice(3);

  pole.innerHTML = createPoleCard(first, sessionType);
  visible.innerHTML = nextTwo
    .map((driver) => createQualifyingCard(driver))
    .join("");
  remaining.innerHTML = rest.map(createQualifyingRow).join("");
  button.hidden = rest.length === 0;

  button.onclick = () => {
    const opening = remaining.hidden;
    remaining.hidden = !opening;
    button.textContent = opening ? "VIEW LESS" : "VIEW MORE";
  };
}

function createPoleCard(driver, sessionType = "race") {
  const image = driver.image;
  const label =
    sessionType === "sprint" ? "SPRINT QUALIFYING · P1" : "POLE POSITION · P1";
  return `
        <article class="pole-position-card team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
            ${image ? `<img src="${image}" alt="${driver.driver}" draggable="false">` : ""}
            <div class="pole-position-fade"></div>
            <div class="pole-position-content">
                <span class="pole-position-label">${label}</span>
                <h3>${driver.driver}</h3>
                <p>${driver.team} · #${driver.number}</p>
            </div>
            <div class="pole-position-time-box"><div class="pole-position-time">${driver.time}</div></div>
        </article>
    `;
}

function createPolePlaceholder(sessionType = "race") {
  const label =
    sessionType === "sprint" ? "SPRINT QUALIFYING · P1" : "POLE POSITION · P1";
  return `
        <article class="pole-position-card upcoming-qualifying">
            <div class="pole-position-content">
                <span class="pole-position-label">${label}</span>
                <h3>—</h3>
                <p>—</p>
            </div>
            <div class="pole-position-time-box"><div class="pole-position-time">—</div></div>
        </article>
    `;
}

function createQualifyingCard(driver, position = null) {
  if (!driver) {
    return `
            <article class="qualifying-card upcoming-qualifying">
                <span class="qualifying-position">${String(position).padStart(2, "0")}</span>
                <div><strong>—</strong><small>—</small></div>
                <b>—</b>
            </article>
        `;
  }

  return `
        <article class="qualifying-card team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
            <span class="qualifying-position">${String(driver.position).padStart(2, "0")}</span>
            <div><strong>${driver.driver}</strong><small>${driver.team}</small></div>
            <b>${driver.time}</b>
        </article>
    `;
}

function createQualifyingRow(driver) {
  return `
        <div class="qualifying-row team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
            <span>${String(driver.position).padStart(2, "0")}</span>
            <div>
                <strong>${driver.driver}</strong>
                <small>${driver.team}</small>
            </div>
            <span>${driver.time || "—"}</span>
        </div>
    `;
}

/* =====================================================
   STARTING GRID VS FINISH
===================================================== */

async function loadStartingGrid(race) {
  const attempts = [
    { meeting_key: race.meetingKey },
    { session_key: race.sessionKey },
  ];

  for (const params of attempts) {
    try {
      const data = await fetchOpenF1("starting_grid", params);
      if (Array.isArray(data) && data.length) {
        return data;
      }
    } catch (error) {
      console.warn("OpenF1 starting grid request failed:", params, error);
    }
  }

  console.warn(
    "OpenF1 starting grid returned no rows for race:",
    race.name,
    race.sessionKey,
    race.meetingKey,
  );
  return [];
}

function renderStartingGridFinish(race) {
  const section = document.getElementById("gridFinishSection");
  const visible = document.getElementById("gridFinishVisible");
  const remaining = document.getElementById("gridFinishRemaining");
  const button = document.getElementById("gridFinishMore");
  const summary = document.getElementById("gridFinishSummary");

  if (!section || !visible || !remaining || !button || !summary) return;

  section.hidden = race.status !== "COMPLETED";
  remaining.hidden = true;
  button.textContent = "VIEW MORE";
  button.hidden = true;
  summary.innerHTML = "";

  if (
    race.status !== "COMPLETED" ||
    !race.startingGrid?.length ||
    !race.raceResults?.length
  ) {
    visible.innerHTML = "";
    remaining.innerHTML = "";
    return;
  }

  const resultByDriver = new Map(
    race.raceResults.map((result) => [Number(result.number), result]),
  );

  const rows = race.startingGrid
    .map((grid) => {
      const driver = resultByDriver.get(Number(grid.driver_number));
      if (!driver) return null;

      const start = Number(grid.position);
      const finish = Number(driver.position);
      const classified =
        !driver.dnf &&
        !driver.dns &&
        !driver.dsq &&
        Number.isInteger(finish) &&
        finish >= 1 &&
        finish <= 22;
      const change = classified ? start - finish : null;

      return {
        driver,
        start,
        finish: classified ? finish : null,
        change,
        status: driver.dsq
          ? "DSQ"
          : driver.dns
            ? "DNS"
            : driver.dnf
              ? "DNF"
              : "FINISHED",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  const firstVisible = rows.slice(0, 5);
  const rest = rows.slice(5);

  visible.innerHTML = firstVisible.map(createGridFinishRow).join("");
  remaining.innerHTML = rest.map(createGridFinishRow).join("");
  button.hidden = rest.length === 0;

  button.onclick = () => {
    const opening = remaining.hidden;
    remaining.hidden = !opening;
    button.textContent = opening ? "VIEW LESS" : "VIEW MORE";
  };

  const validMoves = rows.filter((row) => Number.isFinite(row.change));
  const biggestGain = validMoves.length
    ? validMoves.reduce(
        (best, row) => (row.change > best.change ? row : best),
        validMoves[0],
      )
    : null;
  const biggestLoss = validMoves.length
    ? validMoves.reduce(
        (worst, row) => (row.change < worst.change ? row : worst),
        validMoves[0],
      )
    : null;

  summary.innerHTML = `
        <div class="grid-finish-highlight">
            <span>BIGGEST GAIN</span>
            <strong>${biggestGain ? `+${biggestGain.change} · ${phase2Escape(biggestGain.driver.driver)}` : "—"}</strong>
            <small>${biggestGain ? `P${biggestGain.start} → P${biggestGain.finish}` : "No classified movement"}</small>
        </div>
        <div class="grid-finish-highlight loss">
            <span>BIGGEST LOSS</span>
            <strong>${biggestLoss ? `${biggestLoss.change} · ${phase2Escape(biggestLoss.driver.driver)}` : "—"}</strong>
            <small>${biggestLoss ? `P${biggestLoss.start} → P${biggestLoss.finish}` : "No classified movement"}</small>
        </div>
    `;
}

function createGridFinishRow(row) {
  const move = Number.isFinite(row.change)
    ? row.change > 0
      ? `<span class="grid-move gain">+${row.change}</span>`
      : row.change < 0
        ? `<span class="grid-move loss">${row.change}</span>`
        : `<span class="grid-move neutral">—</span>`
    : `<span class="grid-move status">${row.status}</span>`;

  return `
        <div class="grid-finish-row team-${row.driver.class}" style="--team-color:${row.driver.color || "#333333"}">
            <span class="grid-finish-position">${String(row.start).padStart(2, "0")}</span>
            <div class="grid-finish-driver">
                <strong>${phase2Escape(row.driver.driver)}</strong>
                <span>${phase2Escape(row.driver.team)}</span>
            </div>
            <span class="grid-finish-arrow">→</span>
            <span class="grid-finish-position finish">${row.finish ? String(row.finish).padStart(2, "0") : "—"}</span>
            ${move}
        </div>
    `;
}

/* =====================================================
   FASTEST LAP
===================================================== */

function renderFastestLap(race, sessionType = "race") {
  const fastestLap =
    sessionType === "sprint" ? race.sprintFastestLap : race.fastestLap;
  const totalLaps =
    sessionType === "sprint" ? race.sprintTotalLaps : race.totalLaps;

  /* ---------------------------------------------
       Future race
    --------------------------------------------- */

  if (!fastestLap) {
    fastestLapCard.classList.add("empty");

    fastestLapCard.innerHTML = `

            <div class="fastest-lap-main">

                <span class="fastest-lap-label">
                    FASTEST LAP
                </span>

                <div class="fastest-lap-time">
                    —
                </div>

                <div class="fastest-lap-driver">
                    —
                </div>

                <div class="fastest-lap-team">
                    —
                </div>

            </div>


            <div class="fastest-lap-visual">

                <div class="fastest-lap-visual-placeholder">
                    —
                </div>

                <div class="fastest-lap-stats">

                    <div>
                        <span>LAP</span>
                        <strong>—</strong>
                    </div>

                    <div>
                        <span>TOTAL LAPS</span>
                        <strong>—</strong>
                    </div>

                </div>

            </div>

        `;

    return;
  }

  /* ---------------------------------------------
       Completed race
    --------------------------------------------- */

  fastestLapCard.classList.remove("empty");

  const lap = fastestLap;

  const driverImage = lap.image;

  fastestLapCard.innerHTML = `

        <div class="fastest-lap-main">

            <span class="fastest-lap-label">
                FASTEST LAP
            </span>

            <div class="fastest-lap-time">
                ${lap.time}
            </div>

            <div class="fastest-lap-driver">
                ${lap.driver}
            </div>

            <div class="fastest-lap-team">
                ${lap.team}
            </div>

        </div>


        <div class="fastest-lap-visual">

            ${
              driverImage
                ? `
                <img
                    class="fastest-lap-driver-image"
                    src="${driverImage}"
                    alt="${lap.driver}"
                    loading="lazy"
                    draggable="false"
                >
                <div class="fastest-lap-image-fade"></div>
            `
                : ""
            }


            <div class="fastest-lap-stats">

                <div>
                    <span>LAP</span>
                    <strong>${lap.lap}</strong>
                </div>

                <div>
                    <span>TOTAL LAPS</span>
                    <strong>${totalLaps ?? "—"}</strong>
                </div>

            </div>

        </div>

    `;
}

/* =====================================================
   CALENDAR ARROWS
===================================================== */

scrollLeftButton.addEventListener("click", () => {
  raceTrack.scrollBy({
    left: -500,

    behavior: "smooth",
  });
});

scrollRightButton.addEventListener("click", () => {
  raceTrack.scrollBy({
    left: 500,

    behavior: "smooth",
  });
});

/* =====================================================
   MOUSE WHEEL CALENDAR SCROLL
===================================================== */

raceTrack.addEventListener(
  "wheel",

  (event) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();

      raceTrack.scrollLeft += event.deltaY;
    }
  },

  {
    passive: false,
  },
);

/* =====================================================
   DRAG CALENDAR
===================================================== */

let isDragging = false;

let startX = 0;

let startingScrollLeft = 0;

raceTrack.addEventListener(
  "mousedown",

  (event) => {
    isDragging = true;

    raceTrack.classList.add("dragging");

    startX = event.pageX;

    startingScrollLeft = raceTrack.scrollLeft;
  },
);

window.addEventListener(
  "mouseup",

  () => {
    isDragging = false;

    raceTrack.classList.remove("dragging");
  },
);

raceTrack.addEventListener(
  "mousemove",

  (event) => {
    if (!isDragging) {
      return;
    }

    const distance = event.pageX - startX;

    raceTrack.scrollLeft = startingScrollLeft - distance;
  },
);

/* =====================================================
   INITIALIZE
===================================================== */

document
  .getElementById("apiStatusRetry")
  ?.addEventListener("click", () => window.location.reload());
document
  .getElementById("apiStatusToggle")
  ?.addEventListener("click", openF1ToggleStatusBanner);

async function initializeDashboard() {
  await preloadInitialImages();
  await initializeOpenF1();
  await phase2Initialize();

  pageLoader.classList.add("hidden");

  setTimeout(() => pageLoader.remove(), 650);
}

initializeDashboard();

/* =====================================================
   LASER CURSOR
===================================================== */

const laserCursor = document.querySelector(".laser-cursor");

const laserTrail = document.querySelector(".laser-trail");

let mouseX = 0;

let mouseY = 0;

let trailX = 0;

let trailY = 0;

/* ---------------------------------------------
   Track mouse
--------------------------------------------- */

document.addEventListener(
  "mousemove",

  (event) => {
    mouseX = event.clientX;

    mouseY = event.clientY;

    laserCursor.style.left = `${mouseX}px`;

    laserCursor.style.top = `${mouseY}px`;
  },
);

/* ---------------------------------------------
   Animate laser trail
--------------------------------------------- */

function animateLaserTrail() {
  trailX += (mouseX - trailX) * 0.18;

  trailY += (mouseY - trailY) * 0.18;

  const dx = mouseX - trailX;

  const dy = mouseY - trailY;

  const distance = Math.sqrt(dx * dx + dy * dy);

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  laserTrail.style.left = `${trailX}px`;

  laserTrail.style.top = `${trailY}px`;

  laserTrail.style.transform = `
            translate(-100%, -50%)
            rotate(${angle}deg)
            scaleX(
                ${Math.min(1.5, Math.max(0.15, distance / 30))}
            )
        `;

  requestAnimationFrame(animateLaserTrail);
}

animateLaserTrail();

/* =====================================================
   LASER HOVER STATE
===================================================== */

document.addEventListener(
  "mouseover",

  (event) => {
    const interactive = event.target.closest("button, a");

    if (interactive) {
      document.body.classList.add("cursor-hover");
    }
  },
);

document.addEventListener(
  "mouseout",

  (event) => {
    const interactive = event.target.closest("button, a");

    if (interactive) {
      document.body.classList.remove("cursor-hover");
    }
  },
);

/* =====================================================
   PHASE 2 DASHBOARD
===================================================== */

const phase2State = {
  drivers: [],
  teams: [],
  positionHistory: [],
  selectedHistoryDriver: null,
  loaded: false,
  loading: false,
  positionHistoryLoaded: false,
  positionHistoryLoading: false,
  nextRaceCountdownTimer: null,
};

function phase2Escape(value) {
  return String(value ?? "—").replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[char],
  );
}

function phase2Number(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function phase2Points(value) {
  const number = phase2Number(value);
  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(1).replace(/\.0$/, "");
}

function phase2DriverImage(name) {
  return typeof driverImages !== "undefined"
    ? driverImages[name] || null
    : null;
}

function phase2CalendarEvent(race, type) {
  const config = {
    qualifying: {
      start: race.qualifyingDateStart,
      status: race.qualifyingStatus || race.status,
    },
    sprintQualifying: {
      start: race.sprintQualifyingDateStart,
      status: race.sprintQualifyingStatus,
    },
    sprint: {
      start: race.sprintDateStart,
      status: race.sprintStatus,
    },
    race: {
      start: race.dateStart,
      status: race.status,
    },
  }[type];

  if (!config?.start) return null;

  const date = new Date(config.start);
  if (Number.isNaN(date.getTime())) return null;

  return {
    race,
    type,
    date,
    key: `${race.meetingKey || race.round}-${type}`,
    status: config.status === "COMPLETED" ? "completed" : "upcoming",
  };
}

function phase2CalendarDayLabel(event) {
  if (event.type === "sprintQualifying") return "SPRINT QUALIFYING";
  if (event.type === "sprint") return "SPRINT";
  if (event.type === "qualifying") return "QUALIFYING";
  return "RACE";
}

function phase2CalendarBadgeLabel(event) {
  if (event.type === "sprintQualifying") return "SQ";
  if (event.type === "sprint") return "S";
  if (event.type === "qualifying") return "Q";
  return "R";
}

const phase2TrackTimezones = {
  Melbourne: "Australia/Melbourne",
  Shanghai: "Asia/Shanghai",
  Suzuka: "Asia/Tokyo",
  Montreal: "America/Toronto",
  "Monte Carlo": "Europe/Monaco",
  Catalunya: "Europe/Madrid",
  Spielberg: "Europe/Vienna",
  Silverstone: "Europe/London",
  "Spa-Francorchamps": "Europe/Brussels",
  Hungaroring: "Europe/Budapest",
  Zandvoort: "Europe/Amsterdam",
  Monza: "Europe/Rome",
  Madring: "Europe/Madrid",
  Baku: "Asia/Baku",
  "Kuala Lumpur": "Asia/Bahrain",
  Singapore: "Asia/Singapore",
  Austin: "America/Chicago",
  "Mexico City": "America/Mexico_City",
  Interlagos: "America/Sao_Paulo",
  "Las Vegas": "America/Los_Angeles",
  Lusail: "Asia/Qatar",
  "Yas Marina Circuit": "Asia/Dubai",
};

function phase2TrackTimezone(event) {
  return (
    phase2TrackTimezones[event.race?.shortName] ||
    phase2TrackTimezones[event.race?.location] ||
    "UTC"
  );
}

function phase2FormatEventTime(event, timeZone) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(event.date);
}

function phase2FormatEventDate(event, timeZone) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(event.date);
}

function phase2CalendarEventTime(event) {
  const trackTimezone = phase2TrackTimezone(event);
  const trackTime = phase2FormatEventTime(event, trackTimezone);
  const istTime = phase2FormatEventTime(event, "Asia/Kolkata");
  const trackDate = phase2FormatEventDate(event, trackTimezone);
  const trackLabel = event.race?.location || event.race?.shortName || "Track";
  const sessionLabel = phase2CalendarDayLabel(event);

  return `
    <div class="season-calendar-time-row">
      <span class="season-calendar-time-session">${sessionLabel}</span>
      <strong>${phase2Escape(trackLabel)}</strong>
    </div>
    <div class="season-calendar-time-zone-row">
      <span><b>TRACK</b>${trackTime}</span>
      <span><b>IST</b>${istTime}</span>
    </div>
    <div class="season-calendar-time-meta">${phase2Escape(trackDate)}</div>
  `;
}

function phase2RenderCalendarMonth(year, month, eventsByDay) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (first.getDay() + 6) % 7;
  const monthName = new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    first,
  );
  const today = new Date();
  const isCurrentMonth =
    today.getFullYear() === year && today.getMonth() === month;

  let cells = "";
  for (let i = 0; i < startOffset; i++) {
    cells += `<div class="season-calendar-day season-calendar-day-empty" aria-hidden="true"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const events = eventsByDay.get(key) || [];
    const raceEvent = events.find((event) => event.type === "race");
    const qualifyingEvent = events.find((event) => event.type === "qualifying");
    const sprintQualifyingEvent = events.find(
      (event) => event.type === "sprintQualifying",
    );
    const sprintEvent = events.find((event) => event.type === "sprint");
    const classes = ["season-calendar-day"];
    const gridPosition = startOffset + day - 1;
    const columnIndex = gridPosition % 7;
    const rowIndex = Math.floor(gridPosition / 7);

    if (columnIndex === 0) classes.push("calendar-edge-left");
    if (columnIndex === 6) classes.push("calendar-edge-right");
    if (columnIndex <= 1) classes.push("calendar-near-left");
    if (columnIndex >= 5) classes.push("calendar-near-right");
    if (rowIndex >= 4) classes.push("calendar-edge-bottom");

    if (isCurrentMonth && today.getDate() === day) classes.push("today");
    if (
      [raceEvent, qualifyingEvent, sprintQualifyingEvent, sprintEvent].some(
        (event) => event?.status === "completed",
      )
    )
      classes.push("has-completed");
    if (
      [raceEvent, qualifyingEvent, sprintQualifyingEvent, sprintEvent].some(
        (event) => event?.status === "upcoming",
      )
    )
      classes.push("has-upcoming");

    const labels = [];
    if (sprintQualifyingEvent)
      labels.push(
        `<span class="season-calendar-event sprint-qualifying ${sprintQualifyingEvent.status}" title="${phase2Escape(sprintQualifyingEvent.race.shortName || sprintQualifyingEvent.race.name)} sprint qualifying">${phase2CalendarBadgeLabel(sprintQualifyingEvent)}</span>`,
      );
    if (sprintEvent)
      labels.push(
        `<span class="season-calendar-event sprint ${sprintEvent.status}" title="${phase2Escape(sprintEvent.race.shortName || sprintEvent.race.name)} sprint">${phase2CalendarBadgeLabel(sprintEvent)}</span>`,
      );
    if (qualifyingEvent)
      labels.push(
        `<span class="season-calendar-event qualifying ${qualifyingEvent.status}" title="${phase2Escape(qualifyingEvent.race.shortName || qualifyingEvent.race.name)} qualifying">${phase2CalendarBadgeLabel(qualifyingEvent)}</span>`,
      );
    if (raceEvent)
      labels.push(
        `<span class="season-calendar-event race ${raceEvent.status}" title="${phase2Escape(raceEvent.race.shortName || raceEvent.race.name)} race">${phase2CalendarBadgeLabel(raceEvent)}</span>`,
      );

    const accessible = events.length
      ? events
          .map(
            (event) =>
              `${event.race.name} ${phase2CalendarDayLabel(event)} ${event.status}`,
          )
          .join(", ")
      : `No Formula 1 event on ${monthName} ${day}`;

    const timeDetails = events
      .map(
        (event) =>
          `<div class="season-calendar-event-detail">${phase2CalendarEventTime(event)}</div>`,
      )
      .join("");
    const hasTimeDetails = events.length > 0;

    cells += `
      <div class="${classes.join(" ")}${hasTimeDetails ? " has-event-details" : ""}" data-calendar-col="${columnIndex}" aria-label="${phase2Escape(accessible)}" tabindex="${hasTimeDetails ? "0" : "-1"}">
        <span class="season-calendar-date">${day}</span>
        <div class="season-calendar-events">${labels.join("")}</div>
        ${hasTimeDetails ? `<div class="season-calendar-time-details" aria-hidden="true">${timeDetails}</div>` : ""}
      </div>
    `;
  }

  return `
    <section class="season-calendar-month">
      <div class="season-calendar-month-header">
        <h3>${monthName}</h3>
        <span>${year}</span>
      </div>
      <div class="season-calendar-weekdays">
        ${["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => `<span>${day}</span>`).join("")}
      </div>
      <div class="season-calendar-grid">${cells}</div>
    </section>
  `;
}

function phase2RenderCalendarModal() {
  const modal = document.getElementById("calendarModal");
  const calendar = document.getElementById("seasonCalendar");
  const summary = document.getElementById("calendarModalSummary");
  if (!modal || !calendar || !Array.isArray(races) || !races.length) return;

  const events = races
    .flatMap((race) => [
      phase2CalendarEvent(race, "sprintQualifying"),
      phase2CalendarEvent(race, "sprint"),
      phase2CalendarEvent(race, "qualifying"),
      phase2CalendarEvent(race, "race"),
    ])
    .filter(Boolean)
    .sort((a, b) => a.date - b.date);

  const eventsByDay = new Map();
  events.forEach((event) => {
    const key = `${event.date.getFullYear()}-${String(event.date.getMonth() + 1).padStart(2, "0")}-${String(event.date.getDate()).padStart(2, "0")}`;
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key).push(event);
  });

  const monthKeys = [
    ...new Set(
      events.map(
        (event) => `${event.date.getFullYear()}-${event.date.getMonth()}`,
      ),
    ),
  ];
  const months = monthKeys.map((key) => {
    const [year, month] = key.split("-").map(Number);
    return phase2RenderCalendarMonth(year, month, eventsByDay);
  });

  calendar.innerHTML = months.join("");
  calendar
    .querySelectorAll(".season-calendar-day.has-event-details")
    .forEach((dayCell) => {
      dayCell.style.setProperty(
        "--calendar-offset",
        `${-(Number(dayCell.dataset.calendarCol) || 0) * 100}%`,
      );
    });

  const completedRaces = races.filter(
    (race) => race.status === "COMPLETED",
  ).length;
  const upcomingRaces = races.length - completedRaces;
  const completedEvents = events.filter(
    (event) => event.status === "completed",
  ).length;
  const upcomingEvents = events.length - completedEvents;

  summary.innerHTML = `
    <div><span>ROUNDS</span><strong>${String(races.length).padStart(2, "0")}</strong></div>
    <div><span>COMPLETED</span><strong>${String(completedRaces).padStart(2, "0")}</strong></div>
    <div><span>REMAINING</span><strong>${String(upcomingRaces).padStart(2, "0")}</strong></div>
  `;

  const completedLabel = document.getElementById("calendarCompletedLegend");
  const upcomingLabel = document.getElementById("calendarUpcomingLegend");
  if (completedLabel)
    completedLabel.textContent = `${completedRaces} ROUNDS / ${completedEvents} EVENTS`;
  if (upcomingLabel)
    upcomingLabel.textContent = `${upcomingRaces} ROUNDS / ${upcomingEvents} EVENTS`;

  calendar.addEventListener("click", (event) => {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    const dayCell = event.target.closest(".season-calendar-day");
    if (!dayCell || dayCell.classList.contains("has-event-details")) return;
    calendar
      .querySelectorAll(".season-calendar-day.is-open")
      .forEach((openCell) => {
        openCell.classList.remove("is-open");
        openCell
          .querySelector(".season-calendar-time-details")
          ?.setAttribute("aria-hidden", "true");
      });
  });

  calendar
    .querySelectorAll(".season-calendar-day.has-event-details")
    .forEach((dayCell) => {
      dayCell.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 700px)").matches) {
          const wasOpen = dayCell.classList.contains("is-open");
          calendar
            .querySelectorAll(".season-calendar-day.is-open")
            .forEach((openCell) => {
              if (openCell !== dayCell) {
                openCell.classList.remove("is-open");
                openCell
                  .querySelector(".season-calendar-time-details")
                  ?.setAttribute("aria-hidden", "true");
              }
            });
          dayCell.classList.toggle("is-open", !wasOpen);
          dayCell
            .querySelector(".season-calendar-time-details")
            ?.setAttribute("aria-hidden", String(wasOpen));
        }
      });

      dayCell.addEventListener("keydown", (event) => {
        if (
          (event.key === "Enter" || event.key === " ") &&
          window.matchMedia("(max-width: 700px)").matches
        ) {
          event.preventDefault();
          dayCell.click();
        }
      });
    });
}

let phase2CalendarScrollY = 0;

function phase2OpenCalendarModal() {
  const modal = document.getElementById("calendarModal");
  if (!modal) return;

  phase2RenderCalendarModal();
  phase2CalendarScrollY = window.scrollY || window.pageYOffset || 0;
  document.documentElement.classList.add("calendar-modal-open");
  document.body.classList.add("calendar-modal-open");
  document.body.style.position = "fixed";
  document.body.style.top = `-${phase2CalendarScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("calendarModalClose")?.focus();
}

function phase2CloseCalendarModal() {
  const modal = document.getElementById("calendarModal");
  if (!modal) return;

  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.documentElement.classList.remove("calendar-modal-open");
  document.body.classList.remove("calendar-modal-open");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, phase2CalendarScrollY);
}

function phase2BindCalendarModal() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("#overviewCalendarButton")) {
      phase2OpenCalendarModal();
      return;
    }

    if (event.target.closest("[data-calendar-close]")) {
      phase2CloseCalendarModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      phase2CloseCalendarModal();
    }
  });
}

function phase2NextCountdownEvent(race) {
  if (!race) return null;

  const now = Date.now();
  const sessions = race.hasSprint
    ? [
        {
          type: "sprintQualifying",
          start: race.sprintQualifyingDateStart,
          label: "NEXT SPRINT QUALIFYING IN",
        },
        {
          type: "sprint",
          start: race.sprintDateStart,
          label: "NEXT SPRINT IN",
        },
        {
          type: "qualifying",
          start: race.qualifyingDateStart,
          label: "NEXT QUALIFYING IN",
        },
        { type: "race", start: race.dateStart, label: "NEXT RACE IN" },
      ]
    : [
        {
          type: "qualifying",
          start: race.qualifyingDateStart,
          label: "NEXT QUALIFYING IN",
        },
        { type: "race", start: race.dateStart, label: "NEXT RACE IN" },
      ];

  for (const session of sessions) {
    const target = new Date(session.start || "").getTime();
    if (Number.isFinite(target) && target > now) {
      return { ...session, target };
    }
  }

  return null;
}

function phase2RenderNextRaceCountdown(next) {
  const countdown = document.getElementById("overviewNextCountdown");
  if (!countdown) return;

  if (phase2State.nextRaceCountdownTimer) {
    clearInterval(phase2State.nextRaceCountdownTimer);
    phase2State.nextRaceCountdownTimer = null;
  }

  const event = phase2NextCountdownEvent(next);

  if (!event) {
    countdown.innerHTML = `<span class="overview-countdown-label">NEXT SESSION</span><strong>DATE TBC</strong>`;
    countdown.classList.add("complete");
    return;
  }

  const update = () => {
    const remaining = Math.max(0, event.target - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    countdown.classList.remove("complete");
    countdown.innerHTML = `
      <span class="overview-countdown-label">${event.label}</span>
      <div class="overview-countdown-grid" aria-label="Countdown to ${event.type}">
        <div class="overview-countdown-unit"><strong>${String(days).padStart(2, "0")}</strong><span>DAYS</span></div>
        <div class="overview-countdown-unit"><strong>${String(hours).padStart(2, "0")}</strong><span>HOURS</span></div>
        <div class="overview-countdown-unit"><strong>${String(minutes).padStart(2, "0")}</strong><span>MINUTES</span></div>
        <div class="overview-countdown-unit"><strong>${String(seconds).padStart(2, "0")}</strong><span>SECONDS</span></div>
      </div>
    `;

    if (remaining <= 0) {
      clearInterval(phase2State.nextRaceCountdownTimer);
      phase2State.nextRaceCountdownTimer = null;
      window.setTimeout(() => phase2RenderNextRaceCountdown(next), 50);
    }
  };

  update();
  phase2State.nextRaceCountdownTimer = setInterval(update, 1000);
}

function phase2TeamClass(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("mercedes")) return "mercedes";
  if (n.includes("ferrari")) return "ferrari";
  if (n.includes("mclaren")) return "mclaren";
  if (n.includes("red bull")) return "redbull";
  if (n.includes("racing bulls")) return "racingbulls";
  if (n.includes("alpine")) return "alpine";
  if (n.includes("haas")) return "haas";
  if (n.includes("audi")) return "audi";
  if (n.includes("williams")) return "williams";
  if (n.includes("aston martin")) return "astonmartin";
  if (n.includes("cadillac")) return "cadillac";
  return "unknown";
}

/* =====================================================
   RACE REPLAY
===================================================== */

const replayState = {
  race: null,
  drivers: [],
  driverByNumber: new Map(),
  positions: [],
  positionByDriver: new Map(),
  lapsByDriver: new Map(),
  locations: new Map(),
  locationLoading: new Set(),
  locationRetryAt: new Map(),
  trackPoints: [],
  startTime: 0,
  endTime: 0,
  currentTime: 0,
  speed: 1,
  playing: false,
  loading: false,
  animationFrame: null,
  lastFrameTime: 0,
  requestId: 0,
  selectedDrivers: [],
  startingGrid: new Map(),
  finishTime: 0,
  trackStartPoint: null,
  trackStartDirection: null,
  locationRangeStart: 0,
  locationRangeEnd: 0,
};

const replayElements = {
  raceSelect: document.getElementById("replayRaceSelect"),
  driverPicker: document.getElementById("replayDriverPicker"),
  driverPickerButton: document.getElementById("replayDriverPickerButton"),
  driverMenu: document.getElementById("replayDriverMenu"),
  loadStatus: document.getElementById("replayLoadStatus"),
  loadButton: document.getElementById("replayLoadButton"),
  trackTitle: document.getElementById("replayTrackTitle"),
  canvas: document.getElementById("replayCanvas"),
  canvasEmpty: document.getElementById("replayCanvasEmpty"),
  legend: document.getElementById("replayLegend"),
  lapLabel: document.getElementById("replayLapLabel"),
  timingDriver: document.getElementById("replayTimingDriver"),
  lapTime: document.getElementById("replayLapTime"),
  sector1: document.getElementById("replaySector1"),
  sector2: document.getElementById("replaySector2"),
  sector3: document.getElementById("replaySector3"),
  positionCard: document.getElementById("replayPositionCard"),
  driverList: document.getElementById("replayDriverList"),
  rewind: document.getElementById("replayRewind"),
  play: document.getElementById("replayPlay"),
  progress: document.getElementById("replayProgress"),
  progressStart: document.getElementById("replayProgressStart"),
  progressEnd: document.getElementById("replayProgressEnd"),
  clock: document.getElementById("replayClock"),
  finishState: document.getElementById("replayFinishState"),
};

function replayEscape(value) {
  return String(value ?? "—").replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[char],
  );
}

function replayTeamColor(team) {
  return phase2TeamColor ? phase2TeamColor(team) : "unknown";
}

function replayDriverColor(driver) {
  const direct = String(driver?.team_colour || "").replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(direct)) return `#${direct}`;
  const colors = {
    mercedes: "#00d2be",
    ferrari: "#e10600",
    mclaren: "#ff8700",
    redbull: "#3671c6",
    racingbulls: "#6a91e8",
    astonmartin: "#358c73",
    alpine: "#ff86ba",
    williams: "#36a8ed",
    audi: "#d40000",
    haas: "#9e9e9e",
    unknown: "#bdbdbd",
  };
  return colors[replayTeamColor(driver?.team_name)] || colors.unknown;
}

function replayFormatClock(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "00:00.000";
  const totalSeconds = ms / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor(ms % 1000);
  if (hours)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function replayFormatLapTime(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) <= 0) return "—";
  return formatLapTime(Number(seconds));
}

function replayTimestamp(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function replayBinarySearch(points, timestamp) {
  if (!points?.length) return null;
  if (timestamp <= points[0].time) return points[0];
  if (timestamp >= points[points.length - 1].time)
    return points[points.length - 1];
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].time < timestamp) low = mid + 1;
    else high = mid - 1;
  }
  const after = points[low];
  const before = points[low - 1];
  if (!before || !after) return before || after;
  const span = after.time - before.time;
  const ratio = span > 0 ? (timestamp - before.time) / span : 0;
  return {
    time: timestamp,
    x: before.x + (after.x - before.x) * ratio,
    y: before.y + (after.y - before.y) * ratio,
    z: before.z + (after.z - before.z) * ratio,
  };
}

function replayLatestPosition(driverNumber, timestamp) {
  const points = replayState.positionByDriver.get(Number(driverNumber)) || [];
  if (!points.length) return null;
  let low = 0;
  let high = points.length - 1;
  let result = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].time <= timestamp) {
      result = points[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return Number.isFinite(result?.position) ? result.position : null;
}

function replayActiveLap(driverNumber, timestamp) {
  const laps = replayState.lapsByDriver.get(Number(driverNumber)) || [];
  if (!laps.length) return null;
  let low = 0;
  let high = laps.length - 1;
  let result = null;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (laps[mid].start <= timestamp) {
      result = laps[mid];
      low = mid + 1;
    } else high = mid - 1;
  }
  return result;
}

function replayNormalizePoints(points) {
  const valid = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  if (!valid.length) return { points: [], bounds: null };
  const xs = valid.map((point) => point.x);
  const ys = valid.map((point) => point.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const padX = Math.max((maxX - minX) * 0.08, 1);
  const padY = Math.max((maxY - minY) * 0.08, 1);
  return {
    points: valid,
    bounds: {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY,
    },
  };
}

function replayBuildTrack() {
  let best = null;

  for (const driver of replayState.drivers) {
    const points = replayState.locations.get(Number(driver.driver_number));
    const laps =
      replayState.lapsByDriver.get(Number(driver.driver_number)) || [];
    if (!points?.length || laps.length < 3) continue;

    const candidates = laps
      .map((lap, index) => ({ lap, nextLap: laps[index + 1] }))
      .filter(
        ({ lap, nextLap }) =>
          lap?.start &&
          nextLap?.start &&
          nextLap.start > lap.start &&
          Number(lap.lap_number) > 1,
      );

    for (const { lap, nextLap } of candidates) {
      const lapPoints = points.filter(
        (point) => point.time >= lap.start && point.time < nextLap.start,
      );
      if (lapPoints.length < 25) continue;
      if (!best || lapPoints.length > best.length) best = lapPoints;
    }
  }

  if (!best) {
    for (const points of replayState.locations.values()) {
      if (points?.length && (!best || points.length > best.length))
        best = points;
    }
  }

  if (!best?.length) {
    replayState.trackPoints = [];
    return;
  }

  const step = Math.max(1, Math.ceil(best.length / 1200));
  replayState.trackPoints = best.filter((_, index) => index % step === 0);
  replayState.trackStartPoint = replayState.trackPoints[0] || null;
  const next = replayState.trackPoints[1];
  replayState.trackStartDirection =
    next && replayState.trackStartPoint
      ? {
          x: next.x - replayState.trackStartPoint.x,
          y: next.y - replayState.trackStartPoint.y,
        }
      : null;
}

function replayRaceTimeRange() {
  const lapStarts = [];
  const locationStarts = [];
  const locationEnds = [];

  replayState.lapsByDriver.forEach((laps) => {
    const firstRaceLap = laps.find(
      (lap) => Number(lap.lap_number) === 1 && Number.isFinite(lap.start),
    );
    if (firstRaceLap) lapStarts.push(firstRaceLap.start);
  });

  replayState.locations.forEach((points) => {
    if (!points?.length) return;
    locationStarts.push(points[0].time);
    locationEnds.push(points[points.length - 1].time);
  });

  const startCandidates = lapStarts.length ? lapStarts : locationStarts;
  const start = Math.min(...startCandidates.filter(Number.isFinite));

  const finalRows = replayCurrentLeaderboard(
    Math.max(
      ...replayState.positions.map((row) => row.time).filter(Number.isFinite),
      start || 0,
    ),
  );
  const leader = finalRows.find((item) => item.position === 1)?.driver;
  let finish = 0;

  if (leader) {
    const leaderLaps =
      replayState.lapsByDriver.get(Number(leader.driver_number)) || [];
    const lastLap = leaderLaps.reduce(
      (best, lap) =>
        !best || Number(lap.lap_number) > Number(best.lap_number) ? lap : best,
      null,
    );
    if (lastLap?.start && Number(lastLap.lap_duration) > 0) {
      finish = lastLap.start + Number(lastLap.lap_duration) * 1000;
    }
  }

  const fallbackEnd = Math.max(
    ...locationEnds.filter(Number.isFinite),
    ...replayState.positions.map((row) => row.time).filter(Number.isFinite),
    start || 0,
  );
  const end = finish > start ? finish : fallbackEnd;

  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    replayState.startTime = start;
    replayState.endTime = end;
    replayState.finishTime = end;
    replayState.locationRangeStart = Math.min(
      ...locationStarts.filter(Number.isFinite),
      start,
    );
    replayState.locationRangeEnd = Math.max(
      ...locationEnds.filter(Number.isFinite),
      end,
    );
    replayState.currentTime = start;
  }
}

function replayDriverName(driver) {
  return (
    driver?.name_acronym ||
    driver?.name ||
    driver?.full_name ||
    driver?.broadcast_name ||
    `#${driver?.driver_number ?? "—"}`
  );
}

function replayDriverFullName(driver) {
  return (
    driver?.full_name ||
    driver?.name ||
    driver?.broadcast_name ||
    replayDriverName(driver)
  );
}

function replayDriverPosition(driver, timestamp) {
  const direct = replayLatestPosition(driver.driver_number, timestamp);
  if (direct !== null && direct !== undefined) return Number(direct);
  const lap = replayActiveLap(driver.driver_number, timestamp);
  return lap?.position ?? null;
}

function replayCurrentLeaderboard(timestamp) {
  const rows = replayState.drivers
    .map((driver) => ({
      driver,
      position: replayDriverPosition(driver, timestamp),
    }))
    .filter((item) => Number.isFinite(item.position) && item.position > 0)
    .sort((a, b) => a.position - b.position);

  if (rows.length) return rows;

  return replayState.drivers
    .map((driver) => ({
      driver,
      position:
        replayState.startingGrid.get(Number(driver.driver_number)) || null,
    }))
    .filter((item) => Number.isFinite(item.position))
    .sort((a, b) => a.position - b.position);
}

function replayVisibleDrivers(timestamp) {
  const leaderboard = replayCurrentLeaderboard(timestamp);
  if (!replayState.selectedDrivers.length)
    return leaderboard.slice(0, 5).map((item) => item.driver);
  return replayState.selectedDrivers
    .map((number) => replayState.driverByNumber.get(Number(number)))
    .filter(Boolean);
}

function replaySelectionLabel() {
  if (!replayState.selectedDrivers.length) return "TOP 5";
  const names = replayState.selectedDrivers
    .map((number) => replayState.driverByNumber.get(Number(number)))
    .filter(Boolean)
    .map(replayDriverName);
  return names.length <= 2
    ? names.join(" · ")
    : `${names.length} DRIVERS SELECTED`;
}

function replayDraw() {
  const canvas = replayElements.canvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width,
    h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#090909";
  ctx.fillRect(0, 0, w, h);
  if (!replayState.trackPoints.length) return;

  const normalized = replayNormalizePoints(replayState.trackPoints);
  if (!normalized.bounds) return;
  const b = normalized.bounds;
  const pad = 42;
  const scale = Math.min(
    (w - pad * 2) / (b.maxX - b.minX),
    (h - pad * 2) / (b.maxY - b.minY),
  );
  const offsetX = (w - (b.maxX - b.minX) * scale) / 2;
  const offsetY = (h - (b.maxY - b.minY) * scale) / 2;
  const project = (point) => ({
    x: offsetX + (point.x - b.minX) * scale,
    y: h - (offsetY + (point.y - b.minY) * scale),
  });

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  replayState.trackPoints.forEach((point, index) => {
    const p = project(point);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.strokeStyle = "#292929";
  ctx.lineWidth = 12;
  ctx.stroke();
  ctx.strokeStyle = "#777";
  ctx.lineWidth = 2;
  ctx.stroke();

  if (replayState.trackPoints.length > 2) {
    const first = project(replayState.trackPoints[0]);
    const second = project(replayState.trackPoints[1]);
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    ctx.beginPath();
    ctx.moveTo(first.x - nx * 18, first.y - ny * 18);
    ctx.lineTo(first.x + nx * 18, first.y + ny * 18);
    ctx.strokeStyle = "#e10600";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const visible = replayVisibleDrivers(replayState.currentTime);
  const markerData = [];
  visible.forEach((driver) => {
    const location = replayBinarySearch(
      replayState.locations.get(Number(driver.driver_number)) || [],
      replayState.currentTime,
    );
    if (!location) return;
    const point = project(location);
    const color = replayDriverColor(driver);
    markerData.push({
      driver,
      point,
      color,
      position: replayDriverPosition(driver, replayState.currentTime),
    });
  });

  markerData.forEach(({ driver, point, color, position }) => {
    const label = `${position ? `P${position} ` : ""}${replayDriverName(driver)}`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#050505";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.font = "800 8px Arial";
    ctx.textAlign = "center";
    const textWidth = ctx.measureText(label).width;
    const labelX = point.x;
    const labelY = point.y - 17;
    ctx.fillStyle = "rgba(5,5,5,.92)";
    ctx.fillRect(labelX - textWidth / 2 - 5, labelY - 9, textWidth + 10, 14);
    ctx.fillStyle = color;
    ctx.fillRect(labelX - textWidth / 2 - 5, labelY - 9, 2, 14);
    ctx.fillStyle = "#f4f4f4";
    ctx.fillText(label, labelX, labelY + 1);
  });

  replayRenderLegend(markerData);
}

function replayRenderLegend(markerData = []) {
  if (!replayElements.legend) return;
  replayElements.legend.innerHTML = markerData
    .map(
      ({ driver, color, position }) => `
    <div class="replay-legend-item" style="--replay-color:${color}"><i style="--replay-color:${color}"></i><strong>${replayEscape(position ? `P${position}` : "—")}</strong><span>${replayEscape(replayDriverName(driver))}</span><small>${replayEscape(replayDriverFullName(driver))}</small></div>
  `,
    )
    .join("");
}

function replayRenderTiming() {
  const visible = replayVisibleDrivers(replayState.currentTime);
  const selected = replayState.selectedDrivers.length
    ? replayState.driverByNumber.get(Number(replayState.selectedDrivers[0]))
    : visible[0];
  const timingDriver = selected || visible[0];
  const lap = timingDriver
    ? replayActiveLap(timingDriver.driver_number, replayState.currentTime)
    : null;
  const position = timingDriver
    ? replayDriverPosition(timingDriver, replayState.currentTime)
    : null;

  replayElements.lapLabel.textContent = lap?.lap_number
    ? `LAP ${lap.lap_number}`
    : "LAP —";
  replayElements.timingDriver.textContent = timingDriver
    ? `${replayDriverName(timingDriver)} · ${replayDriverFullName(timingDriver)}`
    : "TOP 5";
  replayElements.lapTime.textContent = replayFormatLapTime(lap?.lap_duration);
  replayElements.sector1.textContent = replayFormatLapTime(
    lap?.duration_sector_1,
  );
  replayElements.sector2.textContent = replayFormatLapTime(
    lap?.duration_sector_2,
  );
  replayElements.sector3.textContent = replayFormatLapTime(
    lap?.duration_sector_3,
  );
  replayElements.positionCard.innerHTML = `<span>POSITION</span><strong>${position ? `P${position}` : "—"}</strong>`;
  replayElements.clock.textContent = replayFormatClock(
    replayState.currentTime - replayState.startTime,
  );

  const leaderboard = replayCurrentLeaderboard(replayState.currentTime);
  replayElements.driverList.innerHTML = leaderboard
    .map(({ driver, position }) => {
      const selected = replayState.selectedDrivers.includes(
        Number(driver.driver_number),
      );
      const active =
        timingDriver &&
        Number(driver.driver_number) === Number(timingDriver.driver_number);
      return `<button type="button" class="replay-driver-row${active ? " active" : ""}${selected ? " selected" : ""}" style="--replay-color:${replayDriverColor(driver)}" data-replay-driver="${Number(driver.driver_number)}"><i style="--replay-color:${replayDriverColor(driver)}"></i><span><b>${position ? `P${position}` : "—"}</b> ${replayEscape(replayDriverName(driver))}</span><strong>${selected ? "SELECTED" : ""}</strong></button>`;
    })
    .join("");

  replayRenderDriverMenu();
  replayElements.finishState.hidden = !(
    replayState.finishTime && replayState.currentTime >= replayState.finishTime
  );
  if (!replayElements.finishState.hidden)
    replayElements.finishState.textContent = `LEADER FINISH · ${new Date(replayState.finishTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function replaySetStatus(text) {
  if (replayElements.loadStatus) replayElements.loadStatus.textContent = text;
}

function replayLocationCoversTime(driverNumber, timestamp) {
  const points = replayState.locations.get(Number(driverNumber)) || [];
  if (!points.length || !Number.isFinite(timestamp)) return false;
  return (
    timestamp >= points[0].time && timestamp <= points[points.length - 1].time
  );
}

function replayRequiredDriversAt(timestamp) {
  return [
    ...new Set(
      replayVisibleDrivers(timestamp)
        .map((driver) => Number(driver.driver_number))
        .filter(Number.isFinite),
    ),
  ];
}

function replayMissingDriversAt(timestamp) {
  return replayRequiredDriversAt(timestamp).filter(
    (number) => !replayLocationCoversTime(number, timestamp),
  );
}

async function replayEnsureLocationsAt(timestamp, options = {}) {
  const requestId = replayState.requestId;
  if (
    !replayState.race ||
    !replayState.startTime ||
    requestId !== replayState.requestId
  )
    return false;
  const missing = replayMissingDriversAt(timestamp);
  if (!missing.length) return true;

  const wasPlaying = Boolean(options.wasPlaying);
  replayState.playing = false;
  replayState.lastFrameTime = 0;
  cancelAnimationFrame(replayState.animationFrame);
  replayElements.play.textContent = "LOADING…";
  replayElements.play.disabled = true;
  replaySetStatus(
    `LOADING ${missing.length} DRIVER${missing.length === 1 ? "" : "S"} FOR THIS POINT`,
  );

  try {
    await replayFetchLocations(missing, requestId, true);
  } catch (error) {
    console.warn("Replay seek telemetry load failed", error);
  }

  if (requestId !== replayState.requestId) return false;
  const stillMissing = replayMissingDriversAt(timestamp);
  if (stillMissing.length) {
    replayElements.play.textContent = "LOADING…";
    replayElements.play.disabled = true;
    replaySetStatus(
      `${replayRequiredDriversAt(timestamp).length - stillMissing.length}/${replayRequiredDriversAt(timestamp).length} TELEMETRY · LOADING`,
    );
    return false;
  }

  replayElements.play.disabled = false;
  replayElements.play.textContent = "PLAY";
  const required = replayRequiredDriversAt(timestamp).length;
  replaySetStatus(`${required}/${required} DRIVERS · TELEMETRY READY`);
  replayRenderTiming();
  replayDraw();
  return true;
}

async function replayFetchLocations(
  driverNumbers,
  requestId,
  waitForAll = false,
) {
  const requested = [
    ...new Set(driverNumbers.map(Number).filter(Number.isFinite)),
  ];
  const now = Date.now();
  const queue = requested.filter(
    (number) =>
      !replayState.locations.has(number) &&
      !replayState.locationLoading.has(number) &&
      (replayState.locationRetryAt.get(number) || 0) <= now,
  );
  queue.forEach((number) => replayState.locationLoading.add(number));

  const getReady = () =>
    requested.filter(
      (number) => (replayState.locations.get(number) || []).length > 0,
    );
  const getMissing = () =>
    requested.filter(
      (number) => !(replayState.locations.get(number) || []).length,
    );

  const updateLocationStatus = (retrying = 0) => {
    if (!replayElements.loadStatus) return;
    const ready = getReady().length;
    const missing = getMissing().length;
    const loading = requested.filter((number) =>
      replayState.locationLoading.has(number),
    ).length;
    if (!missing) {
      replaySetStatus(`${ready}/${requested.length} DRIVERS · TELEMETRY READY`);
      return;
    }
    if (retrying) {
      replaySetStatus(
        `${ready}/${requested.length} TELEMETRY · RETRYING ${retrying}`,
      );
      return;
    }
    replaySetStatus(
      `${ready}/${requested.length} TELEMETRY · LOADING${loading ? ` ${loading}` : ""}`,
    );
  };

  updateLocationStatus();

  const loadOne = async (number) => {
    if (
      replayState.locations.has(number) ||
      requestId !== replayState.requestId
    )
      return true;
    let lastError = null;
    for (
      let attempt = 0;
      attempt < 3 && requestId === replayState.requestId;
      attempt += 1
    ) {
      try {
        const rows = await fetchOpenF1("location", {
          session_key: replayState.race.sessionKey,
          driver_number: number,
        });
        const seen = new Set();
        const points = rows
          .map((row) => ({
            time: replayTimestamp(row.date),
            x: Number(row.x),
            y: Number(row.y),
            z: Number(row.z),
          }))
          .filter(
            (point) =>
              point.time &&
              Number.isFinite(point.x) &&
              Number.isFinite(point.y),
          )
          .filter((point) => {
            const key = `${point.time}|${point.x}|${point.y}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => a.time - b.time);

        if (points.length) {
          replayState.locations.set(number, points);
          replayState.locationRetryAt.delete(number);
          return true;
        }
        lastError = new Error("OpenF1 returned no location samples");
      } catch (error) {
        lastError = error;
      }
      if (attempt < 2 && requestId === replayState.requestId) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1500 * (attempt + 1)),
        );
      }
    }
    replayState.locationRetryAt.set(number, Date.now() + 8000);
    console.warn(
      `Replay location load pending for driver ${number}`,
      lastError,
    );
    return false;
  };

  const workers = [
    async () => {
      while (queue.length && requestId === replayState.requestId) {
        const number = queue.shift();
        try {
          await loadOne(number);
        } finally {
          replayState.locationLoading.delete(number);
          updateLocationStatus();
          replayBuildTrack();
          replayDraw();
        }
      }
    },
    async () => {
      while (queue.length && requestId === replayState.requestId) {
        const number = queue.shift();
        try {
          await loadOne(number);
        } finally {
          replayState.locationLoading.delete(number);
          updateLocationStatus();
          replayBuildTrack();
          replayDraw();
        }
      }
    },
  ];

  await Promise.all(workers.map((worker) => worker()));

  if (waitForAll && requestId === replayState.requestId) {
    let missing = getMissing();
    let retryRound = 0;
    while (missing.length && requestId === replayState.requestId) {
      retryRound += 1;
      updateLocationStatus(missing.length);
      for (const number of missing) {
        if (requestId !== replayState.requestId) break;
        replayState.locationLoading.add(number);
        try {
          await loadOne(number);
        } finally {
          replayState.locationLoading.delete(number);
        }
        updateLocationStatus(missing.length);
        replayBuildTrack();
        replayDraw();
        if ((replayState.locations.get(number) || []).length) break;
      }
      missing = getMissing();
      if (missing.length && requestId === replayState.requestId) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(12000, 2500 + retryRound * 1000)),
        );
      }
    }
  }

  updateLocationStatus();
  return getReady();
}

async function replayLoadRace(race) {
  if (!race?.sessionKey || race.status !== "COMPLETED") return;
  const requestId = ++replayState.requestId;
  replayState.playing = false;
  replayState.loading = true;
  replayState.race = race;
  replayElements.loadButton.disabled = true;
  replayState.locations = new Map();
  replayState.locationLoading = new Set();
  replayState.locationRetryAt = new Map();
  replayState.positions = [];
  replayState.positionByDriver = new Map();
  replayState.lapsByDriver = new Map();
  replayState.trackPoints = [];
  replayState.selectedDrivers = [];
  replayState.startingGrid = new Map();
  replayState.finishTime = 0;
  replayState.trackStartPoint = null;
  replayState.trackStartDirection = null;
  replayElements.play.textContent = "PLAY";
  replayElements.canvasEmpty.hidden = false;
  replayElements.canvasEmpty.textContent = "LOADING OPENF1 TELEMETRY";
  replaySetStatus(`LOADING ${race.shortName.toUpperCase()}`);
  replayElements.trackTitle.textContent = race.name;

  try {
    const [drivers, positions, laps, startingGrid] = await Promise.all([
      fetchOpenF1("drivers", { session_key: race.sessionKey }),
      fetchOpenF1("position", { session_key: race.sessionKey }),
      fetchOpenF1("laps", { session_key: race.sessionKey }),
      fetchOpenF1("starting_grid", { session_key: race.sessionKey }).catch(
        () => [],
      ),
    ]);
    if (requestId !== replayState.requestId) return;

    replayState.drivers = drivers.filter((driver) =>
      Number.isFinite(Number(driver.driver_number)),
    );
    replayState.driverByNumber = new Map(
      replayState.drivers.map((driver) => [
        Number(driver.driver_number),
        driver,
      ]),
    );
    replayState.startingGrid = new Map(
      startingGrid
        .map((row) => [Number(row.driver_number), Number(row.position)])
        .filter(
          ([driver, position]) =>
            Number.isFinite(driver) && Number.isFinite(position),
        ),
    );
    replayState.positions = positions
      .map((row) => ({
        time: replayTimestamp(row.date),
        driver_number: Number(row.driver_number),
        position: Number(row.position),
      }))
      .filter(
        (row) => row.time && row.driver_number && Number.isFinite(row.position),
      )
      .sort((a, b) => a.time - b.time);
    replayState.positionByDriver = new Map();
    replayState.positions.forEach((row) => {
      if (!replayState.positionByDriver.has(row.driver_number))
        replayState.positionByDriver.set(row.driver_number, []);
      replayState.positionByDriver.get(row.driver_number).push(row);
    });
    replayState.lapsByDriver = new Map();
    laps.forEach((row) => {
      const driverNumber = Number(row.driver_number);
      const start = replayTimestamp(row.date_start);
      if (!driverNumber || !start) return;
      if (!replayState.lapsByDriver.has(driverNumber))
        replayState.lapsByDriver.set(driverNumber, []);
      replayState.lapsByDriver
        .get(driverNumber)
        .push({ ...row, start, lap_number: Number(row.lap_number) });
    });
    replayState.lapsByDriver.forEach((items) =>
      items.sort((a, b) => a.start - b.start),
    );

    const timeValues = replayState.positions
      .map((row) => row.time)
      .concat(
        laps.map((row) => replayTimestamp(row.date_start)).filter(Boolean),
      );
    replayState.startTime = Math.min(
      replayTimestamp(race.dateStart),
      ...(timeValues.length ? timeValues : [Date.now()]),
    );
    replayState.endTime = Math.max(
      replayTimestamp(race.dateEnd),
      ...(timeValues.length ? timeValues : [replayState.startTime + 1]),
    );
    if (!Number.isFinite(replayState.startTime) || replayState.startTime <= 0)
      replayState.startTime = timeValues[0] || Date.now();
    if (
      !Number.isFinite(replayState.endTime) ||
      replayState.endTime <= replayState.startTime
    )
      replayState.endTime = timeValues.at(-1) || replayState.startTime + 1;
    replayState.currentTime = replayState.startTime;

    replayRaceTimeRange();

    const gridTop = [...replayState.startingGrid.entries()]
      .filter(
        ([driver, position]) =>
          replayState.driverByNumber.has(Number(driver)) &&
          Number.isFinite(position),
      )
      .sort((a, b) => a[1] - b[1])
      .slice(0, 5)
      .map(([driver]) => Number(driver));
    const positionTop = replayState.drivers
      .map((driver) => ({
        driver,
        position: replayDriverPosition(driver, replayState.startTime + 1000),
      }))
      .filter((item) => Number.isFinite(item.position))
      .sort((a, b) => a.position - b.position)
      .slice(0, 5)
      .map((item) => Number(item.driver.driver_number));
    const fallback = replayState.drivers
      .slice(0, 5)
      .map((driver) => Number(driver.driver_number));
    const locationDrivers = [
      ...new Set([
        ...(positionTop.length === 5 ? positionTop : []),
        ...gridTop,
        ...fallback,
      ]),
    ].slice(0, 5);
    await replayFetchLocations(locationDrivers, requestId, true);
    if (requestId !== replayState.requestId) return;

    replayRaceTimeRange();
    replayBuildTrack();
    if (
      !replayState.startTime ||
      !replayState.endTime ||
      replayState.endTime <= replayState.startTime
    ) {
      throw new Error("OpenF1 telemetry has no usable race timeline");
    }

    replayState.loading = false;
    replayElements.loadButton.disabled = false;
    replayElements.canvasEmpty.hidden = replayState.trackPoints.length > 0;
    replayElements.progress.value = "0";
    replayElements.progressStart.textContent = new Date(
      replayState.startTime,
    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    replayElements.progressEnd.textContent = new Date(
      replayState.endTime,
    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    replayPopulateDriverSelect();
    replayRenderTiming();
    replayDraw();
    const readyDrivers = locationDrivers.filter(
      (number) => (replayState.locations.get(Number(number)) || []).length > 0,
    ).length;
    replaySetStatus(
      readyDrivers === locationDrivers.length
        ? `${readyDrivers}/${locationDrivers.length} DRIVERS · TELEMETRY READY`
        : `${readyDrivers}/${locationDrivers.length} TELEMETRY · LOADING`,
    );
  } catch (error) {
    replayState.loading = false;
    replayElements.loadButton.disabled = false;
    replayElements.canvasEmpty.hidden = false;
    replayElements.canvasEmpty.textContent = "OPENF1 TELEMETRY UNAVAILABLE";
    replaySetStatus("TELEMETRY UNAVAILABLE");
    console.error("Race replay load failed:", error);
  }
}

function replayPopulateRaceSelect() {
  if (!replayElements.raceSelect) return;
  const completed = races.filter(
    (race) => race.status === "COMPLETED" && race.sessionKey,
  );
  replayElements.raceSelect.innerHTML = completed.length
    ? `<option value="">SELECT A COMPLETED RACE</option>${completed.map((race) => `<option value="${race.sessionKey}">${replayEscape(race.shortName)} · ROUND ${String(race.round).padStart(2, "0")}</option>`).join("")}`
    : `<option value="">NO COMPLETED RACES</option>`;
  replayElements.raceSelect.value = "";
}

function replayRenderDriverMenu() {
  if (!replayElements.driverMenu) return;
  const selected = new Set(replayState.selectedDrivers.map(Number));
  replayElements.driverMenu.innerHTML = replayState.drivers
    .slice()
    .sort((a, b) => replayDriverName(a).localeCompare(replayDriverName(b)))
    .map((driver) => {
      const number = Number(driver.driver_number);
      const checked = selected.has(number);
      return `<label class="replay-driver-option${checked ? " checked" : ""}"><input type="checkbox" data-replay-select-driver="${number}" ${checked ? "checked" : ""}><i style="--replay-color:${replayDriverColor(driver)}"></i><span>${replayEscape(replayDriverName(driver))}</span><small>#${number}</small></label>`;
    })
    .join("");

  replayElements.driverPickerButton.textContent = replaySelectionLabel();
}

function replayPopulateDriverSelect() {
  replayState.selectedDrivers = [];
  replayRenderDriverMenu();
}

function replayToggleDriver(number) {
  number = Number(number);
  if (!Number.isFinite(number)) return;
  const current = replayState.selectedDrivers.slice();
  const index = current.indexOf(number);
  if (index >= 0) {
    current.splice(index, 1);
  } else {
    if (current.length >= 5) return;
    current.push(number);
  }
  replayState.selectedDrivers = current;
  replayRenderDriverMenu();
  replayRenderTiming();
  replayDraw();
}

function replayPrepareRaceSelection(sessionKey) {
  cancelAnimationFrame(replayState.animationFrame);
  replayState.requestId += 1;
  replayState.playing = false;
  replayState.loading = false;
  replayState.race = null;
  replayState.drivers = [];
  replayState.driverByNumber = new Map();
  replayState.positions = [];
  replayState.positionByDriver = new Map();
  replayState.lapsByDriver = new Map();
  replayState.locations = new Map();
  replayState.locationLoading = new Set();
  replayState.locationRetryAt = new Map();
  replayState.trackPoints = [];
  replayState.startTime = 0;
  replayState.endTime = 0;
  replayState.currentTime = 0;
  replayState.selectedDrivers = [];
  replayState.startingGrid = new Map();
  replayState.finishTime = 0;
  replayState.trackStartPoint = null;
  replayState.trackStartDirection = null;
  replayState.locationRangeStart = 0;
  replayState.locationRangeEnd = 0;
  replayElements.play.textContent = "PLAY";
  replayElements.trackTitle.textContent = "Select a race";
  replayElements.canvasEmpty.hidden = false;
  replayElements.canvasEmpty.textContent = sessionKey
    ? "PRESS LOAD REPLAY TO FETCH TELEMETRY"
    : "SELECT A COMPLETED RACE TO LOAD TELEMETRY";
  replayElements.driverPickerButton.textContent = "TOP 5";
  replayElements.driverPickerButton.disabled = !sessionKey;
  replayElements.driverMenu.hidden = true;
  replayElements.legend.innerHTML = "";
  replayElements.driverList.innerHTML = "";
  replayElements.lapLabel.textContent = "LAP —";
  replayElements.timingDriver.textContent = "TOP 5";
  replayElements.lapTime.textContent = "—";
  replayElements.sector1.textContent = "—";
  replayElements.sector2.textContent = "—";
  replayElements.sector3.textContent = "—";
  replayElements.positionCard.innerHTML =
    "<span>POSITION</span><strong>—</strong>";
  replayElements.clock.textContent = "00:00.000";
  replayElements.progress.value = "0";
  replayElements.progressStart.textContent = "—";
  replayElements.progressEnd.textContent = "—";
  replayElements.loadButton.disabled = !sessionKey;
  replaySetStatus(
    sessionKey
      ? "RACE SELECTED · PRESS LOAD REPLAY"
      : "SELECT A COMPLETED RACE",
  );
  replayDraw();
}

function replaySelectRaceBySession(sessionKey) {
  replayPrepareRaceSelection(sessionKey);
}

async function replayAnimationFrame(now) {
  if (!replayState.playing) return;
  if (!replayState.lastFrameTime) replayState.lastFrameTime = now;
  const delta = Math.min(100, now - replayState.lastFrameTime);
  replayState.lastFrameTime = now;
  const nextTime = Math.min(
    replayState.endTime,
    replayState.currentTime + delta * replayState.speed,
  );
  const missing = replayMissingDriversAt(nextTime);
  if (missing.length) {
    replayState.playing = false;
    replayElements.play.disabled = true;
    replayElements.play.textContent = "LOADING…";
    replaySetStatus(
      `LOADING ${missing.length} DRIVER${missing.length === 1 ? "" : "S"} FOR THIS POINT`,
    );
    await replayEnsureLocationsAt(nextTime, { wasPlaying: true });
    return;
  }

  replayState.currentTime = nextTime;
  if (replayState.currentTime >= replayState.endTime) {
    replayState.currentTime = replayState.endTime;
    replayState.playing = false;
    replayElements.play.textContent = "PLAY";
  }
  const range = Math.max(1, replayState.endTime - replayState.startTime);
  replayElements.progress.value = String(
    (replayState.currentTime - replayState.startTime) / range,
  );
  replayRenderTiming();
  replayDraw();
  if (replayState.playing)
    replayState.animationFrame = requestAnimationFrame(replayAnimationFrame);
}

async function replayTogglePlay() {
  if (
    !replayState.race ||
    replayState.loading ||
    !replayState.trackPoints.length ||
    replayElements.play.disabled
  )
    return;
  if (replayState.currentTime >= replayState.endTime)
    replayState.currentTime = replayState.startTime;

  if (replayState.playing) {
    replayState.playing = false;
    replayElements.play.textContent = "PLAY";
    cancelAnimationFrame(replayState.animationFrame);
    return;
  }

  const ready = await replayEnsureLocationsAt(replayState.currentTime);
  if (!ready) return;

  replayState.playing = true;
  replayElements.play.disabled = false;
  replayElements.play.textContent = "PAUSE";
  replayState.lastFrameTime = 0;
  cancelAnimationFrame(replayState.animationFrame);
  replayState.animationFrame = requestAnimationFrame(replayAnimationFrame);
}

function replayBind() {
  if (!replayElements.raceSelect) return;
  replayPopulateRaceSelect();
  replayElements.loadButton.disabled = true;
  replayElements.raceSelect.addEventListener("change", () =>
    replaySelectRaceBySession(replayElements.raceSelect.value),
  );
  replayElements.loadButton.addEventListener("click", () => {
    const race = races.find(
      (item) =>
        String(item.sessionKey) === String(replayElements.raceSelect.value),
    );
    if (race) replayLoadRace(race);
  });
  replayElements.driverPickerButton.addEventListener("click", () => {
    if (replayElements.driverPickerButton.disabled) return;
    const open = !replayElements.driverMenu.hidden;
    replayElements.driverMenu.hidden = open;
    replayElements.driverPickerButton.setAttribute(
      "aria-expanded",
      String(!open),
    );
  });
  replayElements.driverMenu.addEventListener("change", (event) => {
    const input = event.target.closest("[data-replay-select-driver]");
    if (!input) return;
    const number = Number(input.dataset.replaySelectDriver);
    if (input.checked && replayState.selectedDrivers.length >= 5) {
      input.checked = false;
      return;
    }
    replayToggleDriver(number);
    if (replayState.selectedDrivers.includes(number)) {
      replayFetchLocations([number], replayState.requestId).catch(
        console.error,
      );
    }
  });
  document.addEventListener("click", (event) => {
    if (!replayElements.driverPicker?.contains(event.target)) {
      replayElements.driverMenu.hidden = true;
      replayElements.driverPickerButton.setAttribute("aria-expanded", "false");
    }
  });
  replayElements.play.addEventListener("click", replayTogglePlay);
  replayElements.rewind.addEventListener("click", () => {
    replayState.currentTime = Math.max(
      replayState.startTime,
      replayState.currentTime - 10000,
    );
    replayElements.progress.value = String(
      (replayState.currentTime - replayState.startTime) /
        Math.max(1, replayState.endTime - replayState.startTime),
    );
    replayRenderTiming();
    replayDraw();
  });
  replayElements.progress.addEventListener("input", async () => {
    if (!replayState.race || !replayState.startTime || !replayState.endTime)
      return;
    const wasPlaying = replayState.playing;
    replayState.playing = false;
    cancelAnimationFrame(replayState.animationFrame);
    replayState.lastFrameTime = 0;
    replayState.currentTime =
      replayState.startTime +
      Number(replayElements.progress.value) *
        (replayState.endTime - replayState.startTime);
    replayElements.play.disabled = true;
    replayElements.play.textContent = "LOADING…";
    replaySetStatus("LOADING TELEMETRY FOR SEEK POSITION");
    replayRenderTiming();
    replayDraw();
    await replayEnsureLocationsAt(replayState.currentTime, { wasPlaying });
  });
  document.querySelectorAll(".replay-speed").forEach((button) =>
    button.addEventListener("click", () => {
      replayState.speed = Number(button.dataset.speed) || 1;
      document
        .querySelectorAll(".replay-speed")
        .forEach((item) => item.classList.toggle("active", item === button));
    }),
  );
  replayElements.driverList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-replay-driver]");
    if (!button) return;
    replayToggleDriver(Number(button.dataset.replayDriver));
    replayFetchLocations(
      replayState.selectedDrivers,
      replayState.requestId,
    ).catch(console.error);
  });
  window.addEventListener("resize", () => replayDraw());
}

function setDashboardTab(name) {
  try {
    sessionStorage.setItem("f1_active_tab", name);
  } catch (error) {
    console.warn("Unable to persist the active dashboard tab:", error);
  }

  document
    .querySelectorAll(".dashboard-tab, .mobile-dashboard-tab")
    .forEach((button) => {
      button.classList.toggle("active", button.dataset.dashboard === name);
    });

  if (
    name === "race" &&
    races.length &&
    !document.querySelector(".race-button.active")
  ) {
    const latestCompleted = phase2LatestRace();
    const defaultRace = latestCompleted || phase2NextRace() || races[0];
    const defaultIndex = races.indexOf(defaultRace);

    if (defaultIndex >= 0) {
      selectRace(defaultIndex);
    }
  }
  if (
    name === "replay" &&
    races.length &&
    replayElements.raceSelect &&
    !replayElements.raceSelect.value
  ) {
    replayPrepareRaceSelection("");
  }
  document.querySelectorAll(".dashboard-panel").forEach((panel) => {
    panel.classList.toggle(
      "active",
      panel.id === `dashboard${name.charAt(0).toUpperCase() + name.slice(1)}`,
    );
  });
  document
    .querySelector("main")
    ?.classList.toggle("dashboard-mode", name !== "race");
  document
    .querySelector("main")
    ?.classList.toggle("overview-fullscreen", name === "overview");
  document.documentElement.classList.toggle(
    "overview-mode",
    name === "overview",
  );
  document.body.classList.toggle("overview-mode", name === "overview");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function phase2Fetch(path, params) {
  return fetchOpenF1(path, params);
}

function phase2LatestRace() {
  const now = Date.now();
  return races
    .filter((race) => {
      if (!race.sessionKey) return false;
      const sessionEnd = new Date(
        race.dateEnd || race.dateStart || race.date,
      ).getTime();
      return (
        race.status === "COMPLETED" ||
        (Number.isFinite(sessionEnd) && sessionEnd < now)
      );
    })
    .sort(
      (a, b) =>
        new Date(a.dateStart || a.date) - new Date(b.dateStart || b.date),
    )
    .at(-1);
}

function phase2RenderUnavailable(
  message = "Season data is temporarily unavailable.",
) {
  const hasNoCachedData = openF1RequestFailedWithoutCache && !openF1CacheUsed;
  const hasCachedData = openF1CacheUsed;
  const pageStates = [
    {
      id: "overviewContent",
      title: "Season overview unavailable",
      description: hasNoCachedData
        ? "We couldn't retrieve the 2026 season data from OpenF1, and no saved copy is available on this visit."
        : hasCachedData
          ? "Saved API responses were available, but they did not contain enough completed-race information to assemble the season overview."
          : "A completed race session is not currently available, so the season overview cannot be assembled yet.",
    },
    {
      id: "driversContent",
      title: "Driver data unavailable",
      description: hasNoCachedData
        ? "Driver standings and season statistics couldn't be retrieved, and no saved copy is available on this visit."
        : hasCachedData
          ? "Saved API responses were available, but they did not contain enough information to build the driver standings."
          : "Driver standings require data from a completed race session, which is not currently available.",
    },
    {
      id: "teamsContent",
      title: "Team data unavailable",
      description: hasNoCachedData
        ? "Constructor standings and team statistics couldn't be retrieved, and no saved copy is available on this visit."
        : hasCachedData
          ? "Saved API responses were available, but they did not contain enough information to build the constructor standings."
          : "Constructor standings require data from a completed race session, which is not currently available.",
    },
    {
      id: "championshipContent",
      title: "Championship standings unavailable",
      description: hasNoCachedData
        ? "We couldn't retrieve championship standings from OpenF1, and no saved copy is available on this visit."
        : hasCachedData
          ? "Saved API responses were available, but they did not include enough completed-race information to calculate championship standings."
          : "No completed race session is currently available to calculate the championship standings.",
    },
  ];

  pageStates.forEach(({ id, title, description }) => {
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = `
      <section class="dashboard-empty-state" role="status">
        <span class="dashboard-empty-kicker">${hasNoCachedData ? "DATA TEMPORARILY UNAVAILABLE" : "SEASON UPDATE"}</span>
        <h2>${title}</h2>
        <p>${description}</p>
        <p class="dashboard-empty-note">${
          hasNoCachedData
            ? "OpenF1 may temporarily restrict public access during a live session. Please try again after the session ends."
            : hasCachedData
              ? "The saved data may be incomplete or outdated. Try again when OpenF1 access is available."
              : "The dashboard will update when OpenF1 makes a completed race session available."
        }</p>
        <button class="dashboard-empty-retry" type="button">TRY AGAIN</button>
      </section>
    `;
    const retryButton = container.querySelector(".dashboard-empty-retry");
    retryButton?.addEventListener(
      "click",
      async () => {
        retryButton.disabled = true;
        retryButton.textContent = "CHECKING…";
        try {
          await phase2LoadSeasonData();
        } catch (error) {
          console.error("Phase 2 season data retry failed:", error);
          phase2RenderUnavailable(
            "OpenF1 could not provide the latest season data. Please try again shortly.",
          );
        }
      },
      { once: true },
    );
  });
}

function phase2NextRace() {
  return races.find((race) => race.status === "UPCOMING") || null;
}

async function phase2LoadSeasonData() {
  if (phase2State.loaded || phase2State.loading) return;

  const latest = phase2LatestRace();
  if (!latest?.sessionKey) {
    phase2RenderUnavailable(
      "No completed race session is available yet, so championship standings cannot be calculated.",
    );
    return;
  }

  phase2State.loading = true;

  try {
    const [driverStandings, teamStandings, latestDrivers] = await Promise.all([
      phase2Fetch("championship_drivers", { session_key: latest.sessionKey }),
      phase2Fetch("championship_teams", { session_key: latest.sessionKey }),
      phase2Fetch("drivers", { session_key: latest.sessionKey }),
    ]);

    const driverMap = new Map(
      latestDrivers.map((driver) => [driver.driver_number, driver]),
    );

    phase2State.drivers = driverStandings
      .sort(
        (a, b) =>
          phase2Number(a.position_current) - phase2Number(b.position_current),
      )
      .map((item) => {
        const driver = driverMap.get(item.driver_number) || {};
        return {
          name: driver.full_name || `Driver #${item.driver_number}`,
          number: item.driver_number,
          team: driver.team_name || "Unknown",
          points: phase2Number(item.points_current),
          position: phase2Number(item.position_current),
        };
      });

    phase2State.teams = teamStandings
      .sort(
        (a, b) =>
          phase2Number(a.position_current) - phase2Number(b.position_current),
      )
      .map((item) => ({
        name: item.team_name || "Unknown",
        points: phase2Number(item.points_current),
        position: phase2Number(item.position_current),
      }));

    phase2State.loaded = true;
    phase2Render();
    if (
      document
        .querySelector('.dashboard-tab[data-dashboard="championship"]')
        ?.classList.contains("active")
    ) {
      phase2LoadPositionHistory();
    }
  } finally {
    phase2State.loading = false;
  }
}

async function phase2LoadPositionHistory() {
  if (phase2State.positionHistoryLoaded || phase2State.positionHistoryLoading)
    return;

  const completedRaces = races
    .filter((race) => race.status === "COMPLETED" && race.sessionKey)
    .sort((a, b) => a.round - b.round);

  if (!completedRaces.length) return;

  phase2State.positionHistoryLoading = true;
  phase2RenderChampionshipHistory();

  try {
    const history = await Promise.all(
      completedRaces.map(async (race) => {
        try {
          const results = await phase2Fetch("session_result", {
            session_key: race.sessionKey,
          });

          const positions = {};
          const statuses = {};

          results.forEach((item) => {
            const number = Number(item.driver_number);
            const position = Number(item.position);
            if (!Number.isFinite(number)) return;

            if (item.dnf || item.dns) {
              statuses[number] = "DNF/DNS";
              return;
            }

            if (item.dsq) {
              statuses[number] = "DSQ";
              return;
            }

            if (Number.isInteger(position) && position >= 1 && position <= 22) {
              positions[number] = position;
            } else {
              statuses[number] = "DNF/DNS";
            }
          });

          return {
            round: race.round,
            shortName: race.shortName,
            name: race.name,
            date: race.date,
            positions,
            statuses,
          };
        } catch (error) {
          console.warn(
            `OpenF1 session result history unavailable for ${race.name}:`,
            error,
          );
          return {
            round: race.round,
            shortName: race.shortName,
            name: race.name,
            date: race.date,
            positions: {},
            statuses: {},
          };
        }
      }),
    );

    phase2State.positionHistory = history;
    phase2State.positionHistoryLoaded = true;
    phase2State.selectedHistoryDriver =
      phase2State.selectedHistoryDriver ||
      phase2State.drivers[0]?.number ||
      null;
    phase2RenderChampionshipHistory();
  } finally {
    phase2State.positionHistoryLoading = false;
  }
}

function phase2RenderChampionshipHistory() {
  const container = document.getElementById("championshipHistoryContent");
  const select = document.getElementById("championshipDriverSelect");
  if (!container || !select) return;

  if (!phase2State.positionHistoryLoaded) {
    container.innerHTML = phase2State.positionHistoryLoading
      ? `<div class="position-history-loading">LOADING POSITION HISTORY FROM OPENF1</div>`
      : `<div class="position-history-loading">POSITION HISTORY NOT AVAILABLE</div>`;
    return;
  }

  const drivers = phase2State.drivers;
  select.innerHTML = drivers
    .map(
      (driver) =>
        `<option value="${driver.number}">${phase2Escape(driver.name)}</option>`,
    )
    .join("");
  select.value = String(
    phase2State.selectedHistoryDriver ?? drivers[0]?.number ?? "",
  );

  const selectedNumber = Number(select.value);
  phase2State.selectedHistoryDriver = selectedNumber;
  const selectedDriver =
    drivers.find((driver) => Number(driver.number) === selectedNumber) ||
    drivers[0];

  if (!selectedDriver) {
    container.innerHTML = `<div class="position-history-loading">NO DRIVER DATA</div>`;
    return;
  }

  const points = phase2State.positionHistory.map((race, index) => {
    const status = race.statuses?.[selectedDriver.number] || null;
    const position = Number.isInteger(race.positions?.[selectedDriver.number])
      ? race.positions[selectedDriver.number]
      : null;

    return {
      ...race,
      position,
      status,
      index,
    };
  });

  const validPoints = points.filter(
    (point) =>
      Number.isInteger(point.position) &&
      point.position >= 1 &&
      point.position <= 22,
  );
  const statusPoints = points.filter((point) => point.status);
  const width = 1100;
  const height = 410;
  const left = 64;
  const right = 24;
  const top = 28;
  const bottom = 58;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxPosition = 22;
  const dnfLevel = 23;

  const x = (index) =>
    left +
    (phase2State.positionHistory.length <= 1
      ? plotWidth / 2
      : (index * plotWidth) / (phase2State.positionHistory.length - 1));
  const y = (position) => top + ((position - 1) / (dnfLevel - 1)) * plotHeight;

  const gridPositions = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    22,
  ];
  const grid =
    gridPositions
      .map(
        (position) =>
          `<line x1="${left}" y1="${y(position)}" x2="${width - right}" y2="${y(position)}" class="history-grid-line"/><text x="${left - 14}" y="${y(position) + 4}" text-anchor="end" class="history-axis-label">P${position}</text>`,
      )
      .join("") +
    `<line x1="${left}" y1="${y(dnfLevel)}" x2="${width - right}" y2="${y(dnfLevel)}" class="history-grid-line history-dnf-line"/><text x="${left - 14}" y="${y(dnfLevel) + 4}" text-anchor="end" class="history-axis-label history-dnf-label">DNF/DNS</text>`;

  const labels = points
    .map(
      (point) =>
        `<text x="${x(point.index)}" y="${height - 18}" text-anchor="middle" class="history-round-label">R${point.round}</text>`,
    )
    .join("");

  const segments = [];
  let currentSegment = [];
  points.forEach((point) => {
    if (
      Number.isInteger(point.position) &&
      point.position >= 1 &&
      point.position <= maxPosition
    ) {
      currentSegment.push(`${x(point.index)},${y(point.position)}`);
    } else if (currentSegment.length) {
      segments.push(currentSegment.join(" "));
      currentSegment = [];
    }
  });
  if (currentSegment.length) segments.push(currentSegment.join(" "));

  const polylines = segments
    .map(
      (segment) =>
        `<polyline points="${segment}" class="history-line"></polyline>`,
    )
    .join("");

  const circles = validPoints
    .map(
      (point) => `
        <circle cx="${x(point.index)}" cy="${y(point.position)}" r="4.5" class="history-point">
            <title>Round ${point.round} · ${point.shortName} · P${point.position}</title>
        </circle>
    `,
    )
    .join("");

  const statusMarkers = statusPoints
    .map(
      (point) => `
        <circle cx="${x(point.index)}" cy="${y(dnfLevel)}" r="4.5" class="history-status-point">
            <title>Round ${point.round} · ${point.shortName} · ${phase2Escape(point.status)}</title>
        </circle>
    `,
    )
    .join("");

  const currentPosition = selectedDriver.position || "—";
  const best = validPoints.length
    ? Math.min(...validPoints.map((point) => point.position))
    : "—";
  const latestPoint = points.at(-1);
  const latestDisplay = latestPoint?.position
    ? `P${latestPoint.position}`
    : latestPoint?.status || "—";

  container.innerHTML = `
        <div class="position-history-header">
            <div>
                <span class="rev-eyebrow">DRIVER POSITION / POSITION HISTORY</span>
                <h3>${phase2Escape(selectedDriver.name)}</h3>
                <p>${phase2Escape(selectedDriver.team)} · CURRENT CHAMPIONSHIP P${currentPosition}</p>
            </div>
            <div class="position-history-stats">
                <div><span>CURRENT</span><strong>P${currentPosition}</strong></div>
                <div><span>BEST RACE POS.</span><strong>${best === "—" ? "—" : `P${best}`}</strong></div>
                <div><span>LAST RACE</span><strong>${latestDisplay}</strong></div>
            </div>
        </div>
        <div class="position-history-chart-wrap">
            <svg class="position-history-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${phase2Escape(selectedDriver.name)} race position history">
                ${grid}
                ${labels}
                ${polylines}
                ${circles}
                ${statusMarkers}
            </svg>
        </div>
        <div class="position-history-note">LOWER ON THE CHART = BETTER POSITION · DNF/DNS SHOWN BELOW P22 · FINAL POSITIONS FROM OPENF1 SESSION RESULT</div>
    `;
}

function phase2RaceImage(race) {
  return race?.image || "";
}

function phase2Render() {
  const latest = phase2LatestRace(),
    next = phase2NextRace(),
    leader = phase2State.drivers[0],
    topTeam = phase2State.teams[0];
  const completed = races.filter((r) => r.status === "COMPLETED").length,
    total = races.length;
  const E = phase2Escape,
    P = phase2Points,
    I = phase2DriverImage;
  const standings = (items, limit = items.length) => {
    return `<div class="overview-standings">${items
      .slice(0, limit)
      .map(
        (d, i) =>
          `<div class="overview-standing"><span>${String(i + 1).padStart(2, "0")}</span><div><strong>${E(d.name)}</strong><small>${E(d.team || "")}</small></div><div class="overview-standing-score"><b>${P(d.points)} <small>PTS</small></b></div></div>`,
      )
      .join("")}</div>`;
  };
  const teamStandings = (items, limit = 5) => {
    return `<div class="overview-standings overview-teams">${items
      .slice(0, limit)
      .map(
        (t, i) =>
          `<div class="overview-standing"><span>${String(i + 1).padStart(2, "0")}</span><div><strong>${E(t.name)}</strong></div><div class="overview-standing-score"><b>${P(t.points)} <small>PTS</small></b></div></div>`,
      )
      .join("")}</div>`;
  };
  const heroImage = I(leader?.name);
  const latestImage = phase2RaceImage(latest);

  document.getElementById("overviewContent").innerHTML = `
    <section class="overview-hero-new">
        <div class="overview-hero-copy">
            <span class="overview-eyebrow">2026 / THE SEASON SO FAR</span>
            <h2>THE SEASON<br><i>IN MOTION.</i></h2>
            <p class="overview-hero-description">Twenty-two drivers. Eleven teams. One championship still to be decided.</p>
            <div class="overview-leader-line">
                <span>CHAMPIONSHIP LEADER</span>
                <strong>${E(leader?.name || "—")}</strong>
                <b>${P(leader?.points)} <small>PTS</small></b>
            </div>
        </div>
        <div class="overview-hero-number">2026</div>
    </section>

    <section class="overview-metrics">
        <div><span>ROUNDS COMPLETE</span><strong>${completed}<em> / ${total}</em></strong></div>
        <div><span>CONSTRUCTOR LEADER</span><strong>${E(topTeam?.name || "—")}</strong></div>
        <div><span>CONSTRUCTOR POINTS</span><strong>${P(topTeam?.points)}</strong></div>
        <div><span>ROUNDS REMAINING</span><strong>${Math.max(total - completed, 0)}</strong></div>
    </section>

    <section class="overview-race-pulse">
        <div class="overview-section-intro">
            <span class="overview-eyebrow">THE CALENDAR</span>
            <h3>RACE<br><i>PULSE.</i></h3>
            <p>Where the championship has been — and where it goes next.</p>
        </div>
        <article class="overview-race-story overview-race-last">
            ${latestImage ? `<img src="${E(latestImage)}" alt="${E(latest?.shortName)} circuit">` : ``}
            <div class="overview-race-overlay"></div>
            <div class="overview-race-copy">
                <span>LAST ROUND / ${String(latest?.round || "—").padStart(2, "0")}</span>
                <h4>${E(latest?.name || "—")}</h4>
                <p>${E(latest?.location || "—")} / ${E(latest?.date || "—")}</p>
            </div>
        </article>
        <article class="overview-race-story overview-race-next">
            <div class="overview-next-number">${String(next?.round || "—").padStart(2, "0")}</div>
            <div class="overview-race-copy">
                <div class="overview-next-heading">
                    <span>NEXT ROUND / ${E(next?.shortName || "")}</span>
                    <button
                        class="overview-calendar-button"
                        id="overviewCalendarButton"
                        type="button"
                        aria-label="Open 2026 season calendar"
                        title="View 2026 season calendar"
                    >
                        <span aria-hidden="true">▦</span>
                        <span>CALENDAR</span>
                    </button>
                </div>
                <h4>${E(next?.name || "SEASON COMPLETE")}</h4>
                <p>${E(next?.location || "—")} / ${E(next?.date || "—")}</p>
                <div class="overview-next-countdown" id="overviewNextCountdown" aria-live="polite"></div>
            </div>
            <div class="overview-next-arrow">↗</div>
        </article>
    </section>

    <section class="overview-championship">
        <div class="overview-section-intro">
            <span class="overview-eyebrow">THE TITLE FIGHT</span>
            <h3>THE FRONT<br><i>RUNNERS.</i></h3>
            <p>The five drivers currently carrying the championship fight.</p>
        </div>
        <div class="overview-column">
            <span class="overview-column-label">DRIVERS</span>
            ${standings(phase2State.drivers, 5)}
        </div>
        <div class="overview-column">
            <span class="overview-column-label">CONSTRUCTORS</span>
            ${teamStandings(phase2State.teams, 5)}
        </div>
    </section>`;

  phase2RenderNextRaceCountdown(next);

  const driverFeatures = phase2State.drivers
    .slice(0, 3)
    .map(
      (d, i) =>
        `<article class="drivers-feature-row drivers-feature-${i + 1}" style="--driver-accent:${phase2TeamColor(d.team)}"><span class="drivers-feature-pos">${String(i + 1).padStart(2, "0")}</span><div class="drivers-feature-copy"><span class="rev-eyebrow">${i === 0 ? "CHAMPIONSHIP LEADER" : "TITLE CONTENDER"} / ${E(d.team)}</span><h3>${E(d.name)}</h3></div>${I(d.name) ? `<img src="${E(I(d.name))}" alt="${E(d.name)}">` : ``}<strong class="drivers-feature-points"><span>${P(d.points)}<small>PTS</small></span></strong></article>`,
    )
    .join("");
  const remainingDrivers = phase2State.drivers
    .slice(3)
    .map(
      (d, i) =>
        `<article class="drivers-roster-row"><span class="drivers-roster-pos">${String(i + 4).padStart(2, "0")}</span><div class="drivers-roster-driver"><span>${E(d.team)}</span><h4>${E(d.name)}</h4></div><div class="drivers-roster-number">#${E(d.number)}</div><strong class="drivers-roster-score"><span>${P(d.points)} <small>PTS</small></span></strong></article>`,
    )
    .join("");
  document.getElementById("driversContent").innerHTML =
    `<section class="drivers-hero" style="--driver-accent:${phase2TeamColor(leader?.team)}"><div class="drivers-hero-watermark">01</div><div class="drivers-hero-copy"><span class="rev-eyebrow">01 / THE CHAMPIONSHIP LEADER</span><h2>${E(leader?.name || "—")}</h2><p>${E(leader?.team || "—")} / ${P(leader?.points)} POINTS</p></div></section><section class="drivers-featured"><div class="drivers-section-intro"><span class="rev-eyebrow">THE TITLE FIGHT</span><h3>THREE<br><i>FRONT-RUNNERS.</i></h3><p>The drivers currently setting the pace of the 2026 championship.</p></div><div class="drivers-feature-list">${driverFeatures}</div></section><section class="drivers-grid-section"><div class="drivers-section-intro"><span class="rev-eyebrow">THE PURSUIT</span><h3>THE<br><i>GRID.</i></h3><p>Every driver. Every point. Every position.</p></div><div class="drivers-roster">${remainingDrivers}</div></section>`;

  document.getElementById("teamsContent").innerHTML =
    `<section class="rev-teams-intro"><span class="rev-eyebrow">THE CONSTRUCTOR CHAMPIONSHIP</span><h2>ELEVEN TEAMS.<br><i>ONE CROWN.</i></h2><p>Engineering. Strategy. Two drivers. One result.</p></section><section class="rev-teams-roster">${phase2State.teams
      .map((t, i) => {
        const pair = phase2State.drivers
          .filter((d) => d.team === t.name)
          .slice(0, 2);
        return `<article class="rev-team-feature ${phase2TeamClass(t.name)}"><span class="rev-pos">${String(i + 1).padStart(2, "0")}</span><div class="rev-team-title"><span class="rev-eyebrow">CONSTRUCTOR</span><h3>${E(t.name)}</h3><div class="rev-team-pair">${pair.map((d) => `<span>${E(d.name)} <b>${P(d.points)}</b></span>`).join("")}</div></div><div class="rev-team-visual">${pair.map((d) => (I(d.name) ? `<img src="${E(I(d.name))}" alt="${E(d.name)}">` : ``)).join("")}</div><strong class="rev-team-score"><span>${P(t.points)}<small>PTS</small></span></strong></article>`;
      })
      .join("")}</section>`;

  const championshipDrivers = phase2State.drivers
    .map(
      (d, i) =>
        `<article class="championship-standing-row team-${phase2TeamClass(d.team)}"><span class="championship-standing-accent"></span><span class="championship-standing-pos">${String(i + 1).padStart(2, "0")}</span><div class="championship-standing-driver"><strong>${E(d.name)}</strong><span>${E(d.team || "—")}</span></div><b class="championship-standing-score"><span>${P(d.points)}<small>PTS</small></span></b></article>`,
    )
    .join("");
  const championshipTeams = phase2State.teams
    .map(
      (t, i) =>
        `<article class="championship-standing-row championship-team-row team-${phase2TeamClass(t.name)}"><span class="championship-standing-accent"></span><span class="championship-standing-pos">${String(i + 1).padStart(2, "0")}</span><div class="championship-standing-driver"><strong>${E(t.name)}</strong></div><b class="championship-standing-score"><span>${P(t.points)}<small>PTS</small></span></b></article>`,
    )
    .join("");
  document.getElementById("championshipContent").innerHTML = `
        <section class="championship-hero">
            <div class="championship-hero-watermark">2026</div>
            <div class="championship-hero-copy">
                <span class="rev-eyebrow">2026 / WORLD CHAMPIONSHIP</span>
                <h2>EVERY<br>POINT<br><i>COUNTS.</i></h2>
                <p>Every point changes the championship. Every round changes the fight.</p>
                <div class="championship-leader">
                    <span>CURRENT LEADER</span>
                    <strong>${E(leader?.name || "—")}</strong>
                    <b>${P(leader?.points)} <small>PTS</small></b>
                </div>
            </div>
        </section>

        <section class="championship-history">
            <div class="championship-history-heading">
                <div>
                    <span class="rev-eyebrow">POSITION HISTORY</span>
                    <h3>DRIVER POSITION<br><i>THROUGH THE SEASON.</i></h3>
                    <p>Track a driver's race position across every completed Grand Prix using OpenF1 position data.</p>
                </div>
                <label class="championship-driver-control">
                    <span>SELECT DRIVER</span>
                    <select id="championshipDriverSelect"></select>
                </label>
            </div>
            <div id="championshipHistoryContent" class="championship-history-content">
                <div class="position-history-loading">LOADING POSITION HISTORY FROM OPENF1</div>
            </div>
        </section>

        <section class="championship-standings">
            <div class="championship-column">
                <span class="rev-eyebrow">01 / DRIVERS</span>
                <h3>THE DRIVER<br><i>CHAMPIONSHIP.</i></h3>
                <div class="championship-standing-list">${championshipDrivers}</div>
            </div>
            <div class="championship-column">
                <span class="rev-eyebrow">02 / CONSTRUCTORS</span>
                <h3>THE TEAM<br><i>CHAMPIONSHIP.</i></h3>
                <div class="championship-standing-list">${championshipTeams}</div>
            </div>
        </section>
    `;

  const historySelect = document.getElementById("championshipDriverSelect");
  if (historySelect) {
    historySelect.addEventListener("change", () => {
      phase2State.selectedHistoryDriver = Number(historySelect.value);
      phase2RenderChampionshipHistory();
    });
  }

  phase2RenderChampionshipHistory();
}

function phase2TeamColor(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("mercedes")) return "#00d2be";
  if (n.includes("ferrari")) return "#e10600";
  if (n.includes("mclaren")) return "#ff8700";
  if (n.includes("red bull")) return "#3671c6";
  if (n.includes("racing bulls")) return "#6a91e8";
  if (n.includes("aston")) return "#358c73";
  if (n.includes("alpine")) return "#ff86ba";
  if (n.includes("williams")) return "#36a8ed";
  if (n.includes("audi")) return "#d40000";
  if (n.includes("haas")) return "#9e9e9e";
  return "#a1a1a1";
}
function bindMobileNavigation() {
  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const mobileNavMenu = document.querySelector(".mobile-dashboard-menu");
  const navbar = document.querySelector(".navbar");
  if (!mobileNavToggle || mobileNavToggle.dataset.bound === "true") return;
  mobileNavToggle.dataset.bound = "true";

  mobileNavToggle.addEventListener("click", () => {
    const isOpen = navbar?.classList.toggle("mobile-nav-open") ?? false;
    mobileNavToggle.setAttribute("aria-expanded", String(isOpen));
    mobileNavMenu?.setAttribute("aria-hidden", String(!isOpen));
  });

  document.addEventListener("click", (event) => {
    if (!navbar?.classList.contains("mobile-nav-open")) return;
    if (navbar.contains(event.target)) return;
    navbar.classList.remove("mobile-nav-open");
    mobileNavToggle.setAttribute("aria-expanded", "false");
    mobileNavMenu?.setAttribute("aria-hidden", "true");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    navbar?.classList.remove("mobile-nav-open");
    mobileNavToggle.setAttribute("aria-expanded", "false");
    mobileNavMenu?.setAttribute("aria-hidden", "true");
  });
}

async function phase2Initialize() {
  bindMobileNavigation();
  replayBind();
  phase2BindCalendarModal();
  const savedTab = (() => {
    try {
      return sessionStorage.getItem("f1_active_tab");
    } catch (error) {
      return null;
    }
  })();
  const validTabs = [
    "overview",
    "drivers",
    "teams",
    "championship",
    "replay",
    "race",
  ];
  setDashboardTab(validTabs.includes(savedTab) ? savedTab : "overview");

  document.querySelector(".f1-logo")?.addEventListener("click", () => {
    document.querySelector(".navbar")?.classList.remove("mobile-nav-open");
    document
      .querySelector(".mobile-nav-toggle")
      ?.setAttribute("aria-expanded", "false");
    document
      .querySelector(".mobile-dashboard-menu")
      ?.setAttribute("aria-hidden", "true");
    setDashboardTab("overview");
  });

  document
    .querySelectorAll(".dashboard-tab, .mobile-dashboard-tab")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        document.querySelector(".navbar")?.classList.remove("mobile-nav-open");
        document
          .querySelector(".mobile-nav-toggle")
          ?.setAttribute("aria-expanded", "false");
        document
          .querySelector(".mobile-dashboard-menu")
          ?.setAttribute("aria-hidden", "true");
        setDashboardTab(button.dataset.dashboard);
        if (
          button.dataset.dashboard !== "race" &&
          !phase2State.loaded &&
          !phase2State.loading
        ) {
          try {
            await phase2LoadSeasonData();
          } catch (error) {
            console.error("Phase 2 season data failed:", error);
            const message = String(error.message || error);
            phase2RenderUnavailable(
              message || "OpenF1 could not provide the latest standings.",
            );
          }
        }

        if (button.dataset.dashboard === "championship" && phase2State.loaded) {
          phase2LoadPositionHistory();
        }
      });
    });

  document.getElementById("overviewContent").innerHTML = `
        <div class="overview-hero preview">
            <article class="overview-leader"><div class="overview-leader-copy"><span class="overview-kicker">CHAMPIONSHIP LEADER</span><h2>Loading</h2></div></article>
            <div class="overview-race-stack"><article class="overview-next"><span class="overview-kicker">SEASON DATA</span><h3>Syncing OpenF1</h3></article><article class="overview-next"><span class="overview-kicker">PLEASE WAIT</span><h3>Building the 2026 dashboard</h3></article></div>
        </div>
    `;

  try {
    await phase2LoadSeasonData();
  } catch (error) {
    console.error("Phase 2 season data failed:", error);
    const message = String(error.message || error);
    phase2RenderUnavailable(
      message || "OpenF1 could not provide the latest standings.",
    );
  }
}

/* =====================================================
   BACK TO TOP
===================================================== */

const backToTop = document.getElementById("backToTop");

function updateBackToTop() {
  if (!backToTop) return;

  backToTop.classList.toggle("visible", window.scrollY > 180);
}

window.addEventListener("scroll", updateBackToTop, { passive: true });

backToTop?.addEventListener("click", () => {
  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
});

updateBackToTop();

/* =====================================================
   OPENF1 RACE STATE
===================================================== */

let races = [];
let activeRaceSession = "race";
let raceSelectionVersion = 0;

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
    practice1Sessions,
    practice2Sessions,
    practice3Sessions,
  ] = await Promise.all([
    fetchOpenF1("meetings", { year: 2026 }),
    fetchOpenF1("sessions", { year: 2026, session_name: "Race" }),
    fetchOpenF1("sessions", { year: 2026, session_name: "Qualifying" }),
    fetchOpenF1("sessions", { year: 2026, session_name: "Sprint" }),
    fetchOpenF1("sessions", { year: 2026, session_name: "Sprint Qualifying" }),
    fetchOpenF1("sessions", { year: 2026, session_name: "Practice 1" }),
    fetchOpenF1("sessions", { year: 2026, session_name: "Practice 2" }),
    fetchOpenF1("sessions", { year: 2026, session_name: "Practice 3" }),
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

  const practiceByMeeting = new Map();
  [
    ["practice1", practice1Sessions, "Practice 1"],
    ["practice2", practice2Sessions, "Practice 2"],
    ["practice3", practice3Sessions, "Practice 3"],
  ].forEach(([type, sessions, name]) => {
    sessions
      .filter(
        (session) => session.session_name === name && !session.is_cancelled,
      )
      .forEach((session) => {
        if (!practiceByMeeting.has(session.meeting_key)) {
          practiceByMeeting.set(session.meeting_key, {});
        }
        practiceByMeeting.get(session.meeting_key)[type] = session;
      });
  });

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
      const practiceSessions = practiceByMeeting.get(meeting.meeting_key) || {};
      const practice1Session = practiceSessions.practice1 || null;
      const practice2Session = practiceSessions.practice2 || null;
      const practice3Session = practiceSessions.practice3 || null;
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
        practice1SessionKey: practice1Session?.session_key || null,
        practice1DateStart: practice1Session?.date_start || null,
        practice1DateEnd: practice1Session?.date_end || null,
        practice1Status: practice1Session
          ? getSessionStatus(meeting, practice1Session)
          : null,
        practice2SessionKey: practice2Session?.session_key || null,
        practice2DateStart: practice2Session?.date_start || null,
        practice2DateEnd: practice2Session?.date_end || null,
        practice2Status: practice2Session
          ? getSessionStatus(meeting, practice2Session)
          : null,
        practice3SessionKey: practice3Session?.session_key || null,
        practice3DateStart: practice3Session?.date_start || null,
        practice3DateEnd: practice3Session?.date_end || null,
        practice3Status: practice3Session
          ? getSessionStatus(meeting, practice3Session)
          : null,
        practiceResults: {},
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
  if (!LOADER_DEV_MODE) loaderStatus.textContent = "CONNECTING TO OPENF1";

  try {
    const liveRaces = await loadOpenF1Calendar();

    if (!liveRaces.length) {
      throw new Error("No 2026 meetings returned");
    }

    races = liveRaces;
    const navigationControls = document.querySelector(".navigation-controls");
    if (navigationControls) navigationControls.hidden = false;
    if (emptyState) emptyState.hidden = false;
    if (!LOADER_DEV_MODE) loaderStatus.textContent = "BUILDING 2026 CALENDAR";
    raceTrack.innerHTML = "";
    buildRaceSelector();

    setLoaderProgress(70);
    if (!LOADER_DEV_MODE) loaderStatus.textContent = "RACE DATA READY";

    await new Promise((resolve) => setTimeout(resolve, 180));

    setLoaderProgress(100);

    return true;
  } catch (error) {
    console.error("OpenF1 initialization failed:", error);
    setLoaderProgress(100);
    if (!LOADER_DEV_MODE) loaderStatus.textContent = "OFFLINE DATA READY";
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
const practiceResultsSection = document.getElementById(
  "practiceResultsSection",
);
const practiceSessionSelector = document.getElementById(
  "practiceSessionSelector",
);
const practiceResultsVisible = document.getElementById(
  "practiceResultsVisible",
);
const practiceResultsRemaining = document.getElementById(
  "practiceResultsRemaining",
);
const practiceResultsMore = document.getElementById("practiceResultsMore");
let activePracticeType = "practice1";

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

const LOADER_DEV_MODE = false;

const pageLoader = document.getElementById("pageLoader");
const loaderProgressBar = document.getElementById("loaderProgressBar");
const loaderPercentage = document.getElementById("loaderPercentage");
const loaderStatus = document.getElementById("loaderStatus");
const loaderCar = document.getElementById("loaderCar");
if (LOADER_DEV_MODE) {
  loaderStatus.textContent = "INITIALIZING RACE DATA";
  setTimeout(() => setLoaderProgress(0), 0);
}

function setLoaderProgress(percentage) {
  const progress = LOADER_DEV_MODE ? 0 : Math.max(0, Math.min(100, percentage));
  loaderProgressBar.style.width = `${progress}%`;
  loaderPercentage.textContent = `${progress}%`;

  const trackWidth = loaderProgressBar.parentElement.clientWidth;
  const carWidth = loaderCar.offsetWidth;
  const isMobile = window.matchMedia("(max-width: 600px)").matches;
  const startOffset = isMobile ? 0 : -46;
  const endOffset = isMobile ? 0 : 23;

  const start = startOffset;
  const end = trackWidth - carWidth + endOffset;

  loaderCar.style.left = `${start + (end - start) * (progress / 100)}px`;
}

window.addEventListener("resize", () => {
  const currentProgress = Number.parseFloat(loaderPercentage.textContent) || 0;
  setLoaderProgress(currentProgress);
});

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
    if (!LOADER_DEV_MODE) pageLoader.classList.add("hidden");
    return;
  }

  let loaded = 0;

  const updateProgress = () => {
    loaded++;
    const percentage = Math.round((loaded / total) * 40);
    setLoaderProgress(percentage);
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
  const selectionVersion = ++raceSelectionVersion;
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
  resetPracticeResults(race);

  /* ---------------------------------------------
       Render immediately, then hydrate from OpenF1
    --------------------------------------------- */

  await selectRaceSession(race, "race", selectionVersion);

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

async function selectRaceSession(
  race,
  sessionType,
  selectionVersion = raceSelectionVersion,
) {
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

  if (practiceResultsSection) {
    practiceResultsSection.hidden =
      isSprint ||
      !["practice1", "practice2", "practice3"].some(
        (type) => practiceSessionInfo(race, type)?.key,
      );
  }

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
  void loadRaceStrategyData(race, sessionType, selectionVersion);

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
      if (selectionVersion !== raceSelectionVersion) return;
      if (activeRaceSession !== "sprint") return;
    }

    if (activeRaceSession !== "sprint") return;

    renderPodium(race, "sprint");
    renderRaceClassification(race, "sprint");
    renderQualifying(race, "sprint");
    renderFastestLap(race, "sprint");
    const sprintStrategy = race.strategyBySession?.sprint;
    if (sprintStrategy?.loaded)
      renderRaceStrategy(race, "sprint", sprintStrategy);
    return;
  }

  renderStartingGridFinish(race);

  if (race.status === "COMPLETED" && race.sessionKey && !race.podium) {
    raceStatusLabel.textContent = "LOADING RESULT";
    raceStatus.textContent = "SYNCING";

    try {
      await loadRaceDetails(race);
      if (selectionVersion !== raceSelectionVersion) return;
      if (activeRaceSession !== "race") return;
      renderPodium(race, "race");
      renderRaceClassification(race, "race");
      renderQualifying(race, "race");
      renderFastestLap(race, "race");
      renderStartingGridFinish(race);
      const raceStrategy = race.strategyBySession?.race;
      if (raceStrategy?.loaded) renderRaceStrategy(race, "race", raceStrategy);
      raceStatusLabel.textContent = race.status;
      raceStatus.textContent = race.status;
    } catch (error) {
      console.error("OpenF1 race detail load failed:", error);
      if (selectionVersion !== raceSelectionVersion) return;
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
   PRACTICE RESULTS (OPT-IN)
===================================================== */

function practiceSessionInfo(race, type) {
  const config = {
    practice1: {
      key: race.practice1SessionKey,
      status: race.practice1Status,
      label: "P1",
      name: "Practice 1",
    },
    practice2: {
      key: race.practice2SessionKey,
      status: race.practice2Status,
      label: "P2",
      name: "Practice 2",
    },
    practice3: {
      key: race.practice3SessionKey,
      status: race.practice3Status,
      label: "P3",
      name: "Practice 3",
    },
  };
  return config[type] || null;
}

function resetPracticeResults(race) {
  if (!practiceResultsSection) return;

  const available = ["practice1", "practice2", "practice3"]
    .map((type) => practiceSessionInfo(race, type))
    .filter((session) => session?.key);

  practiceResultsSection.hidden = available.length === 0;

  if (practiceSessionSelector) {
    practiceSessionSelector.hidden = true;
    practiceSessionSelector.innerHTML = "";
  }

  if (practiceResultsVisible) {
    practiceResultsVisible.innerHTML = "";
  }

  if (practiceResultsRemaining) {
    practiceResultsRemaining.innerHTML = "";
    practiceResultsRemaining.hidden = true;
  }

  if (practiceResultsMore) {
    practiceResultsMore.hidden = true;
    practiceResultsMore.textContent = "VIEW MORE";
  }

  activePracticeType =
    ["practice1", "practice2", "practice3"].find(
      (type) => practiceSessionInfo(race, type)?.key,
    ) || "practice1";

  if (available.length) {
    renderPracticeSessionSelector(race);
    loadPracticeResults(race, activePracticeType);
  }
}

function renderPracticeSessionSelector(race) {
  if (!practiceSessionSelector) return;
  const available = ["practice1", "practice2", "practice3"]
    .map((type) => ({ type, ...practiceSessionInfo(race, type) }))
    .filter((session) => session.key);
  practiceSessionSelector.hidden = available.length <= 1;
  practiceSessionSelector.innerHTML = available
    .map(
      (session) => `
    <button class="session-selector-button${session.type === activePracticeType ? " active" : ""}" type="button" data-practice-type="${session.type}" aria-pressed="${session.type === activePracticeType}">${session.label}</button>
  `,
    )
    .join("");
}

function formatPracticeResultTime(result) {
  const raw = Array.isArray(result.duration)
    ? result.duration.find(
        (value) => value !== null && value !== undefined && value !== "",
      )
    : result.duration;
  if (raw !== null && raw !== undefined && raw !== "") {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? formatLapTime(numeric) : String(raw);
  }
  return formatRaceGap(result.gap_to_leader) || "—";
}

async function loadPracticeResults(race, type) {
  const session = practiceSessionInfo(race, type);
  if (!session?.key) return;
  race.practiceResults ||= {};
  race.practiceResultsLoading ||= {};
  if (race.practiceResults[type]) {
    renderPracticeResults(race, type);
    return;
  }
  if (session.status !== "COMPLETED") {
    renderPracticeResultsMessage(
      `${session.name.toUpperCase()} RESULTS AVAILABLE AFTER THE SESSION`,
    );
    return;
  }
  if (race.practiceResultsLoading[type]) {
    await race.practiceResultsLoading[type];
    renderPracticeResults(race, type);
    return;
  }

  renderPracticeResultsMessage(`LOADING ${session.name.toUpperCase()} RESULTS`);
  race.practiceResultsLoading[type] = (async () => {
    const [results, drivers] = await Promise.all([
      fetchOpenF1("session_result", { session_key: session.key }),
      fetchOpenF1("drivers", { session_key: session.key }).catch(() => []),
    ]);
    const driverByNumber = new Map(
      drivers.map((driver) => [Number(driver.driver_number), driver]),
    );
    const fallbackDriverMap = new Map(
      phase2State.drivers.map((driver) => [
        Number(driver.number),
        {
          driver_number: driver.number,
          full_name: driver.name,
          team_name: driver.team,
        },
      ]),
    );
    fallbackDriverMap.forEach((driver, number) => {
      if (!driverByNumber.has(number)) driverByNumber.set(number, driver);
    });
    race.practiceResults[type] = (Array.isArray(results) ? results : [])
      .filter((result) => Number.isFinite(Number(result.position)))
      .sort((a, b) => Number(a.position) - Number(b.position))
      .map((result) => {
        const driver = driverByNumber.get(Number(result.driver_number)) || {};
        return {
          position: Number(result.position),
          number: result.driver_number,
          driver: driver.full_name || `Driver #${result.driver_number}`,
          team: driver.team_name || "—",
          class: getTeamClass(driver.team_name),
          color: driver.team_colour
            ? `#${String(driver.team_colour).replace(/^#/, "")}`
            : null,
          time: formatPracticeResultTime(result),
          dnf: result.dnf,
          dns: result.dns,
          dsq: result.dsq,
        };
      });
  })();

  try {
    await race.practiceResultsLoading[type];
    if (race.practiceResults[type]?.length) renderPracticeResults(race, type);
    else
      renderPracticeResultsMessage(
        `${session.name.toUpperCase()} RESULTS ARE NOT AVAILABLE FROM OPENF1 YET`,
      );
  } catch (error) {
    console.warn(`${session.name} results unavailable:`, error);
    renderPracticeResultsMessage(
      `${session.name.toUpperCase()} RESULTS UNAVAILABLE`,
    );
  } finally {
    delete race.practiceResultsLoading[type];
  }
}

function renderPracticeResultsMessage(message) {
  if (practiceResultsVisible)
    practiceResultsVisible.innerHTML = `<div class="classification-row upcoming-classification"><span class="classification-row-position">—</span><div><strong>${message}</strong><span>OpenF1 session data</span></div><span>—</span></div>`;
  if (practiceResultsRemaining) {
    practiceResultsRemaining.innerHTML = "";
    practiceResultsRemaining.hidden = true;
  }
  if (practiceResultsMore) practiceResultsMore.hidden = true;
}

function renderPracticeResults(race, type) {
  if (
    !practiceResultsVisible ||
    !practiceResultsRemaining ||
    !practiceResultsMore
  )
    return;

  const results = race.practiceResults?.[type] || [];

  const renderRow = (driver) => `
    <div class="classification-row team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
      <span class="classification-row-position">${String(driver.position).padStart(2, "0")}</span>
      <div><strong>${phase2Escape(driver.driver)}</strong><span>${phase2Escape(driver.team)}</span></div>
      <span>${phase2Escape(driver.dsq ? "DSQ" : driver.dnf ? "DNF" : driver.dns ? "DNS" : driver.time || "—")}</span>
    </div>
  `;

  const visible = results.slice(0, 3);
  const remaining = results.slice(3);

  practiceResultsVisible.innerHTML =
    visible.map(renderRow).join("") ||
    `<div class="classification-row upcoming-classification"><span class="classification-row-position">—</span><div><strong>No practice classification available</strong><span>OpenF1</span></div><span>—</span></div>`;

  practiceResultsRemaining.innerHTML = remaining.map(renderRow).join("");
  practiceResultsRemaining.hidden = true;
  practiceResultsMore.hidden = remaining.length === 0;
  practiceResultsMore.textContent = "VIEW MORE";

  practiceResultsMore.onclick = () => {
    const opening = practiceResultsRemaining.hidden;
    practiceResultsRemaining.hidden = !opening;
    practiceResultsMore.textContent = opening ? "VIEW LESS" : "VIEW MORE";
  };
}

practiceSessionSelector?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-practice-type]");
  if (!button) return;
  const selected = document.querySelector(".race-button.active");
  const race = selected ? races[Number(selected.dataset.index)] : null;
  if (!race) return;
  activePracticeType = button.dataset.practiceType;
  renderPracticeSessionSelector(race);
  await loadPracticeResults(race, activePracticeType);
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


                <h3 data-h2h-driver="${driver.number}">
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
                <strong data-h2h-driver="${driver.number}">${driver.driver}</strong>
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
                <strong data-h2h-driver="${driver.number}">${driver.driver}</strong>
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
            <div><strong data-h2h-driver="${driver.number}">${driver.driver}</strong><small>${driver.team}</small></div>
            <b>${driver.time}</b>
        </article>
    `;
}

function createQualifyingRow(driver) {
  return `
        <div class="qualifying-row team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
            <span>${String(driver.position).padStart(2, "0")}</span>
            <div>
                <strong data-h2h-driver="${driver.number}">${driver.driver}</strong>
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
  if (!race.qualifyingSessionKey) return [];

  try {
    const data = await fetchOpenF1("starting_grid", {
      session_key: race.qualifyingSessionKey,
    });

    if (!Array.isArray(data)) return [];

    return data
      .filter(
        (item) =>
          Number(item.session_key) === Number(race.qualifyingSessionKey) &&
          Number.isFinite(Number(item.position)) &&
          Number.isFinite(Number(item.driver_number)),
      )
      .sort((a, b) => Number(a.position) - Number(b.position));
  } catch (error) {
    console.warn("OpenF1 starting grid request failed:", race.name, error);
    return [];
  }
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
   TYRE STINTS AND PIT STRATEGY
===================================================== */

const raceStrategySection = document.getElementById("raceStrategySection");
const raceStrategyContent = document.getElementById("raceStrategyContent");

if (raceStrategyContent) {
  raceStrategyContent.addEventListener("click", (event) => {
    const viewMoreButton = event.target.closest(".pit-view-more");
    if (viewMoreButton) {
      const table = viewMoreButton
        .closest(".pit-strategy-block")
        ?.querySelector(".pit-strategy-table");
      if (!table) return;
      const expanded = viewMoreButton.getAttribute("aria-expanded") === "true";
      table.querySelectorAll(".pit-row-extra").forEach((row) => {
        row.hidden = expanded;
      });
      viewMoreButton.setAttribute("aria-expanded", String(!expanded));
      viewMoreButton.textContent = expanded
        ? "VIEW MORE STOPS"
        : "VIEW FEWER STOPS";
      return;
    }
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    const row = event.target.closest(".stint-driver-row");
    if (!row) return;
    const expanded = row.classList.toggle("mobile-expanded");
    row.setAttribute("aria-expanded", String(expanded));
  });
  raceStrategyContent.addEventListener("keydown", (event) => {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".stint-driver-row");
    if (!row) return;
    event.preventDefault();
    const expanded = row.classList.toggle("mobile-expanded");
    row.setAttribute("aria-expanded", String(expanded));
  });
}

function strategyEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function strategyCompoundClass(compound) {
  const value = String(compound || "unknown")
    .trim()
    .toLowerCase();
  if (value.includes("soft")) return "soft";
  if (value.includes("medium")) return "medium";
  if (value.includes("hard")) return "hard";
  if (value.includes("inter")) return "intermediate";
  if (value.includes("wet")) return "wet";
  return "unknown";
}

function strategyCompoundLabel(compound) {
  const value = String(compound || "Unknown").trim();
  const known = {
    SOFT: "SOFT",
    MEDIUM: "MEDIUM",
    HARD: "HARD",
    INTERMEDIATE: "INTERMEDIATE",
    WET: "WET",
  };
  return known[value.toUpperCase()] || value.toUpperCase();
}

function formatStrategyDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${seconds.toFixed(1)}s`;
}

function strategyDriverName(number, race, sessionType) {
  const results =
    sessionType === "sprint" ? race.sprintResults : race.raceResults;
  const result = results?.find(
    (item) => Number(item.number) === Number(number),
  );
  if (result?.driver) return result.driver;
  const driver = phase2State.drivers.find(
    (item) => Number(item.number) === Number(number),
  );
  return driver?.name || `Driver #${number}`;
}

function renderRaceStrategy(race, sessionType = "race", state = null) {
  if (!raceStrategySection || !raceStrategyContent) return;
  const sessionStatus =
    sessionType === "sprint" ? race.sprintStatus : race.status;
  raceStrategySection.hidden = false;

  if (sessionStatus !== "COMPLETED") {
    raceStrategyContent.innerHTML = `<div class="strategy-empty">${sessionStatus === "UPCOMING" || sessionStatus === "LIVE" ? "TYRE STINTS AND PIT STRATEGY WILL BE AVAILABLE AFTER THE SESSION." : "STRATEGY DATA IS NOT AVAILABLE FOR THIS SESSION."}</div>`;
    return;
  }

  if (!state) {
    raceStrategyContent.innerHTML =
      '<div class="strategy-loading">LOADING STINT AND PIT-STOP DATA</div>';
    return;
  }
  if (state.error) {
    raceStrategyContent.innerHTML =
      '<div class="strategy-empty">STRATEGY DATA COULD NOT BE LOADED. TRY SELECTING THIS SESSION AGAIN LATER.</div>';
    return;
  }

  const stints = (state.stints || []).filter(
    (item) =>
      Number.isFinite(Number(item.driver_number)) &&
      Number.isFinite(Number(item.lap_start)) &&
      Number.isFinite(Number(item.lap_end)) &&
      Number(item.lap_end) >= Number(item.lap_start),
  );
  const pits = (state.pits || []).filter(
    (item) =>
      Number.isFinite(Number(item.driver_number)) &&
      Number.isFinite(Number(item.lap_number)),
  );

  if (!stints.length && !pits.length) {
    raceStrategyContent.innerHTML =
      '<div class="strategy-empty">OPENF1 HAS NOT PROVIDED TYRE STINT OR PIT-STOP DATA FOR THIS SESSION.</div>';
    return;
  }

  const maxLap = Math.max(
    Number(sessionType === "sprint" ? race.sprintTotalLaps : race.totalLaps) ||
      0,
    ...stints.map((item) => Number(item.lap_end) || 0),
    ...pits.map((item) => Number(item.lap_number) || 0),
    1,
  );
  const resultData =
    sessionType === "sprint" ? race.sprintResults : race.raceResults;
  const resultByNumber = new Map(
    (resultData || []).map((item) => {
      const rawPosition = item.position;
      const numericPosition =
        rawPosition === null ||
        rawPosition === undefined ||
        String(rawPosition).trim() === ""
          ? NaN
          : Number(rawPosition);
      return [
        Number(item.number),
        {
          ...item,
          position:
            Number.isFinite(numericPosition) && numericPosition > 0
              ? numericPosition
              : null,
        },
      ];
    }),
  );
  const driverNumbers = [
    ...new Set([
      ...(resultData || []).map((item) => Number(item.number)),
      ...stints.map((item) => Number(item.driver_number)),
      ...pits.map((item) => Number(item.driver_number)),
    ]),
  ].filter(Number.isFinite);

  const driverTeam = (number) => {
    const result = resultByNumber.get(number);
    const fallback = phase2State.drivers.find(
      (item) => Number(item.number) === number,
    );
    return (
      result?.team ||
      result?.team_name ||
      fallback?.team ||
      fallback?.team_name ||
      "Team unavailable"
    );
  };
  const teamGroups = new Map();
  driverNumbers.forEach((number) => {
    const driverStints = stints
      .filter((item) => Number(item.driver_number) === number)
      .sort(
        (a, b) =>
          Number(a.stint_number || a.lap_start) -
          Number(b.stint_number || b.lap_start),
      );
    if (!driverStints.length) return;
    const team = driverTeam(number);
    if (!teamGroups.has(team)) teamGroups.set(team, []);
    teamGroups
      .get(team)
      .push({ number, driverStints, result: resultByNumber.get(number) });
  });
  const orderedTeams = [...teamGroups.entries()].sort(
    ([teamA, driversA], [teamB, driversB]) => {
      const positionsA = driversA
        .map((driver) => driver.result?.position)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const positionsB = driversB
        .map((driver) => driver.result?.position)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const bestA = positionsA[0] ?? Infinity;
      const bestB = positionsB[0] ?? Infinity;
      if (bestA !== bestB) return bestA - bestB;
      const sumA = positionsA.reduce((sum, position) => sum + position, 0);
      const sumB = positionsB.reduce((sum, position) => sum + position, 0);
      if (sumA !== sumB) return sumA - sumB;
      return teamA.localeCompare(teamB);
    },
  );

  const stintRows = orderedTeams
    .map(([team, teamDrivers], teamIndex) => {
      teamDrivers.sort((a, b) => {
        const positionA = a.result?.position ?? Infinity;
        const positionB = b.result?.position ?? Infinity;
        if (positionA !== positionB) return positionA - positionB;
        return a.number - b.number;
      });
      const teamClass = getTeamClass(team);
      const teamColor = phase2TeamColor(team) || "#555555";
      const rows = teamDrivers
        .map(({ number, driverStints, result }) => {
          const driverName = strategyDriverName(number, race, sessionType);
          const shortName = driverName.split(/\s+/).slice(-1)[0];
          const finishPosition = Number.isFinite(result?.position)
            ? `P${result.position}`
            : result?.dsq
              ? "DSQ"
              : result?.dns
                ? "DNS"
                : result?.dnf
                  ? "DNF"
                  : "DNF";
          const segments = driverStints
            .map((stint) => {
              const start = Math.max(1, Number(stint.lap_start));
              const end = Math.max(start, Number(stint.lap_end));
              const width = Math.max(0.8, ((end - start + 1) / maxLap) * 100);
              const compound = strategyCompoundLabel(stint.compound);
              return `<div class="stint-segment ${strategyCompoundClass(stint.compound)}" style="width:${width}%" title="${strategyEscape(`${compound}: laps ${start}–${end}`)}" aria-hidden="true"><span>${strategyEscape(compound)}</span><b>${start}–${end}</b></div>`;
            })
            .join("");
          const mobileDetails = driverStints
            .map((stint) => {
              const start = Math.max(1, Number(stint.lap_start));
              const end = Math.max(start, Number(stint.lap_end));
              const compound = strategyCompoundLabel(stint.compound);
              return `<span class="stint-mobile-detail"><i class="${strategyCompoundClass(stint.compound)}"></i><strong>${strategyEscape(compound)}</strong><span>Laps ${start}–${end}</span></span>`;
            })
            .join("");
          const total = driverStints.reduce(
            (sum, stint) =>
              sum +
              Math.max(0, Number(stint.lap_end) - Number(stint.lap_start) + 1),
            0,
          );
          return `<div class="stint-driver-row" tabindex="0" role="button" aria-expanded="false" aria-label="${strategyEscape(`${driverName}, ${finishPosition}. Tap to view tyre compounds and lap ranges`)}"><div class="stint-driver-name"><strong>${strategyEscape(shortName)}</strong><span class="stint-driver-finish">${finishPosition}</span><span>#${number}</span></div><div class="stint-timeline">${segments}</div><div class="stint-lap-total">${total} L</div><div class="stint-mobile-details">${mobileDetails}</div></div>`;
        })
        .join("");
      return `<section class="stint-team-group team-${strategyEscape(teamClass)}" style="--team-color:${strategyEscape(teamColor)}"><header class="stint-team-heading"><div><span class="stint-team-rank">${String(teamIndex + 1).padStart(2, "0")}</span><h4>${strategyEscape(team)}</h4></div></header>${rows}</section>`;
    })
    .join("");

  const sortedPits = pits
    .slice()
    .sort(
      (a, b) =>
        Number(a.lap_number) - Number(b.lap_number) ||
        Number(a.driver_number) - Number(b.driver_number),
    );
  const pitRows = sortedPits
    .map((pit, index) => {
      const number = Number(pit.driver_number);
      const name = strategyDriverName(number, race, sessionType);
      const stop = pit.pit_duration ?? null;
      const lapStints = stints
        .filter(
          (item) =>
            Number(item.driver_number) === number &&
            Number(item.lap_start) >= Number(pit.lap_number),
        )
        .sort((a, b) => Number(a.lap_start) - Number(b.lap_start));
      const nextStint = lapStints[0];
      const compound = nextStint
        ? strategyCompoundLabel(nextStint.compound)
        : "—";
      return `<div class="pit-strategy-row${index >= 5 ? " pit-row-extra" : ""}"${index >= 5 ? " hidden" : ""}><span class="pit-lap">L${Number(pit.lap_number)}</span><div class="pit-driver"><strong>${strategyEscape(name)}</strong><span>#${number}</span></div><span class="pit-duration">${formatStrategyDuration(stop)}</span><span class="pit-tyre">${strategyEscape(compound)}</span></div>`;
    })
    .join("");

  const stationaryPitRecords = sortedPits
    .map((pit) => ({
      pit,
      duration: Number(pit.stop_duration ?? pit.stopDuration),
    }))
    .filter(({ duration }) => Number.isFinite(duration) && duration > 0);
  const fastestDurationRecord =
    stationaryPitRecords.slice().sort((a, b) => a.duration - b.duration)[0] ||
    null;
  const fastestPit = fastestDurationRecord
    ? fastestDurationRecord.duration
    : null;
  const fastestPitRecord = fastestDurationRecord?.pit || null;
  const fastestPitDriver = fastestPitRecord
    ? strategyDriverName(
        Number(fastestPitRecord.driver_number),
        race,
        sessionType,
      )
    : "—";
  const averagePit = stationaryPitRecords.length
    ? stationaryPitRecords.reduce((sum, record) => sum + record.duration, 0) /
      stationaryPitRecords.length
    : null;
  const durationSourceNote = stationaryPitRecords.length
    ? `${stationaryPitRecords.length} stops with stationary-time data`
    : "Stationary stop times unavailable for this session";
  const stopCounts = new Map();
  sortedPits.forEach((pit) => {
    const number = Number(pit.driver_number);
    stopCounts.set(number, (stopCounts.get(number) || 0) + 1);
  });
  const mostStopsEntry = [...stopCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0] - b[0],
  )[0];
  const mostStopsName = mostStopsEntry
    ? strategyDriverName(mostStopsEntry[0], race, sessionType)
    : "—";
  const teamStopCounts = new Map();
  stopCounts.forEach((count, number) => {
    const team = driverTeam(number);
    if (!teamStopCounts.has(team)) teamStopCounts.set(team, []);
    teamStopCounts.get(team).push({ number, count });
  });
  const differingTeammates = [...teamStopCounts.entries()].find(
    ([, drivers]) =>
      drivers.length > 1 &&
      new Set(drivers.map((driver) => driver.count)).size > 1,
  );
  const strategyInsights = [];
  if (mostStopsEntry)
    strategyInsights.push(
      `<div class="strategy-insight"><span class="strategy-insight-kicker">MOST STOPS</span><strong>${strategyEscape(mostStopsName)}</strong><span>${mostStopsEntry[1]} recorded ${mostStopsEntry[1] === 1 ? "stop" : "stops"}</span></div>`,
    );
  const oneStopDrivers = [...stopCounts.entries()].filter(
    ([, count]) => count === 1,
  ).length;
  const twoStopDrivers = [...stopCounts.entries()].filter(
    ([, count]) => count === 2,
  ).length;
  if (oneStopDrivers || twoStopDrivers)
    strategyInsights.push(
      `<div class="strategy-insight"><span class="strategy-insight-kicker">STOP COUNT</span><strong>${oneStopDrivers} one-stop · ${twoStopDrivers} two-stop</strong><span>Among drivers with recorded pit stops</span></div>`,
    );
  if (differingTeammates) {
    const [team, drivers] = differingTeammates;
    const high = drivers.slice().sort((a, b) => b.count - a.count)[0];
    const low = drivers.slice().sort((a, b) => a.count - b.count)[0];
    strategyInsights.push(
      `<div class="strategy-insight"><span class="strategy-insight-kicker">TEAMMATE SPLIT</span><strong>${strategyEscape(team)}</strong><span>${strategyEscape(strategyDriverName(high.number, race, sessionType))}: ${high.count} stops · ${strategyEscape(strategyDriverName(low.number, race, sessionType))}: ${low.count}</span></div>`,
    );
  }

  const compoundCounts = new Map();
  stints.forEach((stint) => {
    const compound = strategyCompoundLabel(stint.compound);
    compoundCounts.set(compound, (compoundCounts.get(compound) || 0) + 1);
  });
  const legend = [...compoundCounts.keys()]
    .map(
      (compound) =>
        `<span class="stint-legend-item"><i class="${strategyCompoundClass(compound)}"></i>${strategyEscape(compound)}</span>`,
    )
    .join("");

  raceStrategyContent.innerHTML = `
    <div class="strategy-summary"><span>${driverNumbers.length} DRIVERS TRACKED</span><span>${stints.length} RECORDED STINTS</span><span>${pits.length} RECORDED STOPS</span></div>
    <div class="strategy-block"><div class="strategy-block-heading"><div><span class="eyebrow">COMPOUND USAGE</span><h3>Tyre stint timeline</h3></div><div class="stint-legend">${legend}</div></div>
      <div class="stint-lap-axis"><span>DRIVER</span><div><span>LAP 1</span><span>LAP ${maxLap}</span></div><span>TOTAL</span></div>
      <div class="stint-timeline-list">${stintRows || '<div class="strategy-empty">NO VALID TYRE STINT RECORDS FOR THIS SESSION.</div>'}</div>
    </div>
    <div class="strategy-pit-overview">
      <div class="strategy-block-heading strategy-overview-heading"><div><span class="eyebrow">PIT LANE ANALYSIS</span><h3>Pit-stop overview</h3></div></div>
      <div class="strategy-stat-grid">
        <article class="strategy-stat-card"><span>FASTEST PIT STOP</span><strong>${fastestPit === null ? "—" : `${fastestPit.toFixed(2)}s`}</strong><small>${fastestPit === null ? "Stationary stop time unavailable" : `${strategyEscape(fastestPitDriver)} · Lap ${Number(fastestPitRecord.lap_number)}`}</small></article>
        <article class="strategy-stat-card"><span>AVERAGE STOP</span><strong>${averagePit === null ? "—" : `${averagePit.toFixed(2)}s`}</strong><small>${durationSourceNote}</small></article>
        <article class="strategy-stat-card"><span>TOTAL STOPS</span><strong>${pits.length}</strong><small>Recorded pit-stop events</small></article>
        <article class="strategy-stat-card"><span>STOP COUNT</span><strong>${oneStopDrivers} one-stop · ${twoStopDrivers} two-stop</strong><small>Among drivers with recorded pit stops</small></article>
      </div>
      
      <div class="strategy-block pit-strategy-block"><div class="strategy-block-heading"><div><span class="eyebrow">LAP-BY-LAP RECORD</span><h3>Pit-stop timeline</h3></div><span class="strategy-block-note">${pits.length} STOPS RECORDED</span></div>
      ${pits.length ? `<div class="pit-strategy-table"><div class="pit-strategy-head"><span>LAP</span><span>DRIVER</span><span>PIT LANE</span><span>NEXT TYRE</span></div>${pitRows}</div>${pits.length > 5 ? '<button type="button" class="pit-view-more" aria-expanded="false">VIEW MORE STOPS</button>' : ""}` : '<div class="strategy-empty">NO PIT-STOP RECORDS WERE RETURNED FOR THIS SESSION.</div>'}
    </div>
    </div>
    <p class="strategy-footnote">${stationaryPitRecords.length ? "Fastest and average pit stops use stationary stop_duration values only. The lap-by-lap table shows pit-lane time separately." : "OpenF1 did not supply stationary stop_duration values for this session. Pit-lane transit times are not substituted; fastest and average stationary stop times remain unavailable."}</p>`;
}

async function loadRaceStrategyData(race, sessionType, selectionVersion) {
  const sessionKey =
    sessionType === "sprint" ? race.sprintSessionKey : race.sessionKey;
  const sessionStatus =
    sessionType === "sprint" ? race.sprintStatus : race.status;
  if (!raceStrategySection || !raceStrategyContent) return;
  if (sessionStatus !== "COMPLETED" || !sessionKey) {
    renderRaceStrategy(race, sessionType);
    return;
  }

  race.strategyBySession ||= {};
  const cacheKey = String(sessionType);
  if (race.strategyBySession[cacheKey]?.loading) {
    renderRaceStrategy(race, sessionType, race.strategyBySession[cacheKey]);
    return race.strategyBySession[cacheKey].loading;
  }
  if (race.strategyBySession[cacheKey]?.loaded) {
    renderRaceStrategy(race, sessionType, race.strategyBySession[cacheKey]);
    return;
  }

  const state = (race.strategyBySession[cacheKey] = {
    loaded: false,
    stints: [],
    pits: [],
  });
  renderRaceStrategy(race, sessionType, state);
  state.loading = (async () => {
    const [stintsResult, pitsResult] = await Promise.allSettled([
      fetchOpenF1("stints", { session_key: sessionKey }),
      fetchOpenF1("pit", { session_key: sessionKey }),
    ]);
    if (stintsResult.status === "fulfilled")
      state.stints = Array.isArray(stintsResult.value)
        ? stintsResult.value
        : [];
    if (pitsResult.status === "fulfilled")
      state.pits = Array.isArray(pitsResult.value) ? pitsResult.value : [];

    try {
      const indexResponse = await fetch("/api/bigdataf1?raceId=jumper");

      if (!indexResponse.ok) {
        throw new Error(`BigDataF1 race index failed: ${indexResponse.status}`);
      }

      const raceIndex = await indexResponse.json();

      const raceYear = Number(race.year ?? race.season ?? 2026);
      const raceRound = Number(race.round);

      const matchingRace = raceIndex.races?.find(
        (item) =>
          Number(item.year) === raceYear && Number(item.round) === raceRound,
      );

      if (!matchingRace) {
        throw new Error(
          `BigDataF1 race not found for ${raceYear}, round ${raceRound}`,
        );
      }

      const bigDataResponse = await fetch(
        `/api/bigdataf1?raceId=${matchingRace.raceId}`,
      );

      if (bigDataResponse.ok) {
        const bigData = await bigDataResponse.json();
        const bigDataPitStops = bigData.details?.pitstops ?? [];

        const normalizePitDriverName = (value) =>
          String(value ?? "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");

        const stationaryTimes = new Map();

        for (const stop of bigDataPitStops) {
          stationaryTimes.set(
            `${normalizePitDriverName(stop.fullName)}:${Number(stop.lap)}`,
            Number(stop.time),
          );
        }

        state.pits = state.pits.map((pit) => {
          const driverName = strategyDriverName(
            Number(pit.driver_number),
            race,
            sessionType,
          );

          const duration = stationaryTimes.get(
            `${normalizePitDriverName(driverName)}:${Number(pit.lap_number)}`,
          );

          return {
            ...pit,
            stop_duration: Number.isFinite(duration) ? duration : null,
          };
        });
      }
    } catch (error) {
      console.warn("BigDataF1 pit-stop data unavailable:", error);
    }

    if (stintsResult.status === "rejected" && pitsResult.status === "rejected")
      state.error = true;
    state.loaded = true;
    state.loading = null;
    if (
      selectionVersion !== raceSelectionVersion ||
      activeRaceSession !== sessionType
    )
      return;
    renderRaceStrategy(race, sessionType, state);
  })();
  return state.loading;
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

  if (!LOADER_DEV_MODE) {
    pageLoader.classList.add("hidden");
    setTimeout(() => pageLoader.remove(), 650);
  }
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

const overviewDriverImages = {
  "Alexander Albon": "images/headshots/alex-albon.webp",
  "Arvid Lindblad": "images/headshots/arvid-lindblad.webp",
  "Carlos Sainz": "images/headshots/carlos-sainz.webp",
  "Charles Leclerc": "images/headshots/charles-leclerc.webp",
  "Esteban Ocon": "images/headshots/esteban-ocon.webp",
  "Fernando Alonso": "images/headshots/fernando-alonso.webp",
  "Franco Colapinto": "images/headshots/franco-colapinto.webp",
  "Gabriel Bortoleto": "images/headshots/gabriel-bortoleto.webp",
  "George Russell": "images/headshots/george-russell.webp",
  "Isack Hadjar": "images/headshots/isack-hadjar.webp",
  "Kimi Antonelli": "images/headshots/kimi-antonelli.webp",
  "Lance Stroll": "images/headshots/lance-stroll.webp",
  "Lando Norris": "images/headshots/lando-norris.webp",
  "Lewis Hamilton": "images/headshots/lewis-hamilton.webp",
  "Liam Lawson": "images/headshots/liam-lawson.webp",
  "Max Verstappen": "images/headshots/max-verstappen.webp",
  "Nico Hulkenberg": "images/headshots/nico-hulkenberg.webp",
  "Oliver Bearman": "images/headshots/oliver-bearman.webp",
  "Oscar Piastri": "images/headshots/oscar-piastri.webp",
  "Pierre Gasly": "images/headshots/pierre-gasly.webp",
  "Sergio Perez": "images/headshots/sergio-perez.webp",
  "Valtteri Bottas": "images/headshots/valtteri-bottas.webp",
  "Driver #22": "images/headshots/driver22.webp",
  "Yuki Tsunoda": "images/headshots/driver22.webp",
};

const overviewTeamImages = {
  Alpine: "images/teams/alpine.png",
  "Aston Martin": "images/teams/aston-martin.png",
  Audi: "images/teams/audi.png",
  Cadillac: "images/teams/cadillac.png",
  Ferrari: "images/teams/ferrari.png",
  Haas: "images/teams/haas.png",
  McLaren: "images/teams/mclaren.png",
  Mercedes: "images/teams/mercedes.png",
  "Racing Bulls": "images/teams/racing-bulls.png",
  "Red Bull Racing": "images/teams/red-bull.png",
  "Red Bull": "images/teams/red-bull.png",
  Williams: "images/teams/williams.png",
};

function overviewDriverImage(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const match = Object.entries(overviewDriverImages).find(
    ([driver]) =>
      driver.trim().toLowerCase().replace(/\s+/g, " ") === normalized,
  );
  return match ? match[1] : null;
}

function overviewTeamImage(name) {
  return overviewTeamImages[name] || null;
}

function phase2CalendarEvent(race, type) {
  const config = {
    practice1: { start: race.practice1DateStart, status: race.practice1Status },
    practice2: { start: race.practice2DateStart, status: race.practice2Status },
    practice3: { start: race.practice3DateStart, status: race.practice3Status },
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
  const labels = {
    practice1: "PRACTICE 1",
    practice2: "PRACTICE 2",
    practice3: "PRACTICE 3",
    sprintQualifying: "SPRINT QUALIFYING",
    sprint: "SPRINT",
    qualifying: "QUALIFYING",
    race: "RACE",
  };
  return labels[event.type] || "SESSION";
}

function phase2CalendarBadgeLabel(event) {
  const labels = {
    practice1: "P1",
    practice2: "P2",
    practice3: "P3",
    sprintQualifying: "SQ",
    sprint: "S",
    qualifying: "Q",
    race: "R",
  };
  return labels[event.type] || "S";
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
    const practiceEvents = events.filter((event) =>
      event.type.startsWith("practice"),
    );
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
      [
        raceEvent,
        qualifyingEvent,
        sprintQualifyingEvent,
        sprintEvent,
        ...practiceEvents,
      ].some((event) => event?.status === "completed")
    )
      classes.push("has-completed");
    if (
      [
        raceEvent,
        qualifyingEvent,
        sprintQualifyingEvent,
        sprintEvent,
        ...practiceEvents,
      ].some((event) => event?.status === "upcoming")
    )
      classes.push("has-upcoming");

    const labels = [];
    practiceEvents.forEach((event) => {
      labels.push(
        `<span class="season-calendar-event practice ${event.status}" title="${phase2Escape(event.race.shortName || event.race.name)} ${phase2CalendarDayLabel(event).toLowerCase()}">${phase2CalendarBadgeLabel(event)}</span>`,
      );
    });
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
      phase2CalendarEvent(race, "practice1"),
      phase2CalendarEvent(race, "practice2"),
      phase2CalendarEvent(race, "practice3"),
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
  const sessions = [
    {
      type: "practice1",
      start: race.practice1DateStart,
      label: "NEXT PRACTICE IN",
    },
    ...(!race.hasSprint
      ? [
          {
            type: "practice2",
            start: race.practice2DateStart,
            label: "NEXT PRACTICE IN",
          },
          {
            type: "practice3",
            start: race.practice3DateStart,
            label: "NEXT PRACTICE IN",
          },
        ]
      : []),
    ...(race.hasSprint
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
        ]
      : []),
    ...(!race.hasSprint
      ? [
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
        ]),
  ].sort((a, b) => {
    const aTime = Date.parse(a.start || "");
    const bTime = Date.parse(b.start || "");
    return (
      (Number.isFinite(aTime) ? aTime : Infinity) -
      (Number.isFinite(bTime) ? bTime : Infinity)
    );
  });

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

function phase2TeamLogo(name) {
  const team = phase2TeamClass(name);
  const logos = {
    mercedes: "mercedes",
    ferrari: "ferrari",
    mclaren: "mclaren",
    redbull: "red-bull",
    racingbulls: "racing-bulls",
    alpine: "alpine",
    haas: "haas",
    audi: "audi",
    williams: "williams",
    astonmartin: "aston-martin",
    cadillac: "cadillac",
  };
  return logos[team] ? `images/teams/${logos[team]}.png` : "";
}

/* =====================================================
   RACE REPLAY
===================================================== */

const replayState = {
  race: null,
  drivers: [],
  driverByNumber: new Map(),
  resultsByDriver: new Map(),
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
  if (timestamp < points[0].time) return null;
  if (timestamp > points[points.length - 1].time) return null;
  if (timestamp === points[0].time) return points[0];
  if (timestamp === points[points.length - 1].time)
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

function replayTrackDistance(a, b) {
  return Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
}

function replayCleanTrackLap(points) {
  const sorted = points
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y),
    )
    .slice()
    .sort((a, b) => a.time - b.time);
  if (sorted.length < 25) return [];

  const distances = [];
  for (let i = 1; i < sorted.length; i++) {
    const distance = replayTrackDistance(sorted[i - 1], sorted[i]);
    if (Number.isFinite(distance) && distance > 0) distances.push(distance);
  }
  if (distances.length < 24) return [];
  distances.sort((a, b) => a - b);
  const medianDistance = distances[Math.floor(distances.length / 2)];
  const isHungary = /hungary|hungaroring/i.test(
    `${replayState.race?.shortName || ""} ${replayState.race?.location || ""} ${replayState.race?.name || ""}`,
  );
  const jumpLimit = isHungary ? 500 : Math.max(medianDistance * 8, 500);

  let bestSegment = [];
  let segment = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const distance = replayTrackDistance(sorted[i - 1], sorted[i]);
    if (!Number.isFinite(distance) || distance > jumpLimit) {
      if (segment.length > bestSegment.length) bestSegment = segment;
      segment = [sorted[i]];
    } else {
      segment.push(sorted[i]);
    }
  }
  if (segment.length > bestSegment.length) bestSegment = segment;
  return bestSegment.length >= 25 ? bestSegment : [];
}

function replayBuildTrack() {
  let best = null;
  const raceName = replayState.race?.shortName;
  const isMiami = raceName === "Miami";
  const isAzerbaijan = raceName === "Azerbaijan";

  for (const driver of replayState.drivers) {
    const points = replayState.locations.get(Number(driver.driver_number));
    const laps =
      replayState.lapsByDriver.get(Number(driver.driver_number)) || [];
    if (!points?.length || laps.length < 2) continue;

    const candidates = laps
      .map((lap, index) => ({ lap, nextLap: laps[index + 1] }))
      .filter(
        ({ lap, nextLap }) =>
          Number.isFinite(lap?.start) &&
          Number.isFinite(nextLap?.start) &&
          nextLap.start > lap.start &&
          Number(lap.lap_number) > 1,
      );

    for (const { lap, nextLap } of candidates) {
      const lapPoints = replayCleanTrackLap(
        points.filter(
          (point) => point.time >= lap.start && point.time < nextLap.start,
        ),
      );
      if (lapPoints.length < 25) continue;

      if (isMiami || isAzerbaijan) {
        const first = lapPoints[0];
        const last = lapPoints.at(-1);
        const endpointGap = Math.hypot(last.x - first.x, last.y - first.y);
        const score = lapPoints.length / (1 + endpointGap / 100);
        if (!best || score > best.score) best = { points: lapPoints, score };
      } else if (!best || lapPoints.length > best.length) {
        best = lapPoints;
      }
    }
  }

  if (!best) {
    replayState.trackPoints = [];
    replayState.trackStartPoint = null;
    replayState.trackStartDirection = null;
    return;
  }

  const selected = isMiami || isAzerbaijan ? best.points : best;
  const step = Math.max(1, Math.ceil(selected.length / 1200));
  replayState.trackPoints = selected.filter((_, index) => index % step === 0);
  replayState.trackStartPoint = replayState.trackPoints[0] || null;

  const isAustria = raceName === "Austria";
  const next = isAustria
    ? replayState.trackPoints.find(
        (point) =>
          point.x !== replayState.trackStartPoint?.x ||
          point.y !== replayState.trackStartPoint?.y,
      )
    : replayState.trackPoints[1];

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

function replayResultFlag(value) {
  return (
    value === true || value === 1 || String(value).toLowerCase() === "true"
  );
}

function replayDriverRetirementTime(driverNumber) {
  const locations = replayState.locations.get(Number(driverNumber)) || [];
  if (locations.length < 2) return null;

  let lastMovementTime = locations[0].time;
  let lastMovingPoint = locations[0];
  for (let index = 1; index < locations.length; index++) {
    const point = locations[index];
    const distance = Math.hypot(
      Number(point.x) - Number(lastMovingPoint.x),
      Number(point.y) - Number(lastMovingPoint.y),
      Number(point.z || 0) - Number(lastMovingPoint.z || 0),
    );
    if (Number.isFinite(distance) && distance > 8) {
      lastMovementTime = point.time;
      lastMovingPoint = point;
    }
  }
  return lastMovementTime;
}

function replayDriverStatus(driverNumber, timestamp) {
  const result = replayState.resultsByDriver.get(Number(driverNumber));
  if (!result) return null;
  if (replayResultFlag(result.dns)) return "DNS";
  if (!replayResultFlag(result.dnf)) return null;

  const retirementTime = replayDriverRetirementTime(driverNumber);
  if (!Number.isFinite(retirementTime)) return null;
  return Number.isFinite(timestamp) && timestamp > retirementTime + 15000
    ? "DNF"
    : null;
}

function replayDriverPosition(driver, timestamp) {
  if (replayDriverStatus(driver.driver_number, timestamp)) return null;
  const direct = replayLatestPosition(driver.driver_number, timestamp);
  if (direct !== null && direct !== undefined) return Number(direct);
  const lap = replayActiveLap(driver.driver_number, timestamp);
  return lap?.position ?? null;
}

function replayCurrentLeaderboard(timestamp) {
  return replayState.drivers
    .map((driver) => {
      const status = replayDriverStatus(driver.driver_number, timestamp);
      const position = status
        ? null
        : (replayDriverPosition(driver, timestamp) ??
          replayState.startingGrid.get(Number(driver.driver_number)) ??
          null);
      return { driver, position, status };
    })
    .sort((a, b) => {
      if (a.position !== null && b.position !== null)
        return a.position - b.position;
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      if (a.status && !b.status) return 1;
      if (!a.status && b.status) return -1;
      return replayDriverName(a.driver).localeCompare(
        replayDriverName(b.driver),
      );
    });
}

function replayVisibleDrivers(timestamp) {
  return replayCurrentLeaderboard(timestamp)
    .filter(({ status }) => status !== "DNS" && status !== "DNF")
    .map((item) => item.driver);
}

function replaySelectionLabel() {
  if (!replayState.selectedDrivers.length) return "ALL DRIVERS";
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
    const isAustria = replayState.race?.shortName === "Austria";
    const direction = isAustria
      ? replayState.trackStartDirection
      : {
          x: replayState.trackPoints[1].x - replayState.trackPoints[0].x,
          y: replayState.trackPoints[1].y - replayState.trackPoints[0].y,
        };
    const second = direction
      ? project({
          x: replayState.trackPoints[0].x + direction.x,
          y: replayState.trackPoints[0].y + direction.y,
        })
      : first;
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
    const selected = replayState.selectedDrivers.includes(
      Number(driver.driver_number),
    );
    const markerRadius = selected ? 11 : 8;
    const label = `${position ? `P${position} ` : ""}${replayDriverName(driver)}`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, markerRadius, 0, Math.PI * 2);
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
  const driverStatus = timingDriver
    ? replayDriverStatus(timingDriver.driver_number, replayState.currentTime)
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
  replayElements.positionCard.innerHTML = `<span>${driverStatus ? "STATUS" : "POSITION"}</span><strong>${driverStatus || (position ? `P${position}` : "—")}</strong>`;
  replayElements.clock.textContent = replayFormatClock(
    replayState.currentTime - replayState.startTime,
  );

  const leaderboard = replayCurrentLeaderboard(replayState.currentTime);
  replayElements.driverList.innerHTML = leaderboard
    .map(({ driver, position, status }) => {
      const selected = replayState.selectedDrivers.includes(
        Number(driver.driver_number),
      );
      const active =
        timingDriver &&
        Number(driver.driver_number) === Number(timingDriver.driver_number);
      const positionLabel = status || (position ? `P${position}` : "—");
      return `<button type="button" class="replay-driver-row${active ? " active" : ""}${selected ? " selected" : ""}${status ? " retired" : ""}" style="--replay-color:${replayDriverColor(driver)}" data-replay-driver="${Number(driver.driver_number)}"><i style="--replay-color:${replayDriverColor(driver)}"></i><span><b>${replayEscape(positionLabel)}</b> ${replayEscape(replayDriverName(driver))}</span><strong>${selected ? "SELECTED" : ""}</strong></button>`;
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
  replayState.resultsByDriver = new Map();
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
  replayElements.trackTitle.textContent =
    race.replaySessionType === "sprint" ? `${race.name} · SPRINT` : race.name;

  try {
    const [drivers, positions, laps, startingGrid, sessionResults] =
      await Promise.all([
        fetchOpenF1("drivers", { session_key: race.sessionKey }),
        fetchOpenF1("position", { session_key: race.sessionKey }),
        fetchOpenF1("laps", { session_key: race.sessionKey }),
        fetchOpenF1("starting_grid", {
          session_key: race.replayStartingGridKey || race.sessionKey,
        }).catch(() => []),
        fetchOpenF1("session_result", { session_key: race.sessionKey }).catch(
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
    replayState.resultsByDriver = new Map(
      sessionResults
        .filter((result) => Number.isFinite(Number(result.driver_number)))
        .map((result) => [Number(result.driver_number), result]),
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

    const locationDrivers = replayState.drivers
      .map((driver) => Number(driver.driver_number))
      .filter((number) => Number.isFinite(number));
    await replayFetchLocations(locationDrivers, requestId, false);
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
  const options = [];
  races.forEach((race) => {
    if (race.status === "COMPLETED" && race.sessionKey) {
      options.push({
        value: `race:${race.sessionKey}`,
        label: `${race.shortName} · ROUND ${String(race.round).padStart(2, "0")} · RACE`,
      });
    }
    if (race.sprintStatus === "COMPLETED" && race.sprintSessionKey) {
      options.push({
        value: `sprint:${race.sprintSessionKey}`,
        label: `${race.shortName} · ROUND ${String(race.round).padStart(2, "0")} · SPRINT`,
      });
    }
  });
  replayElements.raceSelect.innerHTML = options.length
    ? `<option value="">SELECT A COMPLETED RACE OR SPRINT</option>${options.map((option) => `<option value="${option.value}">${replayEscape(option.label)}</option>`).join("")}`
    : `<option value="">NO COMPLETED RACES OR SPRINTS</option>`;
  replayElements.raceSelect.value = "";
}

function replaySelectedDescriptor() {
  const selected = String(replayElements.raceSelect?.value || "");
  const separator = selected.indexOf(":");
  if (separator < 0) return null;
  const sessionType = selected.slice(0, separator);
  const selectedKey = selected.slice(separator + 1);
  const isSprint = sessionType === "sprint";
  if (!isSprint && sessionType !== "race") return null;
  const race = races.find(
    (item) =>
      String(isSprint ? item.sprintSessionKey : item.sessionKey) ===
      selectedKey,
  );
  if (!race) return null;
  const sessionKey = isSprint ? race.sprintSessionKey : race.sessionKey;
  const status = isSprint ? race.sprintStatus : race.status;
  if (!sessionKey || status !== "COMPLETED") return null;
  return {
    ...race,
    sessionKey,
    status,
    dateStart: isSprint ? race.sprintDateStart : race.dateStart,
    dateEnd: isSprint ? race.sprintDateEnd : race.dateEnd,
    replaySessionType: sessionType,
    replayStartingGridKey: isSprint
      ? race.sprintQualifyingSessionKey
      : race.qualifyingSessionKey,
  };
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
  replayState.resultsByDriver = new Map();
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
    : "SELECT A COMPLETED RACE OR SPRINT TO LOAD TELEMETRY";
  replayElements.driverPickerButton.textContent = "22 DRIVERS";
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
      : "SELECT A COMPLETED RACE OR SPRINT",
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
  replayElements.raceSelect.addEventListener("change", () => {
    const race = replaySelectedDescriptor();
    replaySelectRaceBySession(race?.sessionKey || "");
    replayElements.loadButton.disabled = !race;
    if (race)
      replaySetStatus(
        `${race.replaySessionType === "sprint" ? "SPRINT" : "RACE"} SELECTED · PRESS LOAD REPLAY`,
      );
  });
  replayElements.loadButton.addEventListener("click", () => {
    const race = replaySelectedDescriptor();
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
      phase2Fetch("championship_drivers", { session_key: "latest" }),
      phase2Fetch("championship_teams", { session_key: "latest" }),
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
            <div class="position-history-identity">
                <img class="position-history-headshot" src="${phase2Escape(overviewDriverImage(selectedDriver.name) || "")}" alt="" onerror="this.hidden=true">
                <div>
                    <span class="rev-eyebrow">DRIVER POSITION / POSITION HISTORY</span>
                    <h3>${phase2Escape(selectedDriver.name)}</h3>
                    <p>${phase2Escape(selectedDriver.team)} · CURRENT CHAMPIONSHIP P${currentPosition}</p>
                </div>
              </div>
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
        <div class="position-history-note">HIGHER ON THE CHART = BETTER POSITION · DNF/DNS SHOWN BELOW P22 · FINAL POSITIONS FROM OPENF1 SESSION RESULT</div>
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
      .map((d, i) => {
        const image = overviewDriverImage(d.name);
        return `<div class="overview-standing">
          <span>${String(i + 1).padStart(2, "0")}</span>
          <div class="overview-standing-identity">
            ${image ? `<img class="overview-standing-headshot" src="${E(image)}" alt="" loading="lazy" onerror="this.hidden=true">` : ""}
            <div class="overview-standing-name">
              <strong data-h2h-driver="${d.number}">${E(d.name)}</strong>
              <small>${E(d.team || "")}</small>
            </div>
          </div>
          <div class="overview-standing-score"><b>${P(d.points)} <small>PTS</small></b></div>
        </div>`;
      })
      .join("")}</div>`;
  };
  const teamStandings = (items, limit = 5) => {
    return `<div class="overview-standings overview-teams">${items
      .slice(0, limit)
      .map((t, i) => {
        const image = overviewTeamImage(t.name);
        return `<div class="overview-standing">
          <span>${String(i + 1).padStart(2, "0")}</span>
          <div class="overview-standing-identity overview-team-identity">
            ${image ? `<img class="overview-standing-team-logo" src="${E(image)}" alt="" loading="lazy" onerror="this.hidden=true">` : ""}
            <div class="overview-standing-name"><strong>${E(t.name)}</strong></div>
          </div>
          <div class="overview-standing-score"><b>${P(t.points)} <small>PTS</small></b></div>
        </div>`;
      })
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
                <strong data-h2h-driver="${leader?.number || ""}">${E(leader?.name || "—")}</strong>
                <b>${P(leader?.points)} <small>PTS</small></b>
            </div>
        </div>
        <img class="overview-hero-championship-image" src="images/championship-leader.png" alt="">
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
        `<article class="drivers-feature-row drivers-feature-${i + 1}" style="--driver-accent:${phase2TeamColor(d.team)}"><span class="drivers-feature-pos">${String(i + 1).padStart(2, "0")}</span><div class="drivers-feature-copy"><span class="rev-eyebrow">${i === 0 ? "CHAMPIONSHIP LEADER" : "TITLE CONTENDER"} / ${E(d.team)}</span><h3 data-h2h-driver="${d.number}">${E(d.name)}</h3></div>${overviewDriverImage(d.name) ? `<img src="${E(overviewDriverImage(d.name))}" alt="${E(d.name)}">` : ``}<strong class="drivers-feature-points"><span>${P(d.points)}<small>PTS</small></span></strong></article>`,
    )
    .join("");
  const remainingDrivers = phase2State.drivers
    .slice(3)
    .map(
      (d, i) =>
        `<article class="drivers-roster-row">
        <span class="drivers-roster-pos">${String(i + 4).padStart(2, "0")}</span>
        ${overviewDriverImage(d.name) ? `<img class="drivers-roster-headshot" src="${E(overviewDriverImage(d.name))}" alt="" loading="lazy">` : ``}
        <div class="drivers-roster-driver"><span>${E(d.team)}</span><h4 data-h2h-driver="${d.number}">${E(d.name)}</h4></div>
        <div class="drivers-roster-number">#${E(d.number)}</div>
        <strong class="drivers-roster-score"><span>${P(d.points)} <small>PTS</small></span></strong>
      </article>`,
    )
    .join("");
  document.getElementById("driversContent").innerHTML =
    `<img class="drivers-hero-championship-image" src="images/championship-leader-2.png" alt=""><section class="drivers-hero" style="--driver-accent:${phase2TeamColor(leader?.team)}"><div class="drivers-hero-watermark">01</div><div class="drivers-hero-copy"><span class="rev-eyebrow">01 / THE CHAMPIONSHIP LEADER</span><h2>${E(leader?.name || "—")}</h2><p>${E(leader?.team || "—")} / ${P(leader?.points)} POINTS</p></div></section><section class="drivers-featured"><div class="drivers-section-intro"><span class="rev-eyebrow">THE TITLE FIGHT</span><h3>THREE<br><i>FRONT-RUNNERS.</i></h3><p>The drivers currently setting the pace of the 2026 championship.</p></div><div class="drivers-feature-list">${driverFeatures}</div></section><section class="drivers-grid-section"><div class="drivers-section-intro"><span class="rev-eyebrow">THE PURSUIT</span><h3>THE<br><i>GRID.</i></h3><p>Every driver. Every point. Every position.</p></div><div class="drivers-roster">${remainingDrivers}</div></section>`;

  document.getElementById("teamsContent").innerHTML =
    `<section class="rev-teams-intro"><img class="rev-teams-hero-mercedes" src="images/teams/mercedes.png" alt="" aria-hidden="true"><span class="rev-eyebrow">THE CONSTRUCTOR CHAMPIONSHIP</span><h2>ELEVEN TEAMS.<br><i>ONE CROWN.</i></h2><p>Engineering. Strategy. Two drivers. One result.</p></section><section class="rev-teams-roster">${phase2State.teams
      .map((t, i) => {
        const pair = phase2State.drivers
          .filter((d) => d.team === t.name)
          .slice(0, 2);
        return `<article class="rev-team-feature ${phase2TeamClass(t.name)}"><img class="rev-team-hero-logo" src="${E(phase2TeamLogo(t.name))}" alt="" aria-hidden="true"><span class="rev-pos">${String(i + 1).padStart(2, "0")}</span><div class="rev-team-title"><span class="rev-eyebrow">CONSTRUCTOR</span><h3>${E(t.name)}</h3><div class="rev-team-pair">${pair.map((d) => `<span data-h2h-driver="${d.number}">${E(d.name)} <b>${P(d.points)}</b></span>`).join("")}</div></div><div class="rev-team-visual">${pair.map((d) => (I(d.name) ? `<img src="${E(I(d.name))}" alt="${E(d.name)}">` : ``)).join("")}</div><strong class="rev-team-score"><span>${P(t.points)}<small>PTS</small></span></strong></article>`;
      })
      .join("")}</section>`;

  const renderChampionshipDriver = (d, i) =>
    `<article class="championship-standing-row team-${phase2TeamClass(d.team)}"><span class="championship-standing-accent"></span><span class="championship-standing-pos">${String(i + 1).padStart(2, "0")}</span><img class="championship-driver-headshot" src="${E(overviewDriverImage(d.name) || "")}" alt="" loading="lazy" onerror="this.hidden=true"><div class="championship-standing-driver"><strong data-h2h-driver="${d.number}">${E(d.name)}</strong><span>${E(d.team || "—")}</span></div><b class="championship-standing-score"><span>${P(d.points)}<small>PTS</small></span></b></article>`;

  const championshipDriversVisible = phase2State.drivers
    .slice(0, 11)
    .map(renderChampionshipDriver)
    .join("");

  const championshipDriversRemaining = phase2State.drivers
    .slice(11)
    .map((d, i) => renderChampionshipDriver(d, i + 11))
    .join("");

  const championshipTeams = phase2State.teams
    .map(
      (t, i) =>
        `<article class="championship-standing-row championship-team-row team-${phase2TeamClass(t.name)}"><span class="championship-standing-accent"></span><span class="championship-standing-pos">${String(i + 1).padStart(2, "0")}</span><img class="championship-team-logo" src="${E(phase2TeamLogo(t.name) || "")}" alt="" loading="lazy" onerror="this.hidden=true"><div class="championship-standing-driver"><strong>${E(t.name)}</strong></div><b class="championship-standing-score"><span>${P(t.points)}<small>PTS</small></span></b></article>`,
    )
    .join("");
  document.getElementById("championshipContent").innerHTML = `
        <section class="championship-hero">
            <img class="championship-hero-trophy" src="images/championship-trophy.png" alt="" aria-hidden="true">
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
                <div class="championship-standing-list">${championshipDriversVisible}</div>
                <div class="championship-standing-list" id="championshipDriversRemaining" hidden>${championshipDriversRemaining}</div>
                <button class="data-more-button" id="championshipDriversMore" type="button" ${phase2State.drivers.length <= 11 ? "hidden" : ""}>VIEW MORE</button>
            </div>
            <div class="championship-column">
                <span class="rev-eyebrow">02 / CONSTRUCTORS</span>
                <h3>THE TEAM<br><i>CHAMPIONSHIP.</i></h3>
                <div class="championship-standing-list">${championshipTeams}</div>
            </div>
        </section>
    `;

  const championshipDriversMore = document.getElementById(
    "championshipDriversMore",
  );
  const championshipDriversRemainingElement = document.getElementById(
    "championshipDriversRemaining",
  );

  if (championshipDriversMore && championshipDriversRemainingElement) {
    championshipDriversMore.onclick = () => {
      const opening = championshipDriversRemainingElement.hidden;
      championshipDriversRemainingElement.hidden = !opening;
      championshipDriversMore.textContent = opening ? "VIEW LESS" : "VIEW MORE";
    };
  }

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

/* =====================================================
   HEAD-TO-HEAD COMPARISON
===================================================== */
const h2hState = {
  initialized: false,
  loading: false,
  driverA: null,
  driverB: null,
  pendingDriver: null,
  requestId: 0,
  requestCache: new Map(),
  sessionData: new Map(),
  comparison: null,
  popupDriver: null,
  popupAnchor: null,
  popupTouch: false,
  popupHideTimer: null,
};

const h2hElements = {
  content: document.getElementById("headToHeadContent"),
  selectA: document.getElementById("h2hDriverA"),
  selectB: document.getElementById("h2hDriverB"),
};

function h2hEscape(value) {
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

function h2hNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function h2hImage(driver) {
  return (
    overviewDriverImage(driver?.name) || phase2DriverImage(driver?.name) || ""
  );
}

function h2hDrivers() {
  const source = Array.isArray(phase2State.drivers) ? phase2State.drivers : [];
  return source
    .filter((driver) => Number.isFinite(Number(driver.number)))
    .map((driver) => ({
      ...driver,
      number: Number(driver.number),
      points: h2hNumber(driver.points),
      position: h2hNumber(driver.position),
    }));
}

function h2hRenderSelectorOptions() {
  const drivers = h2hDrivers();
  [h2hElements.selectA, h2hElements.selectB].forEach((select) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Select driver</option>${drivers
      .map(
        (driver) =>
          `<option value="${driver.number}">${h2hEscape(driver.name)}${driver.team ? ` — ${h2hEscape(driver.team)}` : ""}</option>`,
      )
      .join("")}`;
    if (drivers.some((driver) => String(driver.number) === current))
      select.value = current;
  });
  h2hSyncSelectors();
}

function h2hSyncSelectors() {
  if (!h2hElements.selectA || !h2hElements.selectB) return;
  const a = h2hElements.selectA.value;
  const b = h2hElements.selectB.value;
  Array.from(h2hElements.selectA.options).forEach((option) => {
    option.disabled = Boolean(option.value && option.value === b);
  });
  Array.from(h2hElements.selectB.options).forEach((option) => {
    option.disabled = Boolean(option.value && option.value === a);
  });
  h2hState.driverA = a ? Number(a) : null;
  h2hState.driverB = b ? Number(b) : null;
}

function h2hBaseSelectors() {
  const content = h2hElements.content;
  if (!content) return;
  document.querySelector(".h2h-page")?.classList.remove("h2h-has-comparison");
  content.innerHTML = `
    <div class="h2h-selectors">
      <label class="h2h-driver-select"><span>DRIVER A</span><select id="h2hDriverA" aria-label="Select Driver A"><option value="">Select driver</option></select></label>
      <span class="h2h-versus" aria-hidden="true">VS</span>
      <label class="h2h-driver-select"><span>DRIVER B</span><select id="h2hDriverB" aria-label="Select Driver B"><option value="">Select driver</option></select></label>
    </div>
    <p class="h2h-instruction">Select two drivers to begin the comparison.</p>`;
  h2hElements.selectA = document.getElementById("h2hDriverA");
  h2hElements.selectB = document.getElementById("h2hDriverB");
  h2hRenderSelectorOptions();
}

function h2hRenderState(title, message, retry = false) {
  const content = h2hElements.content;
  if (!content) return;

  const selectedA = h2hState.driverA;
  const selectedB = h2hState.driverB;

  h2hBaseSelectors();

  if (h2hElements.selectA) {
    h2hElements.selectA.value = selectedA ? String(selectedA) : "";
  }

  if (h2hElements.selectB) {
    h2hElements.selectB.value = selectedB ? String(selectedB) : "";
  }

  h2hSyncSelectors();

  content.insertAdjacentHTML(
    "beforeend",
    `<div class="h2h-state" role="status">
      <h2>${h2hEscape(title)}</h2>
      <p>${h2hEscape(message)}</p>
      ${retry ? `<button class="h2h-retry" type="button" data-h2h-retry>TRY AGAIN</button>` : ""}
    </div>`,
  );
}

function h2hRenderLoadingState(driverA, driverB) {
  h2hBaseSelectors();
  h2hRenderSelectorOptions();
  h2hElements.selectA.value = String(driverA);
  h2hElements.selectB.value = String(driverB);
  h2hSyncSelectors();
  h2hElements.content.insertAdjacentHTML(
    "beforeend",
    `<div class="h2h-state" role="status"><h2>Loading comparison</h2><p>Loading completed race, qualifying, sprint and championship records from OpenF1 and the project cache.</p></div>`,
  );
}

async function h2hWithTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function h2hCachedFetch(path, params = {}) {
  const key = `${path}|${JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)))}`;
  if (h2hState.requestCache.has(key)) return h2hState.requestCache.get(key);
  const request = (async () => {
    let cached = null;
    try {
      cached = await h2hWithTimeout(
        openF1GetCachedData(path, params),
        5000,
        "Cached OpenF1 lookup",
      );
    } catch (error) {
      console.warn("Head-to-head cache lookup failed:", error);
    }
    if (cached && Array.isArray(cached.data)) return cached.data;
    const data = await h2hWithTimeout(
      fetchOpenF1(path, params, { allow404: true }),
      18000,
      "OpenF1 request",
    );
    return Array.isArray(data) ? data : [];
  })();
  h2hState.requestCache.set(key, request);
  try {
    return await request;
  } catch (error) {
    h2hState.requestCache.delete(key);
    throw error;
  }
}

function h2hCompletedRaces() {
  const now = Date.now();
  return races
    .filter(
      (race) =>
        race.sessionKey &&
        !race.isCancelled &&
        (race.status === "COMPLETED" ||
          (Number.isFinite(Date.parse(race.dateEnd || "")) &&
            Date.parse(race.dateEnd) < now)),
    )
    .sort((a, b) => a.round - b.round);
}

function h2hDriverRecord(driverNumber, records) {
  return (
    records.find(
      (record) => Number(record.driver_number) === Number(driverNumber),
    ) || null
  );
}

function h2hResultStatus(result) {
  if (!result) return "NO RESULT";
  if (result.dsq === true) return "DSQ";
  if (result.dns === true) return "DNS";
  if (result.dnf === true) return "DNF";
  const position = h2hNumber(result.position);
  if (position !== null && position > 0) return `P${position}`;
  if (result.status && String(result.status).trim())
    return String(result.status).toUpperCase();
  return "RESULT UNAVAILABLE";
}

function h2hResultPosition(result) {
  if (!result || result.dsq === true || result.dns === true) return null;
  const position = h2hNumber(result.position);
  return Number.isInteger(position) && position > 0 ? position : null;
}

function h2hQualifyingPosition(result) {
  return h2hResultPosition(result);
}

function h2hQualifyingReachedQ3(result) {
  if (!result) return null;

  const duration = result.duration;

  if (Array.isArray(duration) && duration.length >= 3) {
    if (
      duration[2] !== null &&
      duration[2] !== undefined &&
      duration[2] !== ""
    ) {
      return true;
    }

    if (
      duration[0] !== null &&
      duration[0] !== undefined &&
      duration[0] !== "" &&
      duration[1] !== null &&
      duration[1] !== undefined &&
      duration[1] !== ""
    ) {
      return false;
    }
  }

  const position = h2hQualifyingPosition(result);

  if (position !== null) return position <= 10;

  return null;
}

function h2hRacePointsFromSnapshots(raceRecords, snapshots, driverA, driverB) {
  let previous = null;
  return raceRecords.map((race, index) => {
    const snapshot = snapshots[index];
    const rowA = snapshot ? h2hDriverRecord(driverA, snapshot) : null;
    const rowB = snapshot ? h2hDriverRecord(driverB, snapshot) : null;
    const currentA = h2hNumber(rowA?.points_current);
    const currentB = h2hNumber(rowB?.points_current);
    const startA = h2hNumber(rowA?.points_start);
    const startB = h2hNumber(rowB?.points_start);
    let weekendA = null;
    let weekendB = null;
    if (currentA !== null && currentB !== null) {
      if (race.round === 1 && startA !== null && startB !== null) {
        weekendA = currentA - startA;
        weekendB = currentB - startB;
      } else if (
        previous &&
        previous.index === index - 1 &&
        previous.a !== null &&
        previous.b !== null
      ) {
        weekendA = currentA - previous.a;
        weekendB = currentB - previous.b;
      }
    }
    const point = {
      round: race.round,
      name: race.shortName || race.name || `Round ${race.round}`,
      date: race.dateStart || race.date,
      cumulativeA: currentA,
      cumulativeB: currentB,
      weekendA,
      weekendB,
      gapCumulative:
        currentA !== null && currentB !== null ? currentA - currentB : null,
      gapWeekend:
        weekendA !== null && weekendB !== null ? weekendA - weekendB : null,
    };
    previous =
      currentA !== null && currentB !== null
        ? { index, a: currentA, b: currentB }
        : null;
    return point;
  });
}

async function h2hLoadPair(driverA, driverB, requestId) {
  const completed = h2hCompletedRaces();

  if (!completed.length) {
    return {
      races: [],
      events: [],
      statsA: h2hEmptyStats(),
      statsB: h2hEmptyStats(),
      points: [],
      noCompletedRaces: true,
    };
  }

  const sessionJobs = [];

  for (const race of completed) {
    sessionJobs.push(
      (async () => {
        const [
          raceResults,
          qualifyingResults,
          sprintResults,
          championship,
          raceDrivers,
          qualifyingDrivers,
          sprintDrivers,
        ] = await Promise.all([
          h2hCachedFetch("session_result", {
            session_key: race.sessionKey,
          }).catch(() => null),
          race.qualifyingSessionKey && race.qualifyingStatus !== "UPCOMING"
            ? h2hCachedFetch("session_result", {
                session_key: race.qualifyingSessionKey,
              }).catch(() => null)
            : Promise.resolve(null),
          race.sprintSessionKey && race.sprintStatus !== "UPCOMING"
            ? h2hCachedFetch("session_result", {
                session_key: race.sprintSessionKey,
              }).catch(() => null)
            : Promise.resolve(null),
          h2hCachedFetch("championship_drivers", {
            session_key: race.sessionKey,
          }).catch(() => null),
          h2hCachedFetch("drivers", {
            session_key: race.sessionKey,
          }).catch(() => null),
          race.qualifyingSessionKey && race.qualifyingStatus !== "UPCOMING"
            ? h2hCachedFetch("drivers", {
                session_key: race.qualifyingSessionKey,
              }).catch(() => null)
            : Promise.resolve(null),
          race.sprintSessionKey && race.sprintStatus !== "UPCOMING"
            ? h2hCachedFetch("drivers", {
                session_key: race.sprintSessionKey,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (requestId !== h2hState.requestId) return null;

        return {
          race,
          raceResults,
          qualifyingResults,
          sprintResults,
          championship,
          raceDrivers,
          qualifyingDrivers,
          sprintDrivers,
        };
      })(),
    );
  }

  const sessions = (await Promise.all(sessionJobs)).filter(Boolean);

  if (requestId !== h2hState.requestId) return null;

  const statsA = h2hEmptyStats();
  const statsB = h2hEmptyStats();
  const eventRows = [];

  for (const session of sessions) {
    const {
      race,
      raceResults,
      qualifyingResults,
      sprintResults,
      championship,
      raceDrivers,
      qualifyingDrivers,
      sprintDrivers,
    } = session;

    const aRace = Array.isArray(raceResults)
      ? h2hDriverRecord(driverA, raceResults)
      : null;
    const bRace = Array.isArray(raceResults)
      ? h2hDriverRecord(driverB, raceResults)
      : null;
    const aQual = Array.isArray(qualifyingResults)
      ? h2hDriverRecord(driverA, qualifyingResults)
      : null;
    const bQual = Array.isArray(qualifyingResults)
      ? h2hDriverRecord(driverB, qualifyingResults)
      : null;
    const aSprint = Array.isArray(sprintResults)
      ? h2hDriverRecord(driverA, sprintResults)
      : null;
    const bSprint = Array.isArray(sprintResults)
      ? h2hDriverRecord(driverB, sprintResults)
      : null;

    const aRaceParticipated =
      Array.isArray(raceDrivers) &&
      h2hDriverRecord(driverA, raceDrivers) !== null;
    const bRaceParticipated =
      Array.isArray(raceDrivers) &&
      h2hDriverRecord(driverB, raceDrivers) !== null;
    const aQualParticipated =
      Array.isArray(qualifyingDrivers) &&
      h2hDriverRecord(driverA, qualifyingDrivers) !== null;
    const bQualParticipated =
      Array.isArray(qualifyingDrivers) &&
      h2hDriverRecord(driverB, qualifyingDrivers) !== null;
    const aSprintParticipated =
      Array.isArray(sprintDrivers) &&
      h2hDriverRecord(driverA, sprintDrivers) !== null;
    const bSprintParticipated =
      Array.isArray(sprintDrivers) &&
      h2hDriverRecord(driverB, sprintDrivers) !== null;

    if (
      aRaceParticipated &&
      Array.isArray(raceResults) &&
      raceResults.length &&
      !aRace
    ) {
      statsA.raceDriverDataComplete = false;
    }

    if (
      bRaceParticipated &&
      Array.isArray(raceResults) &&
      raceResults.length &&
      !bRace
    ) {
      statsB.raceDriverDataComplete = false;
    }

    if (
      aQualParticipated &&
      Array.isArray(qualifyingResults) &&
      qualifyingResults.length &&
      !aQual
    ) {
      statsA.qualifyingDriverDataComplete = false;
    }

    if (
      bQualParticipated &&
      Array.isArray(qualifyingResults) &&
      qualifyingResults.length &&
      !bQual
    ) {
      statsB.qualifyingDriverDataComplete = false;
    }

    if (aQual && h2hQualifyingReachedQ3(aQual) === null) {
      statsA.q3DataComplete = false;
    }

    if (bQual && h2hQualifyingReachedQ3(bQual) === null) {
      statsB.q3DataComplete = false;
    }

    if (
      aSprintParticipated &&
      Array.isArray(sprintResults) &&
      sprintResults.length &&
      !aSprint
    ) {
      statsA.sprintDriverDataComplete = false;
    }

    if (
      bSprintParticipated &&
      Array.isArray(sprintResults) &&
      sprintResults.length &&
      !bSprint
    ) {
      statsB.sprintDriverDataComplete = false;
    }

    [
      [statsA, aRace],
      [statsB, bRace],
    ].forEach(([stats, result]) => {
      if (!result) return;

      const position = h2hResultPosition(result);

      if (position === 1) stats.wins += 1;
      if (position !== null && position <= 3) stats.podiums += 1;
      if (position !== null && position <= 10) stats.pointsFinishes += 1;
      if (result.dnf === true) stats.dnfs += 1;

      if (position !== null) {
        stats.bestRace =
          stats.bestRace === null
            ? position
            : Math.min(stats.bestRace, position);
      }

      if (result.dns === true) stats.dns += 1;
      if (result.dsq === true) stats.dsqs += 1;
    });

    [
      [statsA, aSprint],
      [statsB, bSprint],
    ].forEach(([stats, result]) => {
      if (!result) return;

      const position = h2hResultPosition(result);

      if (position === 1) stats.sprintWins += 1;
      if (position !== null && position <= 3) stats.sprintPodiums += 1;
    });

    [
      [statsA, aQual],
      [statsB, bQual],
    ].forEach(([stats, result]) => {
      if (!result) return;

      const position = h2hQualifyingPosition(result);

      if (position === 1) stats.poles += 1;

      if (position !== null) {
        stats.bestQualifying =
          stats.bestQualifying === null
            ? position
            : Math.min(stats.bestQualifying, position);
      }

      if (h2hQualifyingReachedQ3(result) === true) stats.q3 += 1;
    });

    eventRows.push({
      race,
      aRace,
      bRace,
      aQual,
      bQual,
      aSprint,
      bSprint,
      raceFieldSize: Array.isArray(raceResults) ? raceResults.length : null,
      qualifyingFieldSize: Array.isArray(qualifyingResults)
        ? qualifyingResults.length
        : null,
      sprintFieldSize: Array.isArray(sprintResults)
        ? sprintResults.length
        : null,
      championship: Array.isArray(championship) ? championship : null,
      raceResultsAvailable:
        Array.isArray(raceResults) && raceResults.length > 0,
      qualifyingAvailable:
        Array.isArray(qualifyingResults) && qualifyingResults.length > 0,
      sprintAvailable: Array.isArray(sprintResults) && sprintResults.length > 0,
    });
  }

  const raceResultsComplete = eventRows.every(
    (event) => event.raceResultsAvailable,
  );

  const qualifyingEvents = eventRows.filter(
    (event) => event.race.qualifyingSessionKey,
  );

  const qualifyingResultsComplete = qualifyingEvents.every(
    (event) => event.qualifyingAvailable,
  );

  const sprintEvents = eventRows.filter((event) => event.race.sprintSessionKey);

  const sprintResultsComplete = sprintEvents.every(
    (event) => event.sprintAvailable,
  );

  [statsA, statsB].forEach((stats) => {
    stats.raceResultsComplete = raceResultsComplete;
    stats.qualifyingResultsComplete = qualifyingResultsComplete;
    stats.sprintResultsComplete = sprintResultsComplete;
  });

  const points = h2hRacePointsFromSnapshots(
    completed,
    completed.map((race) => {
      const found = sessions.find(
        (session) => session.race.round === race.round,
      );

      return found &&
        Array.isArray(found.championship) &&
        found.championship.length
        ? found.championship
        : null;
    }),
    driverA,
    driverB,
  );

  return {
    races: completed,
    events: eventRows,
    statsA,
    statsB,
    points,
    noCompletedRaces: false,
  };
}

function h2hEmptyStats() {
  return {
    wins: 0,
    podiums: 0,
    pointsFinishes: 0,
    poles: 0,
    q3: 0,
    bestRace: null,
    bestQualifying: null,
    sprintWins: 0,
    sprintPodiums: 0,
    dnfs: 0,
    dns: 0,
    dsqs: 0,
    raceDriverDataComplete: true,
    qualifyingDriverDataComplete: true,
    sprintDriverDataComplete: true,
    q3DataComplete: true,
    raceResultsComplete: true,
    qualifyingResultsComplete: true,
    sprintResultsComplete: true,
  };
}

function h2hSvgChart(points, series, options = {}) {
  const width = 640,
    height = 250,
    left = 42,
    right = 14,
    top = 14,
    bottom = 34;
  const plotW = width - left - right,
    plotH = height - top - bottom;
  const all = points
    .flatMap((point) => series.map((item) => point[item.key]))
    .filter((value) => Number.isFinite(value));
  if (!all.length)
    return `<div class="h2h-state"><h2>Points history unavailable</h2><p>The cached championship snapshots do not contain enough historical points data for this chart.</p></div>`;
  let min = options.zeroBased ? 0 : Math.min(...all);
  let max = Math.max(...all);
  if (options.includeZero) {
    min = Math.min(min, 0);
    max = Math.max(max, 0);
  }
  if (max === min) {
    max += 1;
    if (!options.zeroBased) min -= 1;
  }
  const padding = (max - min) * 0.12;
  if (!options.zeroBased) {
    min -= padding;
    max += padding;
  } else max += padding;
  const x = (i) =>
    left + (points.length <= 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const y = (value) => top + ((max - value) / (max - min)) * plotH;
  const gridValues = options.includeZero
    ? [
        ...new Set(
          [min, 0, (min + max) / 2, max].filter((v) => Number.isFinite(v)),
        ),
      ]
    : [min, min + (max - min) / 2, max];
  const grid = gridValues
    .map(
      (v) =>
        `<line class="${v === 0 ? "h2h-zero" : "h2h-grid"}" x1="${left}" x2="${width - right}" y1="${y(v)}" y2="${y(v)}"></line><text x="${left - 8}" y="${y(v) + 3}" text-anchor="end">${h2hEscape(Number(v.toFixed(1)))}</text>`,
    )
    .join("");
  const labelIndices =
    points.length <= 12
      ? points.map((point, index) => index)
      : [
          ...points
            .map((point, index) => index)
            .filter((index) => index % 2 === 0),
          points.length - 1,
        ].filter((index, position, list) => list.indexOf(index) === position);
  const labels = labelIndices
    .map(
      (i) =>
        `<text x="${x(i)}" y="${height - 12}" text-anchor="middle">${h2hEscape(`R${points[i].round}`)}</text>`,
    )
    .join("");
  const paths = series
    .map((item) => {
      let segment = [],
        segments = [];
      points.forEach((point, i) => {
        const value = point[item.key];
        if (Number.isFinite(value)) segment.push(`${x(i)},${y(value)}`);
        else if (segment.length) {
          segments.push(segment.join(" "));
          segment = [];
        }
      });
      if (segment.length) segments.push(segment.join(" "));
      return segments
        .map(
          (path) =>
            `<polyline class="${item.className}" points="${path}"></polyline>`,
        )
        .join("");
    })
    .join("");
  const circles = series
    .map((item) =>
      points
        .map((point, i) =>
          Number.isFinite(point[item.key])
            ? `<circle class="${item.pointClass || ""}" cx="${x(i)}" cy="${y(point[item.key])}" r="3.1"><title>Round ${point.round} · ${h2hEscape(point.name)} · ${h2hEscape(item.label)}: ${point[item.key]}</title></circle>`
            : "",
        )
        .join(""),
    )
    .join("");
  return `<svg class="h2h-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${h2hEscape(options.label || "Points progression chart")}">${grid}${labels}${paths}${circles}</svg>`;
}

function h2hMetricRow(label, a, b, options = {}) {
  const format =
    options.format ||
    ((value) =>
      value === null || value === undefined ? "Unavailable" : String(value));
  const validA = a !== null && a !== undefined && Number.isFinite(Number(a));
  const validB = b !== null && b !== undefined && Number.isFinite(Number(b));
  let leadA = false,
    leadB = false;
  if (validA && validB) {
    if (options.lowerWins) {
      leadA = Number(a) < Number(b);
      leadB = Number(b) < Number(a);
    } else {
      leadA = Number(a) > Number(b);
      leadB = Number(b) > Number(a);
    }
  }
  return `<div class="h2h-metric-row"><div class="h2h-metric-value ${leadA ? "is-leading" : ""} ${validA ? "" : "is-unavailable"}">${h2hEscape(format(a))}</div><div class="h2h-metric-label">${h2hEscape(label)}</div><div class="h2h-metric-value ${leadB ? "is-leading" : ""} ${validB ? "" : "is-unavailable"}">${h2hEscape(format(b))}</div></div>`;
}

function h2hFormatPosition(value) {
  return value === null || value === undefined ? "—" : `P${value}`;
}

function h2hPositionScore(result, fieldSize, qualifying = false) {
  if (!result || !Number.isFinite(Number(fieldSize)) || Number(fieldSize) < 2)
    return null;
  const position = qualifying
    ? h2hQualifyingPosition(result)
    : h2hResultPosition(result);
  if (!Number.isFinite(position) || position < 1) return null;
  return Math.max(
    0,
    Math.min(
      100,
      (100 * (Number(fieldSize) - position)) / (Number(fieldSize) - 1),
    ),
  );
}

function h2hOutcomeScore(a, b, lowerWins = false) {
  if (a === null || a === undefined || b === null || b === undefined)
    return [null, null];
  const left = Number(a),
    right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return [null, null];
  if (left === right) return [50, 50];
  const aWins = lowerWins ? left < right : left > right;
  return aWins ? [100, 0] : [0, 100];
}

function h2hWeightedScore(parts) {
  const available = parts.filter(
    (part) =>
      part.value !== null &&
      part.value !== undefined &&
      Number.isFinite(part.value),
  );
  if (!available.length) return null;
  const weight = available.reduce((sum, part) => sum + part.weight, 0);
  return weight
    ? available.reduce((sum, part) => sum + part.value * part.weight, 0) /
        weight
    : null;
}

function h2hBuildPerformanceScores(events, points) {
  const pointByRound = new Map(points.map((point) => [point.round, point]));
  return events.map((event) => {
    const point = pointByRound.get(event.race.round);
    const aRaceScore = h2hPositionScore(event.aRace, event.raceFieldSize);
    const bRaceScore = h2hPositionScore(event.bRace, event.raceFieldSize);
    const aQualScore = h2hPositionScore(
      event.aQual,
      event.qualifyingFieldSize,
      true,
    );
    const bQualScore = h2hPositionScore(
      event.bQual,
      event.qualifyingFieldSize,
      true,
    );
    const aSprintScore = h2hPositionScore(event.aSprint, event.sprintFieldSize);
    const bSprintScore = h2hPositionScore(event.bSprint, event.sprintFieldSize);
    const aPoints = point?.weekendA,
      bPoints = point?.weekendB;
    const pointTotal =
      Number.isFinite(aPoints) && Number.isFinite(bPoints)
        ? aPoints + bPoints
        : null;
    const aPointsScore = pointTotal > 0 ? (aPoints / pointTotal) * 100 : null;
    const bPointsScore = pointTotal > 0 ? (bPoints / pointTotal) * 100 : null;
    const spsA = h2hWeightedScore([
      { value: aRaceScore, weight: 45 },
      { value: aQualScore, weight: 25 },
      { value: aPointsScore, weight: 20 },
      { value: aSprintScore, weight: 10 },
    ]);
    const spsB = h2hWeightedScore([
      { value: bRaceScore, weight: 45 },
      { value: bQualScore, weight: 25 },
      { value: bPointsScore, weight: 20 },
      { value: bSprintScore, weight: 10 },
    ]);
    const [raceA, raceB] = h2hOutcomeScore(
      h2hResultPosition(event.aRace),
      h2hResultPosition(event.bRace),
      true,
    );
    const [qualA, qualB] = h2hOutcomeScore(
      h2hQualifyingPosition(event.aQual),
      h2hQualifyingPosition(event.bQual),
      true,
    );
    const [pointsA, pointsB] = h2hOutcomeScore(aPoints, bPoints);
    const [sprintA, sprintB] = h2hOutcomeScore(
      h2hResultPosition(event.aSprint),
      h2hResultPosition(event.bSprint),
      true,
    );
    const tmsA = h2hWeightedScore([
      { value: raceA, weight: 40 },
      { value: qualA, weight: 25 },
      { value: pointsA, weight: 25 },
      { value: sprintA, weight: 10 },
    ]);
    const tmsB = tmsA === null ? null : 100 - tmsA;
    return {
      round: event.race.round,
      name: event.race.shortName || event.race.name,
      spsA,
      spsB,
      tmsA,
      tmsB,
    };
  });
}

function h2hRenderComparison(driverA, driverB, comparison) {
  const content = h2hElements.content;
  if (!content) return;
  document.querySelector(".h2h-page")?.classList.add("h2h-has-comparison");
  const aCurrent = h2hDrivers().find((driver) => driver.number === driverA);
  const bCurrent = h2hDrivers().find((driver) => driver.number === driverB);
  if (!aCurrent || !bCurrent) {
    h2hRenderState(
      "Driver data unavailable",
      "The selected driver is no longer present in the available season data. Retry to refresh the list.",
      true,
    );
    return;
  }
  const statsA = comparison.statsA,
    statsB = comparison.statsB;
  const points = comparison.points || [];
  const performanceScores = h2hBuildPerformanceScores(
    comparison.events,
    points,
  );

  const spsChart = h2hSvgChart(
    performanceScores,
    [
      {
        key: "spsA",
        label: "Driver A SPS",
        className: "h2h-line-a",
        pointClass: "h2h-point-a",
      },
      {
        key: "spsB",
        label: "Driver B SPS",
        className: "h2h-line-b",
        pointClass: "h2h-point-b",
      },
    ],
    { zeroBased: true, label: "Season Performance Score evolution" },
  );

  const tmsChart = h2hSvgChart(
    performanceScores,
    [
      {
        key: "tmsA",
        label: "Driver A TMS",
        className: "h2h-line-a",
        pointClass: "h2h-point-a",
      },
      {
        key: "tmsB",
        label: "Driver B TMS",
        className: "h2h-line-b",
        pointClass: "h2h-point-b",
      },
    ],
    { zeroBased: true, label: "Teammate Matchup Score evolution" },
  );

  const scoreLegend = `<div class="h2h-chart-legend">
    <span><i class="h2h-legend-mark"></i>${h2hEscape(aCurrent.name)}</span>
    <span><i class="h2h-legend-mark b"></i>${h2hEscape(bCurrent.name)}</span>
  </div>`;

  const hasUnavailableData =
    comparison.events.some(
      (event) =>
        !event.raceResultsAvailable ||
        (event.race.qualifyingSessionKey && !event.qualifyingAvailable) ||
        (event.race.sprintSessionKey && !event.sprintAvailable),
    ) ||
    points.some(
      (point) => point.cumulativeA === null || point.cumulativeB === null,
    );
  const aImg = h2hImage(aCurrent),
    bImg = h2hImage(bCurrent);
  const imageMarkup = (src, name) =>
    src
      ? `<img class="h2h-faceoff-portrait" src="${h2hEscape(src)}" alt="${h2hEscape(name)} portrait" loading="lazy" onerror="this.hidden=true">`
      : `<div class="h2h-faceoff-portrait" aria-hidden="true"></div>`;
  const faceoff = `
    <section class="h2h-faceoff" aria-label="Driver face-off">
      <article class="h2h-driver-card" style="--h2h-team:${h2hEscape(phase2TeamColor(aCurrent.team))}">
        ${imageMarkup(aImg, aCurrent.name)}
        <div class="h2h-driver-card-copy"><span class="rev-eyebrow">DRIVER A / ${h2hEscape(aCurrent.team || "TEAM UNAVAILABLE")}</span><h2>${h2hEscape(aCurrent.name)}</h2><p>CHAMPIONSHIP POSITION ${aCurrent.position ?? "—"}</p><div class="h2h-driver-statline"><span>POINTS<strong>${aCurrent.points ?? "—"}</strong></span><span>DRIVER #<strong>${aCurrent.number}</strong></span></div></div>
      </article>
      <div class="h2h-faceoff-mid">VS</div>
      <article class="h2h-driver-card" style="--h2h-team:${h2hEscape(phase2TeamColor(bCurrent.team))}">
        ${imageMarkup(bImg, bCurrent.name)}
        <div class="h2h-driver-card-copy"><span class="rev-eyebrow">DRIVER B / ${h2hEscape(bCurrent.team || "TEAM UNAVAILABLE")}</span><h2>${h2hEscape(bCurrent.name)}</h2><p>CHAMPIONSHIP POSITION ${bCurrent.position ?? "—"}</p><div class="h2h-driver-statline"><span>POINTS<strong>${bCurrent.points ?? "—"}</strong></span><span>DRIVER #<strong>${bCurrent.number}</strong></span></div></div>
      </article>
    </section>`;
  const metrics = [
    [
      "Championship points",
      aCurrent.points,
      bCurrent.points,
      { format: (v) => (v === null ? "Unavailable" : String(v)) },
    ],
    [
      "Race wins",
      statsA.raceResultsComplete && statsA.raceDriverDataComplete
        ? statsA.wins
        : null,
      statsB.raceResultsComplete && statsB.raceDriverDataComplete
        ? statsB.wins
        : null,
    ],
    [
      "Podiums",
      statsA.raceResultsComplete && statsA.raceDriverDataComplete
        ? statsA.podiums
        : null,
      statsB.raceResultsComplete && statsB.raceDriverDataComplete
        ? statsB.podiums
        : null,
    ],
    [
      "Points finishes (P1–P10)",
      statsA.raceResultsComplete && statsA.raceDriverDataComplete
        ? statsA.pointsFinishes
        : null,
      statsB.raceResultsComplete && statsB.raceDriverDataComplete
        ? statsB.pointsFinishes
        : null,
    ],
    ["Pole positions", statsA.poles, statsB.poles],
    ["Q3 appearances", statsA.q3, statsB.q3],
    [
      "Best race finish",
      statsA.raceResultsComplete && statsA.raceDriverDataComplete
        ? statsA.bestRace
        : null,
      statsB.raceResultsComplete && statsB.raceDriverDataComplete
        ? statsB.bestRace
        : null,
      { lowerWins: true, format: h2hFormatPosition },
    ],
    [
      "Best qualifying result",
      statsA.bestQualifying,
      statsB.bestQualifying,
      { lowerWins: true, format: h2hFormatPosition },
    ],
    [
      "Sprint wins",
      statsA.sprintResultsComplete && statsA.sprintDriverDataComplete
        ? statsA.sprintWins
        : null,
      statsB.sprintResultsComplete && statsB.sprintDriverDataComplete
        ? statsB.sprintWins
        : null,
    ],
    [
      "Sprint podiums",
      statsA.sprintResultsComplete && statsA.sprintDriverDataComplete
        ? statsA.sprintPodiums
        : null,
      statsB.sprintResultsComplete && statsB.sprintDriverDataComplete
        ? statsB.sprintPodiums
        : null,
    ],
    [
      "DNFs",
      statsA.raceResultsComplete && statsA.raceDriverDataComplete
        ? statsA.dnfs
        : null,
      statsB.raceResultsComplete && statsB.raceDriverDataComplete
        ? statsB.dnfs
        : null,
      { lowerWins: true },
    ],
  ];
  const metricMarkup = metrics
    .map(([label, a, b, options]) => h2hMetricRow(label, a, b, options || {}))
    .join("");
  const chartA = h2hSvgChart(
    points,
    [
      {
        key: "cumulativeA",
        label: aCurrent.name,
        className: "h2h-line-a",
        pointClass: "h2h-point-a",
      },
      {
        key: "cumulativeB",
        label: bCurrent.name,
        className: "h2h-line-b",
        pointClass: "h2h-point-b",
      },
    ],
    { zeroBased: true, label: "Cumulative championship points by round" },
  );
  const chartGap = h2hSvgChart(
    points,
    [
      {
        key: "gapCumulative",
        label: `${aCurrent.name} minus ${bCurrent.name}`,
        className: "h2h-gap-line",
        pointClass: "h2h-point-a",
      },
    ],
    {
      includeZero: true,
      label:
        "Cumulative championship points gap; positive means Driver A leads",
    },
  );
  const chartRoundGap = h2hSvgChart(
    points,
    [
      {
        key: "gapWeekend",
        label: `${aCurrent.name} minus ${bCurrent.name}`,
        className: "h2h-gap-line",
        pointClass: "h2h-point-a",
      },
    ],
    {
      includeZero: true,
      label:
        "Championship points gained per weekend gap; positive means Driver A gained more",
    },
  );
  const gapRows = points
    .map((point) => {
      const value = point.gapWeekend;
      const display =
        value === null
          ? "Unavailable"
          : `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}`;
      const cls =
        value === null ? "na" : value > 0 ? "a" : value < 0 ? "b" : "";
      return `<div class="h2h-round-gap-row"><span class="h2h-round-gap-name">R${point.round} · ${h2hEscape(point.name)}</span><strong class="h2h-round-gap-value ${cls}">${display}</strong><span class="h2h-round-gap-name">${value === null ? "Snapshot missing" : value > 0 ? `${h2hEscape(aCurrent.name)} gained more` : value < 0 ? `${h2hEscape(bCurrent.name)} gained more` : "Equal points"}</span></div>`;
    })
    .join("");
  const rows = comparison.races
    .map((race) => {
      const event = comparison.events.find(
        (item) => item.race.round === race.round,
      );
      const point = points.find((item) => item.round === race.round);
      const aRace = event?.aRace || null,
        bRace = event?.bRace || null;
      const aStatus = event?.raceResultsAvailable
        ? h2hResultStatus(aRace)
        : "DATA UNAVAILABLE";
      const bStatus = event?.raceResultsAvailable
        ? h2hResultStatus(bRace)
        : "DATA UNAVAILABLE";
      const aPosition = h2hResultPosition(aRace),
        bPosition = h2hResultPosition(bRace);
      const aPoints = point?.weekendA,
        bPoints = point?.weekendB;
      const delta =
        aPoints !== null &&
        aPoints !== undefined &&
        bPoints !== null &&
        bPoints !== undefined
          ? aPoints - bPoints
          : null;
      const pointsText = (value) =>
        value === null || value === undefined
          ? "—"
          : `${value > 0 ? "+" : ""}${Number(value.toFixed(2))}`;
      return `<tr><td class="h2h-table-round">R${race.round}</td><td>${h2hEscape(race.shortName || race.name)}</td><td class="${aPosition !== null && aPosition < (bPosition ?? Infinity) ? "h2h-table-lead" : ""}">${h2hEscape(aStatus)}</td><td>${aPoints === null || aPoints === undefined ? "—" : pointsText(aPoints)}</td><td class="${bPosition !== null && bPosition < (aPosition ?? Infinity) ? "h2h-table-lead" : ""}">${h2hEscape(bStatus)}</td><td>${bPoints === null || bPoints === undefined ? "—" : pointsText(bPoints)}</td><td>${delta === null ? "—" : pointsText(delta)}</td></tr>`;
    })
    .join("");
  content.innerHTML = `
    <div class="h2h-selectors">
      <label class="h2h-driver-select"><span>DRIVER A</span><select id="h2hDriverA" aria-label="Select Driver A"><option value="">Select driver</option></select></label>
      <span class="h2h-versus" aria-hidden="true">VS</span>
      <label class="h2h-driver-select"><span>DRIVER B</span><select id="h2hDriverB" aria-label="Select Driver B"><option value="">Select driver</option></select></label>
    </div>
    ${faceoff}
    <section class="h2h-section"><div class="h2h-section-heading"><h2>SEASON STATISTICS</h2><p>Current standings and available completed-session results</p></div><div class="h2h-metrics">${metricMarkup}</div><p class="h2h-data-note">A missing result is not counted as a finish. Points progression uses OpenF1 championship snapshots; weekend points include sprint and race points when the snapshot is available. Missing snapshots remain unavailable rather than being estimated.</p>${hasUnavailableData ? `<button class="h2h-retry" type="button" data-h2h-retry>RETRY UNAVAILABLE DATA</button>` : ""}</section>
    <section class="h2h-section"><div class="h2h-section-heading"><h2><br>POINTS PROGRESSION<br><br></h2><p>Chronological rounds · gaps are Driver A minus Driver B</p></div>
      <div class="h2h-charts">
        <article class="h2h-chart-panel"><h3>CUMULATIVE CHAMPIONSHIP POINTS</h3><p>Official cumulative totals from saved championship standings.</p>${chartA}<div class="h2h-chart-legend"><span><i class="h2h-legend-mark"></i>${h2hEscape(aCurrent.name)}</span><span><i class="h2h-legend-mark b"></i>${h2hEscape(bCurrent.name)}</span></div></article>
        <article class="h2h-chart-panel"><h3>CUMULATIVE POINTS GAP</h3><p>Above zero means Driver A leads; below zero means Driver B leads.</p>${chartGap}</article>
        <article class="h2h-chart-panel"><h3>POINTS GAP BY WEEKEND</h3><p>Positive values mean Driver A gained more championship points that weekend.</p>${chartRoundGap}</article>
      </div>
      <div class="h2h-section-heading" style="margin-top:22px"><br><br><h2>ROUND-BY-ROUND POINTS GAP</h2><p>— means the snapshot needed to calculate the change is missing.</p></div><div class="h2h-round-gap-list">${gapRows || `<p class="h2h-data-note">No completed rounds are available.</p>`}</div>
    </section>
    <section class="h2h-section h2h-score-section"><div class="h2h-section-heading"><h2>SPS / TMS SCORE EVOLUTION</h2><p>Custom analytical scores · 0–100 scale</p></div><div class="h2h-score-grid"><article class="h2h-chart-panel"><h3>SEASON PERFORMANCE SCORE (SPS)</h3><p>Per-round score: race result 45%, qualifying 25%, share of the pair's weekend points 20%, sprint result 10%. Available components are reweighted when a session is missing.</p>${spsChart}${scoreLegend}</article><article class="h2h-chart-panel"><h3>TEAMMATE MATCHUP SCORE (TMS)</h3><p>Per-round head-to-head: race result 40%, qualifying 25%, weekend points 25%, sprint result 10%. A win scores 100, a tie 50 each, and a loss 0; unavailable components are excluded.</p>${tmsChart}${scoreLegend}</article></div><p class="h2h-data-note">SPS and TMS are custom dashboard indices, not official FIA, Formula 1, or OpenF1 metrics. Scores are calculated only from available cached/session records; missing components are not treated as losses or zero-point results. Sprint scores are included only for sprint weekends.</p></section>
    <section class="h2h-section"><div class="h2h-section-heading"><h2>RACE-BY-RACE RESULTS</h2><p>Finishing status and weekend championship points</p></div><div class="h2h-table-wrap"><table class="h2h-results-table"><thead><tr><th>ROUND</th><th>GRAND PRIX</th><th>${h2hEscape(aCurrent.name)} / FINISH</th><th>WEEKEND PTS</th><th>${h2hEscape(bCurrent.name)} / FINISH</th><th>WEEKEND PTS</th><th>POINTS DIFF.</th></tr></thead><tbody>${rows}</tbody></table></div><p class="h2h-data-note">Finishing status comes from session_result records. Weekend points are derived from adjacent championship snapshots, and therefore include sprint points where applicable. If an adjacent snapshot is missing, points are shown as unavailable. No official points are inferred from finishing position alone.</p></section>`;
  h2hElements.selectA = document.getElementById("h2hDriverA");
  h2hElements.selectB = document.getElementById("h2hDriverB");
  h2hRenderSelectorOptions();
  h2hElements.selectA.value = String(driverA);
  h2hElements.selectB.value = String(driverB);
  h2hSyncSelectors();
}

async function h2hCompareSelected() {
  h2hSyncSelectors();
  const requestId = ++h2hState.requestId;
  if (!h2hState.driverA || !h2hState.driverB) {
    h2hState.loading = false;
    const selectedA = h2hState.driverA;
    const selectedB = h2hState.driverB;
    h2hState.comparison = null;
    h2hBaseSelectors();
    h2hRenderSelectorOptions();
    h2hElements.selectA.value = selectedA ? String(selectedA) : "";
    h2hElements.selectB.value = selectedB ? String(selectedB) : "";
    h2hSyncSelectors();
    const instruction = h2hElements.content?.querySelector(".h2h-instruction");
    if (instruction && (h2hState.driverA || h2hState.driverB))
      instruction.textContent =
        "Choose a different second driver to load the comparison.";
    return;
  }
  if (h2hState.driverA === h2hState.driverB) {
    h2hState.loading = false;
    h2hRenderState(
      "Choose two different drivers",
      "Driver A and Driver B must be different.",
      true,
    );
    return;
  }
  const driverA = h2hState.driverA,
    driverB = h2hState.driverB;
  h2hState.loading = true;
  h2hRenderLoadingState(driverA, driverB);
  try {
    const comparison = await h2hLoadPair(driverA, driverB, requestId);
    if (requestId !== h2hState.requestId || !comparison) return;
    h2hState.comparison = comparison;
    if (comparison.noCompletedRaces) {
      h2hRenderState(
        "No completed race data",
        "There are no completed race sessions available to compare yet.",
        true,
      );
      return;
    }
    h2hRenderComparison(driverA, driverB, comparison);
  } catch (error) {
    if (requestId !== h2hState.requestId) return;
    console.error("Head-to-head comparison failed:", error);
    h2hRenderState(
      "Comparison unavailable",
      "OpenF1 and the saved cache could not provide enough data. Retry when data access is available.",
      true,
    );
  } finally {
    if (requestId === h2hState.requestId) h2hState.loading = false;
  }
}

async function h2hLoadDriverListFallback() {
  let standings = null;
  try {
    standings = await h2hCachedFetch("championship_drivers", {
      session_key: "latest",
    });
  } catch (error) {
    console.warn("Head-to-head cached standings unavailable:", error);
  }
  if (!Array.isArray(standings) || !standings.length) return false;

  const byNumber = new Map();
  const requiredNumbers = new Set(
    standings.map((item) => Number(item.driver_number)),
  );
  const now = Date.now();
  const candidates = races
    .filter(
      (race) =>
        race.sessionKey &&
        (race.status === "COMPLETED" ||
          (Number.isFinite(Date.parse(race.dateEnd || "")) &&
            Date.parse(race.dateEnd) < now)),
    )
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.dateStart || b.date || "") -
        Date.parse(a.dateStart || a.date || ""),
    );
  for (const race of candidates) {
    const cached = await openF1ReadStaticCache(
      openF1CacheKey("drivers", { session_key: race.sessionKey }),
    );
    if (Array.isArray(cached?.data)) {
      cached.data.forEach((driver) => {
        const number = Number(driver.driver_number);
        if (!byNumber.has(number)) byNumber.set(number, driver);
      });
    }
    if ([...requiredNumbers].every((number) => byNumber.has(number))) break;
  }
  const existingByNumber = new Map(
    (phase2State.drivers || []).map((driver) => [
      Number(driver.number),
      driver,
    ]),
  );
  phase2State.drivers = standings
    .slice()
    .sort(
      (a, b) =>
        (h2hNumber(a.position_current) ?? Infinity) -
        (h2hNumber(b.position_current) ?? Infinity),
    )
    .map((item) => {
      const number = Number(item.driver_number);
      const source = byNumber.get(number) || {};
      const existing = existingByNumber.get(number) || {};
      return {
        name: source.full_name || existing.name || `Driver #${number}`,
        number,
        team: source.team_name || existing.team || "Unknown",
        points: h2hNumber(item.points_current),
        position: h2hNumber(item.position_current),
      };
    })
    .filter((driver) => Number.isFinite(driver.number));
  return h2hDrivers().length > 0;
}

async function h2hEnrichDriverNames() {
  if (!Array.isArray(phase2State.drivers) || !phase2State.drivers.length)
    return;
  const needsNames = phase2State.drivers.some(
    (driver) =>
      !driver.name ||
      /^Driver #/i.test(driver.name) ||
      !driver.team ||
      driver.team === "Unknown",
  );
  if (!needsNames) return;
  const now = Date.now();
  const candidates = races
    .filter(
      (race) =>
        race.sessionKey &&
        (race.status === "COMPLETED" ||
          (Number.isFinite(Date.parse(race.dateEnd || "")) &&
            Date.parse(race.dateEnd) < now)),
    )
    .slice()
    .sort(
      (a, b) =>
        Date.parse(b.dateStart || b.date || "") -
        Date.parse(a.dateStart || a.date || ""),
    );
  const byNumber = new Map();
  const requiredNumbers = new Set(
    phase2State.drivers
      .filter(
        (driver) =>
          !driver.name ||
          /^Driver #/i.test(driver.name) ||
          !driver.team ||
          driver.team === "Unknown",
      )
      .map((driver) => Number(driver.number)),
  );
  for (const race of candidates) {
    const cached = await openF1ReadStaticCache(
      openF1CacheKey("drivers", { session_key: race.sessionKey }),
    );
    if (Array.isArray(cached?.data)) {
      cached.data.forEach((driver) => {
        const number = Number(driver.driver_number);
        if (!byNumber.has(number)) byNumber.set(number, driver);
      });
    }
    if ([...requiredNumbers].every((number) => byNumber.has(number))) break;
  }
  phase2State.drivers = phase2State.drivers.map((standing) => {
    const source = byNumber.get(Number(standing.number));
    if (!source) return standing;
    return {
      ...standing,
      name: /^Driver #/i.test(standing.name || "")
        ? source.full_name || standing.name
        : standing.name,
      team:
        !standing.team || standing.team === "Unknown"
          ? source.team_name || standing.team
          : standing.team,
    };
  });
}

async function h2hWaitForSeasonLoad() {
  const deadline = Date.now() + 20000;
  while (phase2State.loading && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function h2hInitialize() {
  if (!h2hElements.content) return;
  if (!h2hDrivers().length && phase2State.loading) await h2hWaitForSeasonLoad();
  if (!h2hDrivers().length) {
    try {
      await h2hLoadDriverListFallback();
    } catch (error) {
      console.warn("Head-to-head cached driver list unavailable:", error);
    }
  }
  if (!h2hDrivers().length && !phase2State.loaded && !phase2State.loading) {
    try {
      await phase2LoadSeasonData();
    } catch (error) {
      console.warn("Head-to-head driver list could not load:", error);
    }
  }
  if (!h2hDrivers().length) {
    try {
      await h2hLoadDriverListFallback();
    } catch (error) {
      console.warn("Head-to-head cached driver list retry failed:", error);
    }
  }
  await h2hEnrichDriverNames();
  const savedDriverA = h2hState.driverA;
  const savedDriverB = h2hState.driverB;
  if (!h2hDrivers().length) {
    h2hRenderState(
      "Driver list unavailable",
      "The dashboard could not load driver standings from OpenF1 or the saved season cache. Retry when data access is available.",
      true,
    );
    return;
  }
  if (!h2hState.initialized) {
    h2hState.initialized = true;
    h2hBaseSelectors();
    h2hElements.content.addEventListener("change", (event) => {
      if (event.target.id !== "h2hDriverA" && event.target.id !== "h2hDriverB")
        return;
      h2hSyncSelectors();
      h2hCompareSelected();
    });
    h2hElements.content.addEventListener("click", (event) => {
      if (event.target.closest("[data-h2h-retry]")) {
        h2hState.requestCache.clear();
        h2hInitialize().then(h2hCompareSelected);
      }
    });
  } else if (
    !h2hElements.selectA?.isConnected ||
    !h2hElements.selectB?.isConnected
  ) {
    h2hBaseSelectors();
  }
  h2hRenderSelectorOptions();
  if (h2hState.pendingDriver === null) {
    if (
      savedDriverA !== null &&
      h2hDrivers().some((driver) => driver.number === savedDriverA)
    )
      h2hElements.selectA.value = String(savedDriverA);
    if (
      savedDriverB !== null &&
      h2hDrivers().some((driver) => driver.number === savedDriverB)
    )
      h2hElements.selectB.value = String(savedDriverB);
    h2hSyncSelectors();
  }
  if (h2hState.pendingDriver !== null) {
    const pending = Number(h2hState.pendingDriver);
    h2hState.pendingDriver = null;
    if (h2hDrivers().some((driver) => driver.number === pending)) {
      h2hElements.selectA.value = String(pending);
      h2hElements.selectB.value = "";
      h2hSyncSelectors();
      h2hCompareSelected();
    }
  }
}

function h2hEnsurePopup() {
  let popup = document.getElementById("h2hDriverPopup");
  if (popup) return popup;
  popup = document.createElement("aside");
  popup.id = "h2hDriverPopup";
  popup.className = "h2h-popup";
  popup.hidden = true;
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-label", "Driver information");
  popup.innerHTML = `<div class="h2h-popup-head"><img class="h2h-popup-portrait" alt=""><div><p class="h2h-popup-name"></p><p class="h2h-popup-team"></p></div></div><div class="h2h-popup-stats"><span>CHAMPIONSHIP POS.<strong class="h2h-popup-position">—</strong></span><span>POINTS<strong class="h2h-popup-points">—</strong></span></div><button class="h2h-popup-action" type="button">HEAD-TO-HEAD</button>`;
  document.body.appendChild(popup);
  popup.addEventListener("pointerenter", () => {
    if (h2hState.popupHideTimer) clearTimeout(h2hState.popupHideTimer);
    h2hState.popupHideTimer = null;
  });
  popup.addEventListener("pointerleave", () => {
    if (!h2hState.popupTouch) h2hSchedulePopupHide();
  });
  popup.querySelector(".h2h-popup-action").addEventListener("click", () => {
    const number = h2hState.popupDriver;
    if (number === null || number === undefined) return;
    h2hState.pendingDriver = Number(number);
    h2hClosePopup();
    setDashboardTab("headtohead");
    h2hInitialize();
  });
  return popup;
}

function h2hOpenPopup(anchor, driverNumber, touch = false) {
  const driver = h2hDrivers().find(
    (item) => item.number === Number(driverNumber),
  );
  if (!driver) return;
  const popup = h2hEnsurePopup();
  h2hState.popupAnchor = anchor;
  h2hState.popupDriver = driver.number;
  h2hState.popupTouch = touch;
  if (h2hState.popupHideTimer) clearTimeout(h2hState.popupHideTimer);
  const image = popup.querySelector(".h2h-popup-portrait");
  const portrait = h2hImage(driver);
  if (portrait) image.src = portrait;
  else image.removeAttribute("src");
  image.alt = `${driver.name} portrait`;
  image.hidden = !portrait;
  popup.querySelector(".h2h-popup-name").textContent = driver.name;
  popup.querySelector(".h2h-popup-team").textContent =
    driver.team || "Team unavailable";
  popup.querySelector(".h2h-popup-position").textContent =
    driver.position === null ? "—" : `P${driver.position}`;
  popup.querySelector(".h2h-popup-points").textContent =
    driver.points === null ? "—" : String(driver.points);
  popup.style.setProperty("--h2h-team", phase2TeamColor(driver.team));
  popup.hidden = false;
  h2hPositionPopup();
}

function h2hPositionPopup() {
  const popup = document.getElementById("h2hDriverPopup");
  const anchor = h2hState.popupAnchor;
  if (!popup || popup.hidden || !anchor?.isConnected) return;
  const rect = anchor.getBoundingClientRect();
  const width = popup.offsetWidth || 264,
    height = popup.offsetHeight || 200;
  const margin = 10,
    gap = 12;
  const rightFits = rect.right + gap + width <= window.innerWidth - margin;
  const leftFits = rect.left - gap - width >= margin;
  let left;
  let top = rect.top + (rect.height - height) / 2;
  if (rightFits) {
    left = rect.right + gap;
  } else if (leftFits) {
    left = rect.left - width - gap;
  } else {
    left = Math.max(
      margin,
      Math.min(
        window.innerWidth - width - margin,
        rect.left + (rect.width - width) / 2,
      ),
    );
    const belowFits = rect.bottom + gap + height <= window.innerHeight - margin;
    const aboveFits = rect.top - gap - height >= margin;
    if (belowFits) top = rect.bottom + gap;
    else if (aboveFits) top = rect.top - height - gap;
  }
  if (top < margin) top = margin;
  if (top + height > window.innerHeight - margin)
    top = Math.max(margin, window.innerHeight - height - margin);
  popup.style.left = `${Math.round(left)}px`;
  popup.style.top = `${Math.round(top)}px`;
}

function h2hSchedulePopupHide() {
  if (h2hState.popupHideTimer) clearTimeout(h2hState.popupHideTimer);
  h2hState.popupHideTimer = setTimeout(() => {
    const popup = document.getElementById("h2hDriverPopup");
    if (popup && !popup.matches(":hover") && !h2hState.popupTouch)
      h2hClosePopup();
  }, 160);
}

function h2hClosePopup() {
  if (h2hState.popupHideTimer) clearTimeout(h2hState.popupHideTimer);
  h2hState.popupHideTimer = null;
  const popup = document.getElementById("h2hDriverPopup");
  if (popup) popup.hidden = true;
  h2hState.popupAnchor = null;
  h2hState.popupDriver = null;
  h2hState.popupTouch = false;
}

function h2hDecorateDriverReferences() {
  const popup = document.getElementById("h2hDriverPopup");
  if (
    popup &&
    !popup.hidden &&
    h2hState.popupAnchor &&
    !h2hState.popupAnchor.isConnected
  )
    h2hClosePopup();
  const driverMap = new Map(
    h2hDrivers().map((driver) => [driver.name.toLowerCase(), driver]),
  );
  const targets = [
    ".drivers-feature-copy h3",
    ".drivers-roster-driver h4",
    ".championship-standing-driver strong",
    ".rev-team-pair span",
    ".classification-driver strong",
    ".classification-row strong",
    ".podium-card h3",
    ".qualifying-card strong",
    ".qualifying-row strong",
    ".driver-info h3",
    ".qualifying-driver strong",
    ".overview-leader h2",
    ".overview-leader-line strong",
    ".overview-standing-name strong",
    ".drivers-hero-copy h2",
  ];
  document.querySelectorAll(targets.join(",")).forEach((element) => {
    if (
      element.closest("#headToHeadContent") ||
      element.closest("#h2hDriverPopup")
    )
      return;
    if (element.closest(".championship-team-row")) return;
    const exactText = element.textContent.trim().toLowerCase();
    const driver = driverMap.get(exactText);
    if (!driver) return;
    element.dataset.h2hDriver = String(driver.number);
    element.tabIndex = element.tabIndex >= 0 ? element.tabIndex : 0;
    element.setAttribute("aria-haspopup", "dialog");
    element.setAttribute(
      "aria-label",
      `${driver.name}, show driver information`,
    );
  });
  document.querySelectorAll("[data-replay-driver]").forEach((element) => {
    const driver = h2hDrivers().find(
      (item) => item.number === Number(element.dataset.replayDriver),
    );
    if (!driver) return;
    element.dataset.h2hDriver = String(driver.number);
  });
  document.querySelectorAll("[data-h2h-driver]").forEach((element) => {
    const driver = h2hDrivers().find(
      (item) => item.number === Number(element.dataset.h2hDriver),
    );
    if (!driver) return;
    element.tabIndex = element.tabIndex >= 0 ? element.tabIndex : 0;
    element.setAttribute("aria-haspopup", "dialog");
    element.setAttribute(
      "aria-label",
      `${driver.name}, show driver information`,
    );
  });
}

document
  .querySelectorAll(
    "#dashboardDrivers [data-h2h-driver], " +
      "#dashboardChampionship [data-h2h-driver], " +
      "#dashboardRace [data-h2h-driver]",
  )
  .forEach((element) => {
    element.removeAttribute("data-h2h-driver");
    element.removeAttribute("aria-haspopup");

    if (
      element.getAttribute("aria-label")?.endsWith(", show driver information")
    ) {
      element.removeAttribute("aria-label");
    }

    if (element.getAttribute("tabindex") === "0") {
      element.removeAttribute("tabindex");
    }
  });

function h2hPopupAllowed(target) {
  return (
    Boolean(target) &&
    !target.closest("#dashboardDrivers, #dashboardChampionship, #dashboardRace")
  );
}

function h2hBindPopupEvents() {
  if (document.documentElement.dataset.h2hPopupBound === "true") return;
  document.documentElement.dataset.h2hPopupBound = "true";
  document.addEventListener("pointerover", (event) => {
    const target = event.target.closest?.("[data-h2h-driver]");
    if (!h2hPopupAllowed(target) || event.pointerType === "touch") return;
    if (target.contains(event.relatedTarget)) return;
    h2hOpenPopup(target, Number(target.dataset.h2hDriver), false);
  });
  document.addEventListener("pointerout", (event) => {
    const target = event.target.closest?.("[data-h2h-driver]");
    if (!h2hPopupAllowed(target) || event.pointerType === "touch") return;
    if (target.contains(event.relatedTarget)) return;
    if (event.relatedTarget?.closest?.("#h2hDriverPopup")) return;
    h2hSchedulePopupHide();
  });
  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("[data-h2h-driver]");
    if (target) {
      if (!h2hPopupAllowed(target)) {
        h2hClosePopup();
        return;
      }
      if (
        event.target.closest("a,button,input,select,textarea") &&
        !event.target.closest("[data-h2h-driver]")?.matches("a,button")
      )
        return;
      if (event.detail === 0) {
        h2hOpenPopup(target, Number(target.dataset.h2hDriver), true);
        return;
      }
      if (window.matchMedia("(hover: none), (pointer: coarse)").matches) {
        if (h2hState.popupDriver === Number(target.dataset.h2hDriver))
          h2hClosePopup();
        else h2hOpenPopup(target, Number(target.dataset.h2hDriver), true);
        event.preventDefault();
      }
      return;
    }
    if (!event.target.closest("#h2hDriverPopup")) h2hClosePopup();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") h2hClosePopup();
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches?.("[data-h2h-driver]") &&
      h2hPopupAllowed(event.target)
    ) {
      event.preventDefault();
      h2hOpenPopup(event.target, Number(event.target.dataset.h2hDriver), true);
    }
  });
  window.addEventListener("scroll", h2hPositionPopup, {
    passive: true,
    capture: true,
  });
  window.addEventListener("resize", h2hPositionPopup);
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
    "headtohead",
    "replay",
    "race",
  ];
  const requestedTab = (() => {
    try {
      const queryTab = new URLSearchParams(window.location.search).get("tab");
      const hashTab = window.location.hash.replace(/^#/, "");
      return validTabs.includes(queryTab)
        ? queryTab
        : validTabs.includes(hashTab)
          ? hashTab
          : null;
    } catch (error) {
      return null;
    }
  })();
  setDashboardTab(
    requestedTab || (validTabs.includes(savedTab) ? savedTab : "overview"),
  );

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
        if (button.dataset.dashboard === "headtohead") {
          h2hInitialize();
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
    h2hBindPopupEvents();
    h2hDecorateDriverReferences();
    const h2hObserver = new MutationObserver(() =>
      h2hDecorateDriverReferences(),
    );
    [
      "overviewContent",
      "driversContent",
      "teamsContent",
      "championshipContent",
      "raceView",
      "replayShell",
    ].forEach((id) => {
      const target = document.getElementById(id);
      if (target)
        h2hObserver.observe(target, { childList: true, subtree: true });
    });
    h2hInitialize();
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

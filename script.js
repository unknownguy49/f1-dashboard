/* =====================================================
   OPENF1 RACE STATE
===================================================== */

let races = [];

/* =====================================================
   OPENF1 DATA LAYER
===================================================== */

const OPENF1_BASE_URL = "https://api.openf1.org/v1";

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

async function fetchOpenF1(path, params = {}, attempt = 0) {
  const response = await fetch(openF1Url(path, params), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      return fetchOpenF1(path, params, attempt + 1);
    }

    throw new Error(`OpenF1 request failed: ${response.status}`);
  }

  return response.json();
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

function getRaceStatus(meeting, raceSession) {
  if (meeting.is_cancelled) return "CANCELLED";

  const end = raceSession?.date_end || meeting.date_end;
  const start = raceSession?.date_start || meeting.date_start;
  const now = Date.now();

  if (end && new Date(end).getTime() < now) return "COMPLETED";
  if (start && new Date(start).getTime() <= now) return "LIVE";
  return "UPCOMING";
}

async function loadOpenF1Calendar() {
  const [meetings, raceSessions, qualifyingSessions] = await Promise.all([
    fetchOpenF1("meetings", { year: 2026 }),
    fetchOpenF1("sessions", {
      year: 2026,
      session_name: "Race",
    }),
    fetchOpenF1("sessions", {
      year: 2026,
      session_name: "Qualifying",
    }),
  ]);

  const sessionByMeeting = new Map(
    raceSessions.map((session) => [session.meeting_key, session]),
  );

  const qualifyingByMeeting = new Map(
    qualifyingSessions.map((session) => [session.meeting_key, session]),
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
        round: index + 1,
        name: meeting.meeting_name,
        shortName,
        date: formatRaceDate(raceSession?.date_start || meeting.date_start),
        dateStart: raceSession?.date_start || meeting.date_start,
        dateEnd: raceSession?.date_end || meeting.date_end,
        location: meeting.location,
        image: getLocalCircuitImage(
          shortName,
          meeting.location,
          meeting.meeting_name,
          meeting.circuit_key,
        ),
        status: getRaceStatus(meeting, raceSession),
        podium: null,
        raceResults: null,
        qualifying: null,
        fastestLap: null,
        startingGrid: null,
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

    selectedButton.scrollIntoView({
      behavior: "smooth",

      block: "nearest",

      inline: "center",
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

  raceDate.textContent = race.date;

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
       Render immediately, then hydrate from OpenF1
    --------------------------------------------- */

  renderPodium(race);
  renderRaceClassification(race);
  renderQualifying(race);
  renderFastestLap(race);
  renderStartingGridFinish(race);

  if (race.status === "COMPLETED" && race.sessionKey && !race.podium) {
    raceStatusLabel.textContent = "LOADING RESULT";
    raceStatus.textContent = "SYNCING";

    try {
      await loadRaceDetails(race);
      renderPodium(race);
      renderRaceClassification(race);
      renderQualifying(race);
      renderFastestLap(race);
      renderStartingGridFinish(race);
      raceStatusLabel.textContent = race.status;
      raceStatus.textContent = race.status;
    } catch (error) {
      console.error("OpenF1 race detail load failed:", error);
      raceStatusLabel.textContent = race.status;
      raceStatus.textContent = "OFFLINE";
    }
  }

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
   RENDER PODIUM
===================================================== */

function renderPodium(race) {
  /* ---------------------------------------------
       Future race
    --------------------------------------------- */

  if (!race.podium) {
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

  const first = race.podium.find((driver) => driver.position === 1);

  const second = race.podium.find((driver) => driver.position === 2);

  const third = race.podium.find((driver) => driver.position === 3);

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

function renderRaceClassification(race) {
  const section = document.getElementById("raceClassificationSection");
  const visible = document.getElementById("raceClassificationVisible");
  const remaining = document.getElementById("raceClassificationRemaining");
  const button = document.getElementById("raceClassificationMore");

  if (!section || !visible || !remaining || !button) return;

  section.hidden = false;
  remaining.hidden = true;
  button.textContent = "VIEW MORE";

  if (!race.raceResults?.length) {
    visible.innerHTML = createClassificationPlaceholder();
    remaining.innerHTML = "";
    button.hidden = true;
    return;
  }

  const results = race.raceResults
    .slice()
    .sort((a, b) => a.position - b.position);
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

function renderQualifying(race) {
  const section = document.getElementById("qualifyingSection");
  const pole = document.getElementById("polePositionCard");
  const visible = document.getElementById("qualifyingVisible");
  const remaining = document.getElementById("qualifyingRemaining");
  const button = document.getElementById("qualifyingMore");

  if (!section || !pole || !visible || !remaining || !button) return;

  section.hidden = false;
  remaining.hidden = true;
  button.textContent = "VIEW MORE";

  if (!race.qualifying?.length) {
    pole.innerHTML = createPolePlaceholder();
    visible.innerHTML = [2, 3]
      .map((position) => createQualifyingCard(null, position))
      .join("");
    remaining.innerHTML = "";
    button.hidden = true;
    return;
  }

  const results = race.qualifying;
  const first = results[0];
  const nextTwo = results.slice(1, 3);
  const rest = results.slice(3);

  pole.innerHTML = createPoleCard(first);
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

function createPoleCard(driver) {
  const image = driver.image;
  return `
        <article class="pole-position-card team-${driver.class}" style="--team-color:${driver.color || "#333333"}">
            ${image ? `<img src="${image}" alt="${driver.driver}" draggable="false">` : ""}
            <div class="pole-position-fade"></div>
            <div class="pole-position-content">
                <span class="pole-position-label">POLE POSITION · P1</span>
                <h3>${driver.driver}</h3>
                <p>${driver.team} · #${driver.number}</p>
            </div>
            <div class="pole-position-time-box"><div class="pole-position-time">${driver.time}</div></div>
        </article>
    `;
}

function createPolePlaceholder() {
  return `
        <article class="pole-position-card upcoming-qualifying">
            <div class="pole-position-content">
                <span class="pole-position-label">POLE POSITION · P1</span>
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

function renderFastestLap(race) {
  /* ---------------------------------------------
       Future race
    --------------------------------------------- */

  if (!race.fastestLap) {
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

  const lap = race.fastestLap;

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
                    <strong>${race.totalLaps ?? "—"}</strong>
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

function phase2RenderNextRaceCountdown(next) {
  const countdown = document.getElementById("overviewNextCountdown");
  if (!countdown) return;

  if (phase2State.nextRaceCountdownTimer) {
    clearInterval(phase2State.nextRaceCountdownTimer);
    phase2State.nextRaceCountdownTimer = null;
  }

  if (!next?.dateStart) {
    countdown.innerHTML = `<span class="overview-countdown-label">NEXT RACE</span><strong>SEASON COMPLETE</strong>`;
    countdown.classList.add("complete");
    return;
  }

  const target = new Date(next.dateStart).getTime();
  if (!Number.isFinite(target)) {
    countdown.innerHTML = `<span class="overview-countdown-label">NEXT RACE</span><strong>DATE TBC</strong>`;
    countdown.classList.add("complete");
    return;
  }

  const update = () => {
    const remaining = Math.max(0, target - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    countdown.classList.remove("complete");
    countdown.innerHTML = `
      <span class="overview-countdown-label">NEXT RACE IN</span>
      <div class="overview-countdown-grid" aria-label="Countdown to next race">
        <div class="overview-countdown-unit"><strong>${String(days).padStart(2, "0")}</strong><span>DAYS</span></div>
        <div class="overview-countdown-unit"><strong>${String(hours).padStart(2, "0")}</strong><span>HOURS</span></div>
        <div class="overview-countdown-unit"><strong>${String(minutes).padStart(2, "0")}</strong><span>MINUTES</span></div>
        <div class="overview-countdown-unit"><strong>${String(seconds).padStart(2, "0")}</strong><span>SECONDS</span></div>
      </div>
    `;

    if (remaining <= 0) {
      clearInterval(phase2State.nextRaceCountdownTimer);
      phase2State.nextRaceCountdownTimer = null;
      countdown.innerHTML = `<span class="overview-countdown-label">NEXT RACE</span><strong>STARTING NOW</strong>`;
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

function setDashboardTab(name) {
  document.querySelectorAll(".dashboard-tab, .mobile-dashboard-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.dashboard === name);
  });
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
  return races
    .filter((race) => race.status === "COMPLETED")
    .sort(
      (a, b) =>
        new Date(a.dateStart || a.date) - new Date(b.dateStart || b.date),
    )
    .at(-1);
}

function phase2NextRace() {
  return races.find((race) => race.status === "UPCOMING") || null;
}

async function phase2LoadSeasonData() {
  if (phase2State.loaded || phase2State.loading) return;

  const latest = phase2LatestRace();
  if (!latest?.sessionKey)
    throw new Error("No completed race session available.");

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
                <span>NEXT ROUND / ${E(next?.shortName || "")}</span>
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

  const driverFeatures=phase2State.drivers.slice(0,3).map((d,i)=>`<article class="drivers-feature-row drivers-feature-${i+1}" style="--driver-accent:${phase2TeamColor(d.team)}"><span class="drivers-feature-pos">${String(i+1).padStart(2,"0")}</span><div class="drivers-feature-copy"><span class="rev-eyebrow">${i===0?"CHAMPIONSHIP LEADER":"TITLE CONTENDER"} / ${E(d.team)}</span><h3>${E(d.name)}</h3></div>${I(d.name)?`<img src="${E(I(d.name))}" alt="${E(d.name)}">`:``}<strong class="drivers-feature-points"><span>${P(d.points)}<small>PTS</small></span></strong></article>`).join("");
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

  const mobileNavToggle = document.querySelector(".mobile-nav-toggle");
  const mobileNavMenu = document.querySelector(".mobile-dashboard-menu");

  mobileNavToggle?.addEventListener("click", () => {
    const navbar = document.querySelector(".navbar");
    const isOpen = navbar?.classList.toggle("mobile-nav-open") ?? false;
    mobileNavToggle.setAttribute("aria-expanded", String(isOpen));
    mobileNavMenu?.setAttribute("aria-hidden", String(!isOpen));
  });

  document.addEventListener("click", (event) => {
    const navbar = document.querySelector(".navbar");
    if (!navbar?.classList.contains("mobile-nav-open")) return;
    if (navbar.contains(event.target)) return;
    navbar.classList.remove("mobile-nav-open");
    mobileNavToggle?.setAttribute("aria-expanded", "false");
    mobileNavMenu?.setAttribute("aria-hidden", "true");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const navbar = document.querySelector(".navbar");
    navbar?.classList.remove("mobile-nav-open");
    mobileNavToggle?.setAttribute("aria-expanded", "false");
    mobileNavMenu?.setAttribute("aria-hidden", "true");
  });
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
async function phase2Initialize() {
  setDashboardTab("overview");

  document.querySelector(".f1-logo")?.addEventListener("click", () => {
    document.querySelector(".navbar")?.classList.remove("mobile-nav-open");
    document.querySelector(".mobile-nav-toggle")?.setAttribute("aria-expanded", "false");
    document.querySelector(".mobile-dashboard-menu")?.setAttribute("aria-hidden", "true");
    setDashboardTab("overview");
  });

  document.querySelectorAll(".dashboard-tab, .mobile-dashboard-tab").forEach((button) => {
    button.addEventListener("click", async () => {
      document.querySelector(".navbar")?.classList.remove("mobile-nav-open");
      document.querySelector(".mobile-nav-toggle")?.setAttribute("aria-expanded", "false");
      document.querySelector(".mobile-dashboard-menu")?.setAttribute("aria-hidden", "true");
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
          [
            "overviewContent",
            "driversContent",
            "teamsContent",
            "championshipContent",
          ].forEach((id) => {
            document.getElementById(id).innerHTML =
              `<div class="dashboard-error">SEASON DATA UNAVAILABLE<br><small>${phase2Escape(message)}</small></div>`;
          });
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
    [
      "overviewContent",
      "driversContent",
      "teamsContent",
      "championshipContent",
    ].forEach((id) => {
      document.getElementById(id).innerHTML =
        `<div class="dashboard-error">SEASON DATA UNAVAILABLE<br><small>${phase2Escape(message)}</small></div>`;
    });
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

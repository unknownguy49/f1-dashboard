# F1 2026 Dashboard

A responsive Formula 1 season dashboard focused on giving fans a clear overview of the current season, individual Grand Prix weekends, championship standings, and race replay.

The project uses the OpenF1 API for live/historical Formula 1 data and the BigDataF1 API for additional race information.

## Features

### Season Calendar
- 2026 Grand Prix calendar and session schedules
- Grand Prix weekend information
- Sprint weekend sessions: Sprint Qualifying (SQ), Sprint (S), Qualifying (Q), and Race (R)
- Responsive calendar layout for desktop and mobile

### Overview and Countdown
- Season overview and current session context
- Countdown to the next relevant session
- Normal weekends follow the Practice → Qualifying → Race sequence
- Sprint weekends follow Practice → Sprint Qualifying → Sprint → Qualifying → Race

### Race Center
Provides session-specific information for selected Grand Prix weekends.

- Race results
- Qualifying results
- Starting grid
- Race movement and position changes
- Fastest lap information
- Practice results
- Sprint results and Sprint Qualifying results for Sprint weekends
- Race/Sprint selection when the selected meeting includes a Sprint

### Championship
- Driver championship standings
- Constructor championship standings
- Race-by-race championship position history

### Drivers
- Driver information
- Driver number and team association
- Championship context and driver-related information where available

### Teams
- Constructor information
- Team standings
- Driver associations
- Team branding and colors

### Head-to-Head (H2H)

Compare two drivers using season and race-weekend performance metrics.

- Side-by-side driver comparison
- Season Performance Score (SPS), combining race performance (45%), qualifying performance (25%), weekend points (20%), and sprint performance (10%)
- Two-Driver Matchup Score (TMS), combining race performance (40%), qualifying performance (25%), points (25%), and sprint performance (10%)
- Missing data is excluded from calculations, with remaining weights normalized
- SPS and TMS comparison charts with legends
- Comparison tables for driver performance
- Responsive chart layouts, mobile stacking, and horizontally scrollable results tables

### Race Replay
- Select a completed race/sprint for replay
- Visual representation of race-car movement around the circuit
- 22 drivers at a time, with the ability to select a single driver for focused playback
- Initial loading of the leading drivers before playback
- Playback controls, timeline seeking, and rewind
- Playback speed controls
- Telemetry loaded on demand to reduce unnecessary requests
- Additional telemetry can be loaded when seeking to data that has not yet been loaded

Race Replay does not automatically load telemetry for the latest race simply because the Race Replay page is opened.

### Pit Strategy

Provides pit-stop information for a selected Grand Prix.

- Pit-stop records with driver, pit lap, and tyre compound information where available
- Stationary pit-stop duration, sourced from BigDataF1
- Pit-lane duration from OpenF1, kept separate from stationary stop time
- Fastest stationary pit stop and average stationary stop time when valid duration data is available
- Dynamic race lookup by season and round using the BigDataF1 race index
- Graceful fallback when BigDataF1 data is unavailable, where supported by the application

Pit-stop data availability depends on the selected race and the completeness of the third-party data source.

### Data Availability and Cache Status
- Displays API/cache availability status
- Attempts to use cached data when a supported API request fails
- Retains previously cached data when a refresh does not return usable replacement data, where implemented by the cache workflow
- Data availability depends on OpenF1 and the existence of matching cached responses

### Persistent Tab State
The dashboard remembers the last selected main section in browser storage using the `f1_active_tab` key. Refreshing the page can therefore return the user to the previously selected section.

## Technology Stack

- HTML5, CSS3, Vanilla JavaScript
- OpenF1 API for Formula 1 session data and telemetry
- BigDataF1 API for race-index information and stationary pit-stop durations
- Vercel serverless functions for BigDataF1 requests in production
- GitHub Actions for scheduled cache refreshes
- Vercel for deployment

## Data Source

This project uses the OpenF1 API:

https://openf1.org/

OpenF1 provides historical Formula 1 data and session-specific information including meetings, sessions, drivers, results, laps, positions, starting grids and telemetry.

API base URL used by the project:

```text
https://api.openf1.org/v1
```

Pit Strategy supplements OpenF1 data with BigDataF1:

Race index endpoint: https://api.bigdataf1.com/api/races/jumper

Race details endpoint pattern: https://api.bigdataf1.com/api/races/{raceId}

## OpenF1 Endpoints Used

The application currently uses the following OpenF1 endpoints:

| Endpoint               | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `meetings`             | 2026 Grand Prix meeting/calendar information            |
| `sessions`             | Race, Qualifying, Sprint and Sprint Qualifying sessions |
| `session_result`       | Race, Sprint, Practice and Qualifying results           |
| `drivers`              | Driver information for a session                        |
| `laps`                 | Lap information and fastest-lap related data            |
| `starting_grid`        | Starting grid information                               |
| `position`             | Race position data                                      |
| `location`             | Car location/telemetry used by Race Replay              |
| `championship_drivers` | Driver championship standings                           |
| `championship_teams`   | Constructor championship standings                      |

The dashboard retrieves data from the OpenF1 API at runtime and can use matching JSON files in `data/cache/` when cached responses are available. The cache is maintained by the GitHub Actions workflow. New data can become available without a Vercel redeployment, provided OpenF1 has published it or an updated cache has been committed and deployed as static content.

## Application Structure

A simplified view of the application:

```text
User
 │
 ├── Overview
 │     └── Season / countdown / current context
 │
 ├── Drivers
 │     └── Driver information
 │
 ├── Teams
 │     └── Constructor information
 │
 ├── Championship
 │     ├── Driver standings
 │     ├── Constructor standings
 │     └── Position history
 │
 ├── Head-to-Head
 │     └── Driver vs Driver comparison
 │
 ├── Race Center
 │     ├── Grand Prix information
 │     ├── Calendar/session schedule
 │     ├── Race
 │     │    ├── Practice
 │     │    ├── Qualifying
 │     │    ├── Starting Grid
 │     │    ├── Race Result
 │     │    ├── Race Movement
 │     │    ├── Tire Stints
 │     │    ├── Pit Strategy
 │     │    └── Fastest Lap
 │     │
 │     └── Sprint weekend
 │          ├── Sprint Qualifying
 │          └── Sprint
 │
 └── Race Replay
       └── Select a completed race
         └── Driver selection
           └── Track movement visualization
             └── Playback and timeline controls
               └── On-demand telemetry

```

## Cache Fallback

The dashboard uses a combination of runtime OpenF1 API requests and locally stored JSON responses committed to the repository under `data/cache/`.

A GitHub Actions workflow runs the cache-refresh script, `scripts/refresh-openf1-cache.mjs`. The script requests supported OpenF1 data and writes successful responses to the cache directory. When cache files change, the workflow can commit those changes to the repository.

### How Cache Fallback Works

1. The dashboard attempts to retrieve the requested data from the OpenF1 API.
2. If a supported request fails, the application attempts to load the corresponding cached response when one is available.
3. If a usable cached response exists, the dashboard can display that data instead of failing immediately.
4. If neither the API nor the cache provides usable data, the requested information may remain unavailable.

### Cache Refresh Behavior

- The cache-refresh workflow can run automatically and can also be triggered manually through GitHub Actions when configured.
- Temporary rate limits and server errors are retried by the refresh script where configured.
- Existing non-empty cache data is preserved when a refresh returns an empty result, where implemented by the script.
- Failed requests do not necessarily prevent other successful cache files from being updated.
- A successful workflow run does not guarantee that every OpenF1 endpoint has data for every session.

Cached data may be older than the live API response. Cache fallback improves resilience, but it does not guarantee that every page or session will remain available during an API outage.

## Error Handling

- API requests retry temporary rate-limit (`429`) and server errors where configured.
- If a request still fails, the dashboard attempts to load the matching cached JSON response.
- The API status indicator distinguishes successful API access, cache fallback, and situations where no usable data is available.
- Data availability depends on OpenF1 publishing the relevant session information.

## Local Development and Deployment

This is a client-side application and does not require a custom backend or database. Open the project in a browser using a local static server, or deploy it to Vercel.

The browser stores only the selected dashboard tab (`f1_active_tab`) in `sessionStorage`. Updating cached data does not require a Vercel redeployment; a deployment is needed when the source code changes.

## Project Goals

The goal of this project is not to reproduce a full professional F1 telemetry or race-strategy platform.

Instead, it is designed as a season companion and recap dashboard.

The project focuses on answering:

- What races have happened this season?
- What happened at a particular Grand Prix?
- How did qualifying and the race finish?
- What was the starting grid?
- How did positions change?
- Who set the fastest lap?
- What happened on Sprint weekends?
- How is the championship developing?
- Can a completed race be replayed visually?

This keeps the application focused on useful season-level information rather than overwhelming users with every available telemetry or strategy metric.

## Limitations

- The dashboard focuses on the 2026 season.
- OpenF1 availability and publication timing affect which data can be displayed.
- Race Replay loads telemetry on demand and may require additional requests.
- The project does not provide authentication or a custom backend.
- Pit-stop data depends on BigDataF1 availability and the completeness of its race records.
- Stationary pit-stop duration may be unavailable for some stops; unavailable values should not be interpreted as zero.
- BigDataF1 requests require the configured server-side proxy in local development and the Vercel API route in production.

## Credits and Disclaimer

F1 data is provided by [OpenF1](https://openf1.org/).

This is an unofficial Formula 1 fan project. It is not affiliated with, endorsed by, or sponsored by Formula 1, the FIA, or any Formula 1 team. Check the terms of OpenF1 and third-party assets before redistributing or commercializing the project.

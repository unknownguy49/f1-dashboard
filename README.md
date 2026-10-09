# F1 2026 Dashboard

A responsive Formula 1 season dashboard focused on giving fans a clear overview of the current season, individual Grand Prix weekends, championship standings, and race replay.

The project uses the OpenF1 API for live/historical Formula 1 data and runs entirely as a client-side web application.

## Features

- **Season Calendar:** 2026 Grand Prix dates, session schedules, and Sprint weekend sessions.
- **Race Center:** Race and qualifying results, starting grids, race movement, fastest laps, and Sprint details.
- **Championship:** Driver and constructor standings with race-by-race position history.
- **Drivers and Teams:** Driver information, team associations, standings, and team branding.
- **Race Replay:** Visual race movement with driver selection, playback controls, timeline seeking, and telemetry loaded on demand.
- **Countdown:** Counts down to the next relevant session; practice sessions are excluded.
- **Persistent Tab:** Remembers the last selected dashboard tab using browser `sessionStorage`.

## Technology Stack

- HTML5, CSS3, Vanilla JavaScript
- OpenF1 API
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

## OpenF1 Endpoints Used

The application currently uses the following OpenF1 endpoints:

| Endpoint               | Purpose                                                 |
| ---------------------- | ------------------------------------------------------- |
| `meetings`             | 2026 Grand Prix meeting/calendar information            |
| `sessions`             | Race, Qualifying, Sprint and Sprint Qualifying sessions |
| `session_result`       | Race, Sprint and Qualifying results                     |
| `drivers`              | Driver information for a session                        |
| `laps`                 | Lap information and fastest-lap related data            |
| `starting_grid`        | Starting grid information                               |
| `position`             | Race position data                                      |
| `location`             | Car location/telemetry used by Race Replay              |
| `championship_drivers` | Driver championship standings                           |
| `championship_teams`   | Constructor championship standings                      |

The application makes API requests at runtime from the browser. Race data does not need a Vercel redeployment to become available.

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
 ├── Race Center
 │     ├── Grand Prix information
 │     ├── Calendar/session schedule
 │     ├── Race
 │     │    ├── Qualifying
 │     │    ├── Starting Grid
 │     │    ├── Race Result
 │     │    ├── Race Movement
 │     │    └── Fastest Lap
 │     │
 │     └── Sprint weekend
 │          ├── Sprint Qualifying
 │          └── Sprint
 │
 └── Race Replay
       └── OpenF1 position/location telemetry
```

## Cache Fallback

A GitHub Actions workflow periodically fetches OpenF1 data and stores successful responses as JSON files in `data/cache/`. The workflow commits changed cache files to the repository, making them available to the deployed static site.

When an API request fails or is rate-limited, the dashboard can use the corresponding cached response instead. This helps historical results remain available without relying on every browser request reaching OpenF1 successfully. Existing non-empty cache data is preserved when a refresh returns an empty result, preventing accidental replacement with empty data.

The cache is refreshed automatically by the workflow and can also be refreshed manually from GitHub Actions. A failed refresh does not remove previously committed cache files.

## Error Handling

- API requests retry temporary rate-limit (`429`) and server errors where configured.
- If a request still fails, the dashboard attempts to load the matching cached JSON response.
- The API status indicator distinguishes successful API access, cache fallback, and situations where no usable data is available.
- Some endpoints may legitimately return `404` when OpenF1 has no data for a session. These results are treated as missing data rather than proof that the entire dashboard has failed.
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

## Credits and Disclaimer

F1 data is provided by [OpenF1](https://openf1.org/).

This is an unofficial Formula 1 fan project. It is not affiliated with, endorsed by, or sponsored by Formula 1, the FIA, or any Formula 1 team. Check the terms of OpenF1 and third-party assets before redistributing or commercializing the project.

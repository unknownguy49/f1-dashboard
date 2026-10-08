# F1 2026 Dashboard

A responsive Formula 1 season dashboard focused on giving fans a clear overview of the current season, individual Grand Prix weekends, championship standings, and race replay.

The project uses the OpenF1 API for live/historical Formula 1 data and runs entirely as a client-side web application.

## Features

### Season Calendar

- Complete 2026 Formula 1 calendar
- Full Grand Prix weekend date ranges
- Session schedule for Qualifying and Race
- Sprint weekends with:
  - Sprint Qualifying (SQ)
  - Sprint (S)
  - Qualifying (Q)
  - Race (R)
- Responsive calendar layout for desktop and mobile
- Automatic session information from OpenF1

### Race Center

Provides a detailed recap of individual completed and upcoming Grand Prix weekends.

For normal weekends:

- Race Result
- Qualifying Results
- Starting Grid
- Race Movement
- Fastest Lap

For Sprint weekends:

- Race / Sprint selector
- Race Result
- Qualifying Results
- Race Movement
- Fastest Lap
- Sprint Result
- Sprint Qualifying Results
- Starting Grid

The Grand Prix header remains consistent when switching between Race and Sprint.

### Championship

- Driver championship standings
- Constructor championship standings
- Race-by-race championship position history
- Current season context

### Drivers

- Driver information
- Driver number
- Team
- Current championship context

### Teams

- Team information
- Team standings
- Driver associations
- Team branding and colors from OpenF1 data

### Race Replay

- Select any completed race
- Replay actual race car movement
- Select the drivers to display
- Initial Top 5 loading
- Driver telemetry loaded only when required
- Playback controls
- 10-second rewind
- Timeline seeking
- Automatic telemetry loading when seeking to unavailable data
- Playback pauses while required telemetry is loading
- Responsive replay interface

Race Replay is intentionally lazy-loaded. Opening the Race Replay page does not automatically download telemetry for the latest race.

### Countdown

The dashboard countdown follows the next relevant session.

Normal weekend:

1. Qualifying
2. Race

Sprint weekend:

1. Sprint Qualifying
2. Sprint
3. Qualifying
4. Race

Practice is intentionally excluded from the countdown because the dashboard is focused on the sessions most relevant to race-weekend viewing.

### Persistent Tab State

The last selected main dashboard tab is stored in browser `localStorage`.

Refreshing the page therefore keeps the user on the same section.

For example:

```text
Race Center → Refresh → Race Center
Championship → Refresh → Championship
Race Replay → Refresh → Race Replay
```

## Technology Stack

### Frontend

- HTML5
- CSS3
- JavaScript (Vanilla JS)
- Responsive design

### Data

- OpenF1 API

### Deployment

- Vercel

No custom backend is required. The browser communicates directly with the OpenF1 API.

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

## Race and Sprint Architecture

Each Grand Prix is treated as a meeting that can contain multiple sessions.

```text
Grand Prix Meeting
│
├── Practice
├── Sprint Qualifying   (optional)
├── Sprint              (optional)
├── Qualifying
└── Race
```

A Sprint selector is displayed only when the selected meeting contains an actual Sprint session.

The Grand Prix-level information such as circuit, location, round, weekend dates and circuit image remains shared between Race and Sprint views.

## Race Replay Design

Race Replay uses a lazy-loading approach to reduce unnecessary API traffic.

The workflow is:

```text
Open Race Replay
      ↓
Select completed race
      ↓
Click Load Replay
      ↓
Load race metadata
      ↓
Determine required drivers
      ↓
Load location telemetry
      ↓
Enable replay
```

When the user seeks to a point where required telemetry is unavailable:

```text
Seek
 ↓
Pause playback
 ↓
Load missing telemetry
 ↓
Verify requested timestamp is covered
 ↓
Resume / enable playback
```

This prevents the replay from running ahead of the available telemetry.

## Responsive Design

The dashboard is designed for:

- Desktop
- Tablet
- Mobile

Responsive behavior includes:

- Mobile navigation
- Responsive Race Center layout
- Responsive calendar cards
- Responsive Sprint/Race selector
- Mobile-friendly Race Replay controls
- Wrapped session labels and calendar legends
- Responsive track and Grand Prix information

## Deployment

The project is deployed on Vercel.

Because the frontend requests Formula 1 data directly from OpenF1 at runtime:

```text
User Browser
     │
     ├── Static files → Vercel
     │
     └── F1 data → OpenF1 API
```

A new race result becoming available through OpenF1 does not require a new Vercel deployment.

A deployment is only required when the project's source code is changed.

## Local Development

### Requirements

- Modern web browser
- Internet connection
- No backend server is required

Because this is a static frontend, it can be served using any local static server.

For example, with VS Code, the project can be opened using a local development/static server.

## Browser Storage

The project uses `localStorage` only for small client-side UI preferences.

Currently stored preference:

```text
f1_active_tab
```

This stores the last selected main dashboard section so that a refresh does not automatically return the user to Overview.

No authentication or sensitive user data is stored.

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

- The application depends on OpenF1 API availability.
- API data availability depends on when OpenF1 publishes and updates the corresponding session data.
- The dashboard is currently focused on the 2026 season.
- Practice is not included as a primary result section.
- Race Replay requires additional telemetry requests and therefore intentionally uses lazy loading.
- The project does not provide a custom backend or database.

## Credits

Formula 1 data is provided by OpenF1.

https://openf1.org/

## License

This project is intended as a personal project.

Check the terms and conditions of the OpenF1 API and any third-party assets before redistributing or commercializing the project.

## Disclaimer

This is an unofficial Formula 1 fan project.

It is not affiliated with, endorsed by, or sponsored by Formula 1, FIA, or any Formula 1 team.

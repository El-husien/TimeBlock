# TimeBlock - Chrome Extension

A productivity extension for focused work with Pomodoro technique and per-site time limits.

## Features

- **Time Tracking**: Automatic tracking of time spent on each website
- **Focus Mode**: Block distracting sites during focus sessions (25m/60m/custom)
- **Pomodoro Timer**: Work/break cycles with customizable durations
- **Per-Site Limits**: Set daily time limits for specific sites
- **Dashboard**: Full analytics with charts and data export
- **Notifications**: Alerts for focus end, pomodoro transitions, limits reached

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select this extension folder

## Files

```
extension/
├── manifest.json      - Extension config
├── background.js     - Background service worker
├── popup.html/js      - Quick popup UI
├── dashboard.html/js - Full dashboard  
├── blocked.html/js    - Blocked page UI
├── styles.css         - All styles
└── images/            - Icons (16, 48, 128, 256px)
```

## Usage

- Click the TimeBlock icon in toolbar to open popup
- Start Focus mode with 15m/25m/60m buttons
- Set per-site limits in the Focus tab
- Use Pomodoro tab for work/break cycles
- Open Dashboard for full analytics and settings

## Version

1.0.1
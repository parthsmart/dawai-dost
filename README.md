# Dawai Dost

Voice-first medicine reminder prototype for elderly users (Hindi, Tamil, Marathi, English).
Static site — no build step. Open `index.html` via any static server, e.g. `python -m http.server`.

- **Speech-to-text:** Wispr Flow API (add a key from platform.wisprflow.ai in Settings), falling back to the browser's speech recognition, then big buttons.
- **Understanding:** optional Claude API key in Settings; otherwise a built-in multilingual keyword parser (works offline).
- **Data:** stored only in the browser's localStorage. API keys too.
- **Demo:** Settings → Test clock → "Jump to next dose time" to trigger a reminder; +30 min to see a missed-dose family alert.

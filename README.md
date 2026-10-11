# Tube Radar

A static, browser-only radar for incoming London Underground trains. It talks to the [TfL Unified API](https://api.tfl.gov.uk/) from the page, so the whole site is HTML, CSS, and JavaScript. Push it to GitHub and turn on Pages. There is no build step and no server.

The scope is centred on a station you choose.

- **Range** is minutes until the train arrives. The centre is the platform. The rim is the selected range.
- **Bearing** is the track the train is approaching on, taken from the line's route and the train's reported position.
- **Only the closest train is labelled**, with its destination, line, and countdown. It also pulses.
- **Click a train** on the scope or in the list to show that train's destination. Click it again, or click empty scope, to clear it.

Trains on the same track are fanned a few degrees apart so the markers do not sit on top of each other. The list always shows every train.

## Run it locally

Opening `index.html` as a file will usually block the API. Serve the folder:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Search for a station, or use the chips. A station id can be bookmarked:

```text
http://localhost:8080/?station=940GZZLUOXC
```

The feed refreshes every 30 seconds. Between refreshes the markers drift inward as the countdown falls.

## Put it on GitHub Pages

1. Create a repository and push this folder to the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set the source to **Deploy from a branch**.
4. Choose branch `main` and folder `/ (root)`, then save.

The page will be at `https://<user>.github.io/<repo>/`. Paths are relative, so it works as a project site.

## Optional API key

Anonymous use is enough for one radar on a desk. If TfL starts refusing requests, register at the [TfL API portal](https://api-portal.tfl.gov.uk/) and paste the key into `config.js`:

```js
window.TFL_CONFIG = { appKey: "your-key" };
```

## Tests

```bash
node test/approach.mjs
```

## Data

Live arrivals are provided by Transport for London. This project is not affiliated with TfL. Their [open data terms](https://tfl.gov.uk/info-for/open-data-users/) apply to the feed.

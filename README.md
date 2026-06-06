# SSC — Simple Secure Chat

SSC (Simple Secure Chat) is exactly what it sounds like: a simple, self-hosted chat app that uses TLS and doesn’t try to be more than it needs to be.

It’s meant to be a private chat space you can run yourself, mess with, extend, or just use — without accounts, databases, or piles of dependencies.

---

## What it does

- Real-time text chat over secure WebSockets
- One-to-one browser audio/video calls over WebRTC
- File upload and download
- Image and video previews
- Push-to-record audio messages
- Desktop notifications when you’re tabbed out
- Local compressed message history
- Very small server footprint

No logins, no user system, no tracking, no analytics.

---

## What it *doesn’t* do (on purpose)

- No authentication
- No user accounts
- No database or external storage
- No remote persistence or analytics

The goal is “easy to understand, easy to change”.

---

## Why this exists

This started as “I just want a private chat that isn’t bloated or recordy”.

SSC is for:
- Small private groups
- Temporary chat setups
- Self-hosting experiments
- Learning how WebSockets, TLS, file streaming, and browser media APIs work

If you want something polished and production-grade, this probably isn’t it.
If you want something you can fully read and understand, it is.

Or in my own case, I couldn't be bothered with how some platforms are too firm about stuff, leading to "I wish I had a place where a third party didn't see my chat".

---

## Tech used

- Node.js (ES modules)
- HTTPS with TLS
- WebSockets
- Astro frontend
- MediaRecorder API for audio messages

The backend still stays small; Astro owns the browser UI and builds static files into `dist/`.

---

## Run it

Install dependencies, build the Astro frontend, then start the HTTPS/WebSocket server:

```sh
npm install
npm run build
npm start
```

By default the server listens on `https://localhost:25564`. Set `PORT` to use another port.

The Node server expects TLS files at:

```text
cert/key.pem
cert/cert.pem
```

For the bundled startup scripts:

```sh
./start.sh
```

On Windows:

```bat
start.bat
```

Both scripts start `server.js` and set the same TURN defaults used by `turnserver.conf`.

---

## Self-hosted TURN

Browser voice/video calls use WebRTC. For calls that work behind NATs and firewalls, run coturn next to the app.

This repo includes a working `turnserver.conf` shape. On Linux, copy or adapt it into coturn's config path:

```sh
sudo cp turnserver.conf /etc/turnserver.conf
```

Then set these values for your host:

- `realm` and `server-name` to your public chat hostname
- `relay-ip` to the machine's private/VPN IP if coturn is behind NAT
- `external-ip` to `PUBLIC_IP/PRIVATE_IP` if coturn is behind NAT
- `static-auth-secret` to a long random secret

The matching app environment should use the same host, realm, and secret:

```sh
TURN_HOST=chat.example.com \
TURN_REALM=chat.example.com \
TURN_SECRET=replace-with-the-same-long-random-secret \
npm start
```

The included `start.sh` and `start.bat` set these defaults:

```text
TURN_HOST=dermitio.duckdns.org
TURN_REALM=dermitio.duckdns.org
TURN_PORT=25510
TURN_RELAY_MIN_PORT=30000
TURN_RELAY_MAX_PORT=30030
TURN_RELAY_ONLY=true
TURN_ENABLE_TCP=true
```

The current `turnserver.conf` uses:

```text
listening-port=25510
min-port=30000
max-port=30030
```

Open these ports on the server/router:

```text
25564/tcp
25510/udp
25510/tcp
30000-30030/udp
```

`25564/tcp` is the HTTPS/WebSocket app. `25510` is TURN. `30000-30030/udp` is coturn's relay allocation range.

If you enable TURN TLS in the app with `TURN_ENABLE_TLS=true`, also configure coturn for TLS and open `25511/tcp` or whatever `TURN_TLS_PORT` is set to.

The app exposes `GET /turn-credentials` for short-lived WebRTC ICE credentials. Browser call code can use:

```js
const peer = await window.SSC.createPeerConnection();
```

By default the app sets `iceTransportPolicy` to `relay`, so peers do not expose direct IP addresses to each other. Set `TURN_RELAY_ONLY=false` before `npm start` if you want WebRTC to try direct peer-to-peer connections first.

---

## Status

It works.
It will probably not change much.
Stuff may break.
That’s fine.
Just keep bashing your head into it until it works again.

---

## Credits

Built by **Dermitio**.

Development was assisted via ChatGPT due to a severe lack of energy and a whole load of "I cant be bothered to find bug #23454332124356754 and then try to fix it".

---

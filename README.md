# SSC — Simple Secure Chat

SSC (Simple Secure Chat) is exactly what it sounds like: a simple, self-hosted chat app that uses TLS and doesn’t try to be more than it needs to be.

It’s meant to be a private chat space you can run yourself, mess with, extend, or just use — without accounts, databases, or piles of dependencies.

---

## What it does

- Real-time text chat over secure WebSockets
- File upload and download
- Image and video previews
- Push-to-record audio messages
- Desktop notifications when you’re tabbed out
- Very small server footprint

No logins, no user system, no tracking, no analytics.

---

## What it *doesn’t* do (on purpose)

- No authentication
- No user accounts
- No database
- No message history persistence (unless you add it)
- No frontend frameworks

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

Or in my own case I couldnt be bothered with how some platforms are too firm about stuff leading to "I wish I had a place where a third party didnt see my chat". 

---

## Tech used

- Node.js (ES modules)
- HTTPS with TLS
- WebSockets
- Plain HTML / CSS / JS
- MediaRecorder API for audio messages

That’s it.

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

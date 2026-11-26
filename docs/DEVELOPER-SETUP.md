# CEVIRI_AYBARION Live Support — Developer Setup

Signed-in aybarion.com members can talk **one-to-one, live and translated when
needed** with a site administrator.

- **Member:** clicks "I want to ask a question" and joins the queue right away,
  with no approval step.
- **Administrators:** see the queue with company names, get a sound alert when
  someone new joins, and see ongoing conversations.
- **Taking a conversation:** the first administrator to click takes it, and the
  room locks. Nobody else can join or see it.
- **During the conversation:** text and voice translation, direct voice when
  both speak the same language, camera, and photo/PDF exchange.
- **Transcript:** when the conversation ends, a dated PDF downloads
  automatically on the administrator's side. It includes the administrator's
  name, the customer's name, surname and company, and the whole conversation.

No server is required; everything runs in the browser over public MQTT
brokers, end-to-end encrypted. What the site has to add:

1. **Publish** the `canli-destek/` folder over HTTPS, e.g.
   `https://aybarion.com/canli-destek/`. It is plain static files, with no
   build step. Microphone and camera need HTTPS.
2. **Administrator password:**
   - Open `arac/yonetici-anahtari.html`, enter the site name and password, and
     leave "test login" **unchecked**.
   - Replace `canli-destek/support-config.js` with the downloaded file.
   - The bundled file is a TEST config.
   - The password is never stored in the file. Only people who know it can
     open the queue and the room keys.
3. **Identity:** serve `canli-destek/support-user.js` from your backend, per
   session (`Cache-Control: no-store`):
   ```js
   window.AYBA_USER = { role: 'member' | 'admin', firstName, lastName, company, id };
   ```
   - Return an empty script when the user is not signed in.
   - The role only selects the screen; administrator power is protected by the
     password.
4. **Top menu link:** show it to signed-in users only:
   ```html
   <a href="/canli-destek/" target="_blank" rel="noopener">Live Support</a>
   ```
   - You can also embed it as an iframe with
     `allow="microphone; camera; autoplay; clipboard-write"`.
   - For a cross-origin parent, add it to `parentOrigins` in the config and post
     `{ type: 'ayba-user', user }`.
5. **Shared transcript archive (optional):** use either
   - `transcriptUploadUrl` in the config, which receives a multipart `POST`
     with `pdf`, `meta` (JSON) and `messages` (JSON), sent with session cookies
     (accept it only from administrator sessions); or
   - `window.AybaSupportHooks.onTranscript({ pdf, filename, html, meta, messages })`.
6. **CSP:**
   - `connect-src` must allow:
     - `wss://broker.hivemq.com:8884`
     - `wss://broker.emqx.io:8084`
     - `https://translate.googleapis.com`
     - `https://clients5.google.com`
   - WebRTC uses the STUN servers `stun.l.google.com:19302` and
     `stun.cloudflare.com:3478`.
   - Allow `microphone` and `camera` in Permissions-Policy.

The Turkish guide (`GELISTIRICI-KURULUM.md`) has server-side examples for
Node.js and PHP and a short description of how it works.

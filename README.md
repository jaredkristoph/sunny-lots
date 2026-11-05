# Sunny Lots 🌻

A chill multiplayer planting game set in a subdivision of 8 lands.
Node.js + Express + WebSockets. 3D voxel graphics (pixelated, rotatable angled top-down camera)
rendered by a small built-in engine in `public/voxel.js` — no image files and no 3D library to install.

## Run locally

```bash
npm install
npm start            # http://localhost:3000
```

Testing growth quickly: `GROWTH_SPEED=3600 npm start` makes 1 real second = 1 game hour.

## Deploy on Render

1. Push this folder to a GitHub repo.
2. In Render: **New → Blueprint** and pick the repo (it reads `render.yaml`),
   or create a **Web Service** manually: build `npm install`, start `npm start`.
3. **Storage — pick one** (otherwise everything is wiped on each deploy/restart/spin-down):
   - **Upstash Redis (works on Render's free plan, no disk):** create a free Redis database at
     upstash.com, then add two environment variables in Render:
     `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (from the Upstash REST API section).
     The whole game state is saved under one key (`sunny-lots-db`, change with `UPSTASH_DB_KEY`).
     If you use this, remove the `disk:` block from `render.yaml` and set `plan: free`.
   - **Render persistent disk (paid plans):** `render.yaml` mounts one at `/var/data` and sets
     `DATA_DIR=/var/data`.
4. Keep it to **one instance** (state lives in memory and is saved every few seconds).
5. Free Render services sleep after 15 min of no visitors. Plants keep growing (they use
   timestamps), the server just wakes up on the next visit.

### How "grows while the server is down" works
Planting stores a timestamp. Growth is computed as `now - plantedAt` whenever anyone looks, so
nothing needs to be running while a plant grows. Tested: planted, stopped the server,
restarted it, harvested.

## Where to change things
Everything gameplay-related is in `catalog.js`: seed prices and grow hours, the golden chance
(`GOLD_CHANCE = 0.02`) and multiplier (`GOLD_MULT = 3`), starting money, furniture, clothes,
skin/hair colors, map layout.

## Controls
WASD / arrows to walk (Shift = run, movement follows the camera), **Q / E** or right-mouse-drag to
rotate the camera, mouse wheel to zoom, click a land to claim it, click your tiles to plant,
decorate or harvest, **F** at the shop, **Enter** to chat, **B** bag, **I** wardrobe.

## Livestock
Click a cow to milk it or a sheep to shear it (no mini-games). Each animal has its own cooldown
(`milkCd` / `woolCd` in `catalog.js`); a sheared sheep looks shorn until the wool grows back. Click any
of your animals or pets to name them — names are shown above them for everyone.

## Sunny Casino 🎰
Two tables east of the park (click one to play): **Roulette** (single zero; number 35:1, dozens 2:1,
red/black/odd/even/low/high 1:1) and **Blackjack** (dealer stands on 17, blackjack pays 3:2, double on
first two cards). Minimum bet is **$50** (`MIN_BET` in `casino.js`). All outcomes and money are decided on the
server. Each table has an **Info & Top 10** tab with shared stats (rounds, bets, wagered, paid out, biggest win)
and the top 10 players by net winnings. Emotes: **G** or the 😀 button, or `/dance`, `/sit`, … in chat.

## Accounts
Pick a username, the server generates a password and shows it once. There is no password reset.

## Admin & mail
- Open `/admin` on your site. Set the `ADMIN_PASSWORD` environment variable on your host (Render → Environment). If it is not set, a temporary random password is printed in the server log on every start.
- The admin page lists every player with cash and estimated net worth (cash + crops, products, seeds, furniture, clothes, animals/pets, land at shop prices), and can send mail to one player or everyone, optionally with money attached (event rewards).
- Players see a **📬 Mail** button with a red badge for unread letters and claim attached money from the letter.

## Farm helpers, bank & slots
- **☑️ Select** (HUD): tap many of your tiles, then plant a seed on all empty ones or harvest all ripe ones (also "Harvest ALL ready").
- **🧌 Orc Market** ($20,000, one per player): auto-harvests and auto-plants for you; settings for jobs, seed, and follow / roam.
- **🏦 Sunny Bank**: savings earn 2%/day (first $50k); loans up to $2,000 at 5%/day (capped at 2× borrowed) after playing on 2 different days.
- **🟢 N online** in the HUD (click for the list).
- **🎰 Super Ace Slots** in the casino: 1,024 ways, cascading multipliers, golden→wild cards, free spins, Buy Bonus (40× bet). All outcomes are decided by the server.

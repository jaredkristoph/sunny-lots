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
- **🃏 Blackjack**: play 1–5 hands at once; split pairs (up to 5 hands total), double, blackjack pays 3:2.
- **🎴 Baccarat** (Punto Banco): Player / Banker (0.95:1) / Tie (8:1) / pairs (11:1), real third-card rules.
- **⬆⬇ Higher / Lower**: guess the next card, build a multiplier streak, cash out any time (3% edge per guess, ties win).

## Bitmonsters 🐾 (Phase 1)
Sunny Lots is now a walled hub town. The **east gate** leads to **Route 1** (open world, tall grass, trainers, talkers); the south gate is a closed prop for a later region.

- **151 original bitmonsters** (`public/monsters.js`): 12 types with a full type chart, 66 moves with **PP**, base stats, levels, evolution lines, 3 starters (Embrix 🔥 / Mossling 🌿 / Ripplet 💧), a rare Day-7 line (Dracolet) and 5 legendaries (not yet placed in the world).
- **Login flow**: first login → choose a starter → 7-day daily reward (Day 7 = Dracolet Lv10 + Master Orb). Streak resets if a day is missed.
- **Battles** (`battle.js`, server-authoritative): turn-based, PP + Struggle, STAB/type effectiveness, stat stages, burn/poison/paralysis/sleep, XP/level-up/evolution, catching with 10 orb kinds (Bit, Great, Ultra, Master, Net, Dusk, Quick, Timer, Repeat, Heal), potions/revives/ether. Wild encounters happen in Route 1 tall grass; trainers challenge you when you walk up, or click them.
- **Bitmon Center** (inside the east side of town): free healing + Bit Mart. `🐾 Bitmon` button (or `M`): party, box, dex, items, nicknames.
- **Admin → 🐾 Bitmonsters**: searchable list of all 151 with types, base stats, evolutions, full learnsets (level, power, accuracy, PP, effects) and where each is found.



## Phases 2–4
- **Open world**: a 412-tile-wide map. Follow Champion Road east from Sunny Lots: Route 1 → Greenhollow → Route 2 → Marinport → … → Zenith City (8 routes, 8 towns). Each town has a Bitmon Center (free healing + Mart). `🗺 Map` (or `N`) shows the whole world, badges and your position.
- **8 gyms & badges**: Leaf, Aqua, Volt, Flame, Stone, Toxic, Frost, Mind. Each needs the previous badge; leader teams scale from Lv 14 to Lv 56. Badges show in the `🐾 Bitmon → 🏅 Badges` tab.
- **Natures & stats**: every monster has a random nature (+10% / −10% to two stats, or neutral) and random IVs. The monster page shows a radar chart of its stats.
- **Legendaries**: 5 shrines at the north end of Routes 4–8 (3 / 4 / 5 / 6 / 8 badges). Each legendary can be caught once per player.
- **Friendly PvP**: click another player (or use `🟢 online → ⚔ Battle`). They accept or decline; both teams are full-health copies, so nothing is lost. Both players pick a move each turn (45 s auto-move), and wins/losses are tracked.

## Organic world (east of the wall)
Everything east of Sunny Lots is generated from fixed seeds in `public/monsters.js` (`TERRAIN`), so the server, every client and the map all agree: winding main road, jittered side trails with clearings/shrine plazas, blobby tall-grass meadows (wild encounters only happen on these tiles), ponds, rivers with bridges, sandy shores and natural forests. Static scenery is batched with InstancedMesh in `hd2d.js`.

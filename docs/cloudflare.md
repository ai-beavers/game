# On Cloudflare

Everyone plays at <https://game.ai-beavers.com/>, in one shared world of up to 16 players.

- **Addresses**: `game.ai-beavers.com` is a custom hostname (Cloudflare for SaaS) on the `uq.dev` zone: the
  ai-beavers.com owner's proxied CNAME points it at `aib-game.uq.dev`, and the Worker route `aib-game.uq.dev/*`, set in
  the dashboard and not in `wrangler.jsonc`, sends both to the Worker. <https://beaver.uq-dev.workers.dev/> still works.

- **Publishing**: every push to `main` that passes `check` is deployed by the `deploy` job of `.github/workflows/check.yml`
  (`wrangler deploy`). Players reconnect by themselves and load the new build once. The world's work stays.
- **What runs there**: one Worker (`worker.ts`, `wrangler.jsonc`). Cloudflare serves the files of `dist/` itself. One
  Durable Object holds the world with the same rules as `server.ts`: both run `src/features/net/room.ts`.
- **House of AI events**: both servers answer `/net/events` from the House of AI Hamburg's public Luma calendar
  (`src/features/shop/events.ts`); the Calendar board asks it hourly (ADR 0006). On Cloudflare the Cron Trigger
  `17 4 * * *` (`wrangler.jsonc`) fetches the feed once a day into the Workers KV namespace `beaver-house-of-ai-events`
  (binding `EVENTS`, fixed id, so a deploy never makes one), and requests only read it. The Bun server asks once a day
  and, with `WORLD_FILE`, keeps its copy in `${WORLD_FILE}.events` over restarts.
- **Credentials**: the GitHub environment `production` holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and
  takes runs from `main` only.
- **Starting the world afresh**: set the token once with `bunx wrangler secret put RESET_TOKEN`, then
  `curl -X POST -H "Authorization: Bearer <token>" https://game.ai-beavers.com/net/reset`. Without the secret
  the address answers 404.
- **The Old Beaver's voice**: set the key once with `bunx wrangler secret put ELEVENLABS_API_KEY`. The world's
  Durable Object asks ElevenLabs for each line once and sends the sound to every player (ADR 0010); every talk with
  ElevenLabs is in the Worker's logs. Without the secret he murmurs.

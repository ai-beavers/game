# The server keeps the only world; a page keeps none

Players' games drifted apart. Each browser kept its own copy of the world's work in `localStorage`, and while the server's world was still empty, the first player in brought their copy along. So a copy from another build, with trees the present world lacks, could become everyone's world and stop the game at its start (PR #66). Now the server's world is the only one. A page asks for it before the game is made and starts in it. A change goes to the server, which checks it and tells everyone. When the server's world is another than the one on the page, the page loads again and starts in the server's. The world lives in the server's memory. That is enough: the Bun server keeps it in a file when `WORLD_FILE` is set, and the Durable Object on Cloudflare keeps it in its own storage.

Where the loose wood lies is the server's too. The room remembers what the host last said and tells the next player who comes in as the first, so wood lies where it was left after a reload. It is not written to the file.

The tour gets a world of its own on the server, beside the players', asked for with `?world=tour`. We did not let the tour play in the players' world: a test would fell everyone's trees. We did not keep the tour's world in the page: on the stream the dam would start over with every deploy. In the tour's world any player may start the world afresh, and a tree may grow back before its time, because the tour does both.

What belongs to one player stays in that player's browser for now: experience, outfits and goods (ADR 0003). Moving them needs a way to know a player without an account.

## Consequences

- Without a server the game is played alone in a fresh world that ends with the page.
- A Bun server without `WORLD_FILE` starts the world afresh for everyone when it restarts. Players can no longer bring it back.
- Two tours on one server share the tour's world and see each other. The tour's own runs each start a server of their own.
- The saved game of ADR 0003 no longer holds the traded sticks: they are part of the world's work on the server.
- A world kept by the server from a build with more trees still names trees the present world lacks. The server does not know how many trees the world has.

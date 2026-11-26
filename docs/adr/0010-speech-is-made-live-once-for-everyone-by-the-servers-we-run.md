# Speech is made live, once for everyone who listens, by the servers we run

ElevenLabs can turn text into speech and speech into text. This is the design of 2026-11-20 for using it. The Old Beaver's voice is built; dictation is not. What the two are for was worked out from the code and the wishes, not said by the maintainer: the Old Beaver gets a voice (the wish behind him asked that he "speak audio", and his spec left real words out), and a player can use dictation for a chat line. The maintainer set five rules:

1. Nothing is recorded ahead of time: speech is always made live.
2. When a creature such as the Old Beaver talks, there is one stream from and to ElevenLabs, however many players stand in front of him.
3. The key is kept on Cloudflare only and never goes to a player's browser.
4. `bun dev` speaks with ElevenLabs too.
5. A developer's machine has the key as well.

## Live

A voice is made at the moment the creature speaks, and nobody keeps the sound: not the server, not the page. The same line told twice is made twice. We did not make sound files ahead of time, which was the first design: they cost a few cents once, start without a wait and play when ElevenLabs cannot be reached, but a file is a recording. We did not let the server keep a line after its first telling: that saves nearly all the money and the wait, but read by the word it is a recording too. The maintainer may read the rule more loosely; then this is the first thing to take back.

## Once for everyone

A creature that talks tells once, for the world. Until now the Old Beaver told each player alone: the page watched its own player and kept its own turn through the lores. Now the room keeps it, as it keeps the world (ADR 0007): whether he is telling, which lore comes next, which line he is at and when it ends. A page only tells the room how near its player is to him: out of earshot, in earshot, at his side, close enough to be told a lore, or afloat at his side. The room takes the page's word for it, as it takes its word for where the player stands. For each line the server asks ElevenLabs once and sends the sound over the world's own socket to every page as it arrives. Each page plays it from where he sits and shows the words while its player is near.

We did not keep one stream for each player, the design before this one. It costs as many times as there are listeners, and players standing side by side would hear different lores, or the same line a moment apart in two slightly different voices. The price of telling once: the telling is no longer a player's own. Who arrives in the middle hears the rest and not the beginning. A lore someone missed comes back only when the turn has gone round. His rules move from the page into the room, and his spec had kept them out of the network on purpose.

"One stream from and to ElevenLabs" is read here as: the words go to ElevenLabs and the sound comes from it, in one request for each line, one at a time for each creature in a world. That is what ElevenLabs advises when the words are known before they are spoken. Two other readings were not taken, and the maintainer has to say if one of them was meant: one socket held open for the whole telling, into which the lines are sent one after another; or a talk in which the creature also listens and answers, for which ElevenLabs has its own product.

The Old Beaver is the first creature with a voice, not the only one this is made for. The rule is for any creature that talks: one telling at a time, the room keeps its turn, one stream.

## The key stays with the servers we run

The key is held by the servers we run and by nothing else: the Worker on Cloudflare has it as a secret, and the Bun server on a machine of ours reads it from its environment. Both call it `ELEVENLABS_API_KEY`. It never goes to a player's browser. It is not in the repo. On a machine of ours it lies in `.env` in the repo's folder, which git ignores and Bun reads by itself. A variable of the same name set in the shell wins over that file.

The third rule first read "only on Cloudflare", and the design that followed gave the voice to the game on Cloudflare alone. The fourth and fifth rule changed that: `bun dev` speaks too, with a key of its own machine. We looked at keeping the key off the machine, with the Bun server asking an address on Cloudflare for each line; the maintainer chose the key on the machine instead, which needs no address that strangers can call.

Nothing made from the key goes to the browser either. Dictation, when it is built, is to work the same way: the page sends the microphone's sound over the world's socket, the server passes it to ElevenLabs while the player speaks, and the words come back the same way. Today the room drops every message from a page that is not text. An earlier design gave the page a single-use token to talk to ElevenLabs itself. That the rule reaches as far as tokens is our reading, not the maintainer's word.

The talk with ElevenLabs is written once, beside the room, and knows neither Bun nor Cloudflare. Each server hands the room a way to speak, made with its key, as it hands it a place to keep the world. The telling, its turn and the sending to every page are the room's, the same on both servers.

## When the Bun server speaks

The Bun server speaks only when it has the key and is told to speak, and `bun dev` is what tells it. A key in the environment is not enough. On the maintainer's machine the key is exported to every shell, and the tour and the stream's live tour start the same Bun server from such a shell. Bun also reads `.env` for every `bun server.ts` started in the repo's folder, as the tests and the tour with `--here` do. Left to the key alone, every run of the tour would spend money and need the network, and nobody would have decided it.

## What can be asked, and what a flood costs

The server says only the game's own lines, which the room looks up itself; no address takes a text to say. He tells one lore at a time, however many players stand before him. The room asks ElevenLabs for at most one line every four seconds, five in one go; beyond that he murmurs, however often players walk off and come back. So the most a world can cost is a telling that never stops, about 15 lines a minute, and the number of players changes nothing. That holds for a world on a developer's machine as for the one on Cloudflare. Each server holds two worlds, the players' and the tour's. Only the players' world speaks: in the tour's he murmurs, on every server, so the tour never spends. One page that says it comes and goes is enough to reach the limit, because the room takes its word; while it does, he murmurs for everyone else.

## Consequences

- Who hears his voice: the game on Cloudflare, and `bun dev` on a machine that has the key, in the players' world. Who hears the murmur: the tour's world on every server, so the tour and the stream's live tour (the tour would spend money on every run); and anyone who builds the game without the key, a contributor or an agent.
- The Worker is not asked whether it may speak: it speaks whenever it has the key. On a machine of ours `wrangler dev` reads the same `.env` when no `.dev.vars` lies beside it, so the local Worker speaks too. The Worker the tests start is told not to read it.
- The room tells once for everyone on both servers. Without a voice the telling is the same, murmured: the room says which line he is at, and each page murmurs it.
- Without any server the page tells its one player by the same rules, murmured.
- The voice can be tried on a developer's machine before it is published. What only Cloudflare has, the secret and the Durable Object's part, is first run where it is published; tests check the talk with ElevenLabs against a stand-in with a made-up key, as the House of AI events are checked (ADR 0006).
- Local runs cost money: each lore told under `bun dev` is paid for like any other.
- When ElevenLabs gives no sound within three seconds, is down or over its limit, he murmurs that line; the next line is asked for again. The murmur stays in the game for good.
- A line stays up until its voice has ended, plus the pause; the room knows the length only when the sound has all arrived. Until then it counts the murmur's time for the line, so a voice that arrives more slowly than that is cut by the next line. A murmured line is timed by its words, as before.
- He tells on while anyone is in earshot. When the last listener walks out of earshot in the middle, the room cuts the line it asked for and asks for no further one. The line already asked for is paid for. His closing word is never asked of ElevenLabs: the pages show and murmur it.
- After a lore has ended he begins the next only once everyone has left his side. A player who stays beside him keeps him silent for all who come.
- The turn through the lores is not saved. A deploy ends the Durable Object (ADR 0005): a telling stops in the middle of a line, and the next one starts at the first lore.
- Every talk with ElevenLabs is written to the server's log: the line asked for, how long the first sound took, and how it ended.
- He turns to the player who listens on that player's own page, so two players see him face two ways. Sending whom he tells to would mend it.
- While he talks, every page in the world is sent the sound, near him or far, and plays it quieter with distance, silent a little beyond earshot. That is simple for a world of 16; a bigger world should send it only to those in earshot.
- A Durable Object may hold six connections out at once. That is the most creatures that can speak and players that can dictate in one world on Cloudflare at the same moment.
- The tour as a test runs its page four times faster than real time, while the room tells in real time. The station that hears a lore holds with that: it waits for what the room tells.
- A creature that answers what a player says is a smaller step now: the sound already goes from the server to every page, and with dictation it will go both ways. It still needs something that writes the answers, and a decision to say words that were not written ahead.
- With dictation a player's speech will pass through our server, which is to keep none of it. ElevenLabs keeps the sound and the words by its own rules (keeping nothing is for its Enterprise plan only), so the game has to say so before the first time it listens.
- His voice is heard by everyone who plays. What ElevenLabs allows for the account's plan (use for money, naming ElevenLabs) holds for it.
- One key serves Cloudflare and the maintainer's machine; the maintainer chose one over a key for each place. It should carry a fixed sum a month, so a flood ends at that sum. A key lost from a machine can only be ended by silencing the game until a new one is set in both places.
- Anyone who runs `bun dev` with a key of their own hears his voice, not only the maintainer.

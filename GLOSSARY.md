# Beaver

A browser game in which a player steers a beaver through a small world and builds a dam. Agents build it from viewers' wishes while a live stream shows the game playing itself.

## Language

### The world

**Clearing**:
The round meadow the whole game takes place in, closed by a bank that rises into thicket.
_Avoid_: map, level, arena

**Pond**:
The water in the clearing. Its level rises with the dam.
_Avoid_: lake, river

**Basin**:
The deep part of the pond, where the beaver can dive.
_Avoid_: deep end, pit

**Shore**:
Where the pond meets the land, all the way round; it moves out as the pond rises. The beaver goes into the water and out of it anywhere along it.
_Avoid_: edge, side, hole, bank (the bank is the clearing's)

**Building site**:
The flat ground at the pond where the dam is built.
_Avoid_: construction zone, build area

**Day**:
One turn of sun and moon over the clearing, twelve minutes of play. Everyone in the same world is at the same hour of it; a player alone keeps their own.
_Avoid_: time, daytime, cycle

**Stick**:
A piece of wood the beaver can carry and build with. Every tree gnawed into wood yields sticks.
_Avoid_: log, branch, wood item

**Lantern**:
The light the beaver carries in its left hand, hanging by its handle, while it is dark; by day it rides in the backpack. It glows from dusk until dawn, unless the player has switched it off. The right hand stays free for sticks.
_Avoid_: lamp, torch, light

**Backpack**:
The small pack the beaver always wears on its back. The lantern is kept in it by day; at dusk the beaver reaches over its shoulder to take the lantern out, and at dawn puts it back.
_Avoid_: bag, rucksack, satchel

**Trading post**:
The stall in the clearing where the beaver pays sticks for goods. Each good lies on its own spot with its price in sticks.
_Avoid_: shop, store, market

**Good**:
A thing the beaver gets at the trading post for sticks and keeps in its backpack: a pinecone, a duck feather, a river shell.
_Avoid_: item, loot, product

**Hotbar**:
The row of five slots at the bottom of the screen. The first shows what the beaver carries (a stick) or nothing, the others the goods in the backpack with their counts. Selecting a good's slot (keys 1 to 5, the d-pad's left and right, a tap) brings it out of the backpack into the beaver's left paw; selecting the first slot or the same one again puts it back. A good in the paw still counts in the backpack.
_Avoid_: inventory, toolbar, quickbar

**Shop**:
The small disco-like hut in the clearing with the sign HOUSE OF AI in front; inside it is a café where the shopkeeper sells outfits and other creatures work at laptops.
_Avoid_: store, House of AI (that is only its sign), disco, trading post (that is the stall where sticks buy goods)

**Calendar board**:
The big board beside the shop that shows the real week, Monday to Sunday, in which the viewer's own today falls, with today marked, the hours of each day from morning to midnight, Build Fridays and the House of AI events, as a desktop calendar's week view does. It counts real days and hours on the viewer's own clock, not the clearing's days.
_Avoid_: billboard, calendar sign, schedule, week board

**Build Fridays**:
The weekly event on the Calendar board: every Friday from 16:00 to 23:00, by the viewer's own clock.
_Avoid_: build day, Friday event

**House of AI events**:
The real events of the House of AI in Hamburg, the place the shop's sign is named after, as its public Luma calendar lists them; the Calendar board shows those of its week beside Build Fridays, each at its real moment on the viewer's own clock.
_Avoid_: Luma events, meetups, shop events

**Shopkeeper**:
The female beaver behind the shop's counter who sells outfits. No player steers her and, unlike an animal, she never leaves her place or flees.
_Avoid_: NPC, vendor, merchant

**Mrs. Beaver**:
The player's own beaver companion, with a flower behind her ear. At the start of each visit she has been carried off and is shut in a pen of sticks under one of the brush piles at the hiding places out in the meadow, where the clearing's first, smaller bank stood, and she left clues on the way there. The player rescues her in a quest, and then she waits at the building site with her flower back. Each player has their own, and no one else sees her.
_Avoid_: wife, mate, partner, NPC, Shopkeeper (that is the beaver behind the shop's counter)

**Old Beaver**:
An old, grey-muzzled beaver who sits hidden at the foot of the bank, among the trees at the clearing's edge, always in the same place. No player steers him and, unlike an animal, he never leaves his place or flees. When a player comes close he turns to them and tells a lore in a low murmur, its words shown in the HUD. Everyone finds him in the same place; what he tells, each player hears alone.
_Avoid_: elder, sage, wise beaver, NPC, Shopkeeper

**Lore**:
One short tale the Old Beaver tells about the clearing's past, a few lines long. He tells them in turn, a new one each time a player comes close again.
_Avoid_: story, legend, dialogue, quest (a lore asks nothing of the player)

**Quest**:
A short list of steps the player works through in order, shown as a checklist in the HUD; a step counts only once the ones before it are done. Rescuing Mrs. Beaver is one: find her flower, find her tracks, find her, gnaw her pen open. Nothing on the map marks where a step is.
_Avoid_: mission, task, goal (the build goals point the way; a quest does not)

**Clue**:
A sign Mrs. Beaver left on her way to where she is hidden, which tells the player where to look: first her dropped flower, then her tracks, a short trail of paw prints pointing towards her brush pile.
_Avoid_: hint, marker, waypoint

**Brush pile**:
A heap of leafy branches at a hiding place. Each hiding place has one, and they all look alike from outside; only one hides Mrs. Beaver's pen, and only the clues tell which.
_Avoid_: bush, decoy, hideout

**Step**:
One line of a quest, ticked when the player has done it.
_Avoid_: objective, stage, task

**Outfit**:
A matching look for the beaver's shirt and hat, bought once at the shop with experience and then worn whenever the player likes.
_Avoid_: skin, costume, clothes

**Canoe**:
The small wooden boat that lies on the pond's bank. The beaver gets in, sits and paddles it across the pond, and gets out on the bank or into the water. Each player has their own.
_Avoid_: boat, raft, kayak

**Flag**:
The cloth with the AI beavers logo on a pole on the bank beside the building site. The player can set it alight; it burns down to a charred rag and a fresh one is raised at the next dawn. The fire never spreads beyond it. Each player has their own.
_Avoid_: banner, pennant, standard

**Dam**, **Lodge**, **Food cache**:
The three things built from sticks, in this order: the dam at the building site, the lodge in the pond, the cache on the pond's bed beside it.
_Avoid_: base, house, storage

### Playing

**Player**:
A person steering a beaver, or the beaver they steer.
_Avoid_: user, character

**Sit**:
The beaver resting upright on its haunches on land, tail flat on the ground, for as long as the player holds it there. Moving gets it up again.
_Avoid_: crouch, rest, kneel

**Crawl**:
The beaver going low on all fours on land, slower than walking, for as long as the player holds it there.
_Avoid_: crouch, sneak, prone

**Flash**:
The player switching the lantern off and on with one button while it is dark, so that other players see it blink. A flash means what the players agree it means; the game gives it no meaning.
_Avoid_: blink, signal, toggle

**Stare**:
The beaver turning round on land to look straight into its own player's camera, unblinking, once the player has touched nothing for a minute. Any input ends it. Only that player sees it.
_Avoid_: AFK, idle animation, look-at

**Remote**:
Another player's beaver as this browser draws it.
_Avoid_: peer, other client

**Bot**:
A player without a browser that joins over the network and does beaver work under the same rules as a person.
_Avoid_: NPC, AI player

**Animal**:
A creature of the world that no player steers: ducks, fish, deer.
_Avoid_: NPC, mob, wildlife entity

**Third-person view**, **First-person view**:
The two ways a player can see the clearing. In the third-person view (the usual one) the camera follows behind the beaver, which is in the picture. In the first-person view the player sees through the beaver's eyes, and the beaver itself is not in the picture. Each player switches between them for their own screen only.
_Avoid_: camera mode, POV, cockpit view

**Experience**:
The points a player earns by building with sticks, one for each stick built in, and spends at the shop.
_Avoid_: XP, coins, money, score (the player card writes "XP" only as the unit after its numbers: "12 / 30 XP")

**Level**:
How far a player has come, from all the Experience they ever earned; spending Experience at the shop does not lower it. Level 2 takes 20 Experience, each level after 10 more than the one before. The player card shows it.
_Avoid_: rank, tier

**Player card**:
The card at the top left of the HUD: the player's name, their level and how much Experience they still need for the next one.
_Avoid_: profile, badge, Experience pill

**Quest tracker**:
The card under the player card: the build goal at hand, its count and how to do it, and under it the quest (Mrs. Beaver's) with its step at hand.
_Avoid_: goals panel, mission log

**Saved game**:
What a player's browser keeps between visits: their experience, outfits and goods. The trees, the dam, the lodge and the cache are not part of it: they are the world's work, which only the server keeps.
_Avoid_: save file, progress

**World's work**:
What the beavers have done to the world: trees gnawed and felled, the wood they gave, the dam, the lodge and the cache. The server keeps it, and every player's page starts in the server's.
_Avoid_: world state, save

**Tour's world**:
The world the tour plays in, kept by the server beside the players' world, so the tour never changes a game someone plays.
_Avoid_: test world

### How the game is put together

**Part**:
One of the folders the game cannot run without (`beaver`, `anim`, `player`, `world`, `props`). Parts know each other only through `src/contracts.ts`.
_Avoid_: module, package, layer

**Feature**:
A folder in `src/features` that adds to the game through `create(game)` and is listed in `FEATURES`. The game runs without any one of them.
_Avoid_: plugin, system, component

**Stage**:
The engine, scene, camera, HUD texture and physics world every part and feature draws on and steps in.
_Avoid_: context, app, renderer

**HUD**:
Everything drawn over the world for the player: the player card, the quest tracker, the map, hints, the hotbar, menus, touch controls.
_Avoid_: UI, GUI, interface

**Overlay**:
The helper that draws a group of HUD elements and gives each interactive one a transparent native counterpart.
_Avoid_: layer, widget, DOM UI

### The tour

**Tour**:
The game playing itself: the beaver goes through the stations round after round and checks each. It is the test every change must pass and the picture the stream shows.
_Avoid_: end-to-end test, demo, playthrough

**Station**:
One player-facing behavior played and checked by the tour, with a name a viewer can read ("Fell a tree").
_Avoid_: test case, scenario, step

**Activity**:
A named group of stations that are played in order and shown as one thing on the stream ("Dam work").
_Avoid_: suite, chapter, sequence

**Reason**:
The line in the live tour's caption that says, in the beaver's own words, why it does the activity now ("Warm noon. Time for a swim.").
_Avoid_: thought, motive, subtitle

**Round**:
One pass of the tour through its stations.
_Avoid_: run, iteration, cycle

**Fast tour**:
The tour as a test: the world runs four times faster and long ways are skipped.
_Avoid_: test mode, speedrun

**Live tour**:
The tour for the stream: real time, a director that picks the activity the beaver wants most now, a caption with its reason, and a camera held as a player holds it, behind the beaver.
_Avoid_: stream mode, spectator mode, demo mode

**Soak**:
Many whole tours in a row to find stations that fail only sometimes.
_Avoid_: stress test, burn-in

**Flake**:
A station that fails without a change that broke it.
_Avoid_: intermittent failure, random failure

### Where changes come from

**Wish**:
What a viewer asks for in the stream's chat, in their own words.
_Avoid_: request, suggestion, idea

**Spec**:
A wish worked out into an issue an agent can build in one session, with a station as its acceptance check.
_Avoid_: ticket, PRD, task

**Builder**:
An agent that builds one spec on its own branch.
_Avoid_: worker, coder, dev agent

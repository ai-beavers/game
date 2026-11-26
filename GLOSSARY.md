# Beaver

A browser game in which a player steers a beaver through a small world and builds a dam. Agents build it from viewers' wishes while a live stream shows the game playing itself.

## Language

### The world

**Clearing**:
The round meadow the whole game takes place in, closed by a bank that rises into thicket.
_Avoid_: map, level, arena

**Path**:
The strip of trodden earth through the clearing's grass from the spawn to the building site, also drawn on the map. It only shows the way; the beaver walks as fast beside it.
_Avoid_: road, trail (Mrs. Beaver's clues are a trail), track

**Meadow flowers**:
The daisies and buttercups that grow in drifts in the clearing's grass, small, white and yellow. They cannot be picked, and none grow where Mrs. Beaver's flower may lie. Mrs. Beaver's flower is not one of them.
_Avoid_: flower (alone, that is hers)

**Golden hour**:
The time a low sun shines through clear air, morning and evening: warm light, blue shadows, and a haze that glows towards the sun.
_Avoid_: sunset, dusk (the lantern's hour)

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
A thing the beaver gets and keeps in its backpack: for sticks a pinecone, a duck feather, a river shell from the trading post, a loaf from the bakery; from other goods a charm, made at the workbench.
_Avoid_: item, loot, product

**Bakery**:
The small hut in the clearing with a stone oven, where the beaver feeds sticks into the fire to bake a loaf. The hut is the same for everyone; the fire and what bakes in it are each player's own. Nobody works there.
_Avoid_: bakehouse, kitchen, oven (that is only the fire inside it), trading post, shop

**Loaf**:
A loaf of bread baked in the bakery's oven, a good like those of the trading post, kept in the backpack. It is baked, not bought, and the trading post does not hold it.
_Avoid_: bread item, food, snack

**Workbench**:
The tree-stump bench in the open beside the trading post, where the beaver makes a new good from goods in its backpack, using them up. It takes no sticks. The bench is the same for everyone; what is made on it is each player's own.
_Avoid_: crafting table, crafting station, forge, trading post

**Recipe**:
The goods the workbench needs for one good it makes: a feather and a shell for a charm. The bench says it when the goods are missing.
_Avoid_: pattern, formula, blueprint

**Charm**:
A duck feather and a river shell tied on a string at the workbench, a good like the others, kept in the backpack and held in the paw. It is made, not bought or baked.
_Avoid_: amulet, necklace, trinket, item

**Hotbar**:
The row of six slots at the bottom of the screen. The first shows what the beaver carries (a stick) or nothing, the others the goods in the backpack with their counts. Selecting a good's slot (keys 1 to 6, the d-pad's left and right, a tap) brings it out of the backpack into the beaver's left paw; selecting the first slot or the same one again puts it back. A good in the paw still counts in the backpack.
_Avoid_: inventory, toolbar, quickbar

**Shop**:
The small disco-like hut in the clearing with the sign HOUSE OF AI in front; inside it is a café where the shopkeeper sells outfits, lets the beaver pick its class, and other creatures work at laptops.
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
An old, grey-muzzled beaver who sits hidden at the foot of the bank, among the trees at the clearing's edge, always in the same place. No player steers him and, unlike an animal, he never leaves his place or flees. When a player comes close he turns to them and tells a lore in his voice, its words shown in the HUD of every player near him. Everyone finds him in the same place, and he tells once for all: whoever is near hears the same lore at the same moment.
_Avoid_: elder, sage, wise beaver, NPC, Shopkeeper

**Lore**:
One short tale the Old Beaver tells about the clearing's past, a few lines long. He tells them in turn, and the turn is the world's, not each player's: a new one each time a player comes close after everyone has left his side, whoever heard the last.
_Avoid_: story, legend, dialogue, quest (a lore asks nothing of the player)

**Voice**:
The lines a creature of the world says aloud in real words, heard from where it is by every player near it, quieter the farther off and not at all out of earshot. The Old Beaver has one: English, low and slow. A voice is made once each time the creature says a line, for all who listen, and no recording of it is kept anywhere. Where none is made, the creature murmurs the line instead: a low hum without words, one beat a word.
_Avoid_: TTS, speech, narration, voice-over, voice chat (no player's voice is ever heard)

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

**Campfire**:
The small fire that always burns beside the spot where Mrs. Beaver waits, at the building site.
_Avoid_: bonfire, fireplace, fire pit

**Reading**:
The player sitting at the campfire with Mrs. Beaver once she is home, the two of them taking turns reading a short story aloud, one line each. Standing up stops it, and the next time they sit it goes on where it stopped. Like Mrs. Beaver herself, it is the player's alone.
_Avoid_: story time, storytelling, family (the two of them are the player and Mrs. Beaver)

**Outfit**:
A matching look for the beaver's shirt and hat, bought once at the shop with experience and then worn whenever the player likes. It changes only how the beaver looks, never what it can do. The Shark outfit wears a hood in the hat's place: grey, a fin on top, a row of teeth round the face.
_Avoid_: skin, costume, clothes

**Canoe**:
The small wooden boat that lies on the pond's bank. The beaver gets in, sits and paddles it across the pond, and gets out on the bank or into the water. Each player has their own.
_Avoid_: boat, raft, kayak

**Mushroom**:
A small red-capped mushroom growing at the foot of a tree in the clearing, which the beaver can eat. One eaten is gone until the next day's dawn. Each player has their own, and no one else sees them.
_Avoid_: shroom, fungus, food, item

**Race**:
Three laps in the canoe round the ring of buoys on the pond, against the clock. The clock starts when the canoe crosses the start line and stops when it crosses it after the third lap; each buoy must be passed in order. Getting out of the canoe abandons the race. The player's best time is kept for the visit. Each player races alone, and no one else sees their race.
_Avoid_: kart race, time trial, grand prix, track, circuit

**Buoy**:
One of the floats in a ring round the middle of the pond that mark the race's way, riding on the water as the pond rises. Two of them, off the canoe's bank, make the start line. Everyone sees the same buoys.
_Avoid_: checkpoint, marker, gate, waypoint

**Flag**:
The cloth with the AI beavers logo on a pole on the bank beside the building site. The player can set it alight; it burns down to a charred rag and a fresh one is raised at the next dawn. The fire never spreads beyond it. Each player has their own.
_Avoid_: banner, pennant, standard

**Dam**, **Lodge**, **Food cache**:
The three things built from sticks, in this order: the dam at the building site, the lodge in the pond, the cache on the pond's bed beside it.
_Avoid_: base, house, storage

**Dropping**:
A small brown pile the beaver leaves on the dam's mud with empty paws, squatting with its back to the dam and patting it flat with its tail. It builds nothing and earns nothing. A few at most lie there at once, and the next dawn washes them off. Each player has their own, and no one else sees them.
_Avoid_: poo, dung, scat, manure

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

**Bound**:
How the beaver runs on land: down on all fours, long and low, the hind feet pushing off together and the front paws landing between, the back humping and stretching with each stride. Walking it stays upright; it drops into a bound as it speeds up and rises again as it slows. Carrying a stick it runs upright. Running takes stamina.
_Avoid_: gallop, sprint, dash

**Stamina**:
How long the beaver can keep running on land. It drains while the beaver runs, and when it is gone the beaver can only walk until a third of it has come back. It comes back whenever the beaver is not running, three times as fast while it gnaws a tree, eating its wood. Swimming, crawling and paddling never use it. Each player has their own, for the visit only.
_Avoid_: energy, endurance, sprint meter, breath

**Dizzy**:
What a player's view becomes for a while after the beaver eats too many mushrooms too quickly: colours slowly drift and the picture gently sways and waves, with no flashing. Only that player's own screen changes; steering does not, and the HUD stays steady.
_Avoid_: trip, high, drunk, poisoned

**Flash**:
The player switching the lantern off and on with one button while it is dark, so that other players see it blink. A flash means what the players agree it means; the game gives it no meaning.
_Avoid_: blink, signal, toggle

**Chat**:
The lines players in the same world write to each other. A line shows over its beaver's head for a few seconds and in the log. It is not the stream's chat, where viewers write wishes.
_Avoid_: messages, talk, stream chat, Twitch chat

**Stare**:
The beaver turning round on land to look straight into its own player's camera, unblinking, once the player has touched nothing for a minute, and then creeping slowly up to it until its face nearly touches the lens, the camera holding still for it. Any input ends it. Only that player sees the beaver look into their camera; others see it only walk a little way.
_Avoid_: AFK, idle animation, look-at

**Tail slap**:
The beaver bringing its tail down flat: a crack on the water, a thump on land. It is the alarm that sends the animals off, and on land, close to the bear, it is the beaver's only blow: each one that lands takes some of the bear's health. At the bear it is a leap: the beaver jumps, turns once round in the air and brings its tail down on the bear.
_Avoid_: attack, hit, strike, tail whip

**Remote**:
Another player's beaver as this browser draws it.
_Avoid_: peer, other client

**Bot**:
A player no person drives, that joins over the network under the same rules as a person: the Bot program does beaver work; the tour's visitor, opened from the tour's page, only stands and says hello.
_Avoid_: NPC, AI player

**Animal**:
A creature of the world that no player steers: ducks, fish, deer, the bear.
_Avoid_: NPC, mob, wildlife entity

**River kit**:
The beaver's child: a small furry beaver on four legs that keeps to the player's beaver, waddles after it over the meadow, bounds to catch up and steps out of its way. Left standing it noses in the ground, looks about, sits up on its haunches, stands up on its two hind feet with its arms close to its body, grooms its muzzle, pats what is before it with a fore paw, or sits, one thing after another; with a trunk or a rock right before it, it stands up and leans its fore paws on it. Standing or sitting it looks up at the beaver. Left behind it calls after the beaver as it starts to run, and chirps when it has caught up, opening its mouth as it does; its orange incisors show under its upper lip. Beside a beaver that stays where it is it lies down and sleeps until the beaver goes; by night it dozes off at every stop. It sleeps over on its side as a seal pup dozes, eyes shut: now and then it rubs its face with a fore paw, stretches its hind feet out and spreads them, wriggles and squeaks softly in its sleep. Then it wakes with a yawn and a stretch. It swims after the beaver through the water, where it only paddles, comes out with a wet coat and, a moment after it has dry ground under it, shakes itself dry. Each player has their own, and no one else sees or hears it.
_Avoid_: pet, companion, follower, baby beaver, cub, pup

**Bear**:
The one animal that goes for the beaver instead of fleeing from it. By day it comes running out of the far forest into the wide meadow between where the first bank stood and the bank, where it ambles about, noses and digs in the ground, looks about and sits; when it notices the player's beaver on land there, it rears up, charges and swipes at it. It never goes into the water and never comes nearer the pond than where the first bank stood. Each player has their own, and no one else sees it.
_Avoid_: bot (a bot is a player), enemy, monster, boss, mob, predator, threat

**Swipe**:
The bear's blow with a front paw, after it has reared up. It never harms the beaver, which has no health and cannot die: it tosses the beaver a few metres, knocks the stick from its paw and leaves it furious for a while.
_Avoid_: attack, hit, bite, damage

**Health**:
How much fight the bear has left: 100 when it comes out of the forest, less with every tail slap that lands. Only the bear has it.
_Avoid_: HP, hit points, life, lives

**Health bar**:
The bar at the top of the HUD with the bear's name and its health, shown from when the bear goes for the player's beaver until it is driven off or gives up.
_Avoid_: life bar, HP bar, boss bar

**Stamina bar**:
The small bar just above the hotbar with the beaver's stamina, shown only while it is not full.
_Avoid_: energy bar, sprint bar, Health bar (that is the bear's)

**Driven off**:
What the bear is once it has no health left: it turns and runs all the way back into the far forest, in plain sight, and stays there until the next day. It is not killed; nothing in the clearing dies.
_Avoid_: dead, killed, defeated, despawned

**Third-person view**, **First-person view**:
The two ways a player can see the clearing. In the third-person view (the usual one) the camera follows behind the beaver, which is in the picture. In the first-person view the player sees through the beaver's eyes, and the beaver itself is not in the picture. Each player switches between them for their own screen only.
_Avoid_: camera mode, POV, cockpit view

**Clear view**:
In the third-person view, the leaves of a tree, bush or reed that hide the beaver, or that the camera stands in, turn see-through for as long as they are in the way and come back after, so the camera keeps its distance instead of pulling in. Only leaves do this; trunks, rocks, crates and the ground still bring the camera in. Each player's clear view is on their own screen only: everyone else sees the leaves whole.
_Avoid_: x-ray, occlusion fade, hiding foliage

**Experience**:
The points a player earns by building with sticks, one for each stick built in, and spends at the shop.
_Avoid_: XP, coins, money, score (the player card writes "XP" only as the unit after its numbers: "12 / 30 XP")

**Level**:
How far a player has come, from all the Experience they ever earned; spending Experience at the shop does not lower it. Level 2 takes 20 Experience, each level after 10 more than the one before. The player card shows it.
_Avoid_: rank, tier

**Class**:
What a beaver is best at, picked by its player for free at the shop and changed there whenever they like: a Gnawer bites faster, a Swimmer swims faster. A beaver has one class or none, and with none it is as good at everything as any other beaver. The class is the player's own, kept in their saved game; it gives no new abilities and changes nothing in the world's work.
_Avoid_: role, job, profession, trade (that is the trading post's), specialization, perk

**Player card**:
The card at the top left of the HUD: the player's name, their level and class, and how much Experience they still need for the next one.
_Avoid_: profile, badge, Experience pill

**Quest tracker**:
The card under the player card: the build goal at hand, its count and how to do it, and under it the quest (Mrs. Beaver's) with its step at hand.
_Avoid_: goals panel, mission log

**Saved game**:
What a player's browser keeps between visits: their experience, outfits, class and goods. The trees, the dam, the lodge and the cache are not part of it: they are the world's work, which only the server keeps.
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
Everything drawn over the world for the player: the player card, the quest tracker, the map, hints, the hotbar, the stamina bar, menus, touch controls.
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

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

**Building site**:
The flat ground at the pond where the dam is built.
_Avoid_: construction zone, build area

**Stick**:
A piece of wood the beaver can carry and build with. Every tree gnawed into wood yields sticks.
_Avoid_: log, branch, wood item

**Lantern**:
The light the beaver carries in its left hand, hanging by its handle, while it is dark; by day it rides in the backpack. It glows from dusk until dawn. The right hand stays free for sticks.
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

**Shop**:
The small disco-like hut in the clearing with the sign HOUSE OF AI in front; inside it is a café where the shopkeeper sells outfits and other creatures work at laptops.
_Avoid_: store, House of AI (that is only its sign), disco, trading post (that is the stall where sticks buy goods)

**Shopkeeper**:
The female beaver behind the shop's counter who sells outfits. No player steers her and, unlike an animal, she never leaves her place or flees.
_Avoid_: NPC, vendor, merchant

**Outfit**:
A matching look for the beaver's shirt and hat, bought once at the shop with experience and then worn whenever the player likes.
_Avoid_: skin, costume, clothes

**Canoe**:
The small wooden boat that lies on the pond's bank. The beaver gets in, sits and paddles it across the pond, and gets out on the bank or into the water. Each player has their own.
_Avoid_: boat, raft, kayak

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
_Avoid_: XP, coins, money, score

**Saved game**:
The state of the trees, the dam, the lodge and the cache, and the player's experience and outfits, kept between visits.
_Avoid_: save file, progress

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
Everything drawn over the world for the player: goals, map, hints, menus, touch controls.
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

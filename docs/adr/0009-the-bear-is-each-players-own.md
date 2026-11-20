# The bear is each player's own; the server does not know it

A bear goes for the player's beaver, the beaver slaps its tail at it, and the bear's health goes down until it is driven off (`GLOSSARY.md`: Bear, Health). In a shared world someone has to keep the bear: where it is and how much health it has. Each player's browser keeps its own, in memory, for one visit. Every player has a bear that no one else sees, as each has their own Mrs. Beaver, canoe and flag, and as every browser already steps its own animals. Nothing of it is kept or sent.

We did not give the bear to the server. The room checks changes and passes messages on; it steps nothing and knows no ground, and a bear has to be stepped beside the beaver it fights. We did not give it to the host, as the loose things are: the host changes when a player leaves or looks away, bots are never host, and a tail slap would wait on another player's browser before it counts. And the tour could not check a shared bear: two tours on one server share the tour's world (ADR 0007), so one page's fight would depend on another's, which is a flake (ADR 0002).

This does not go against ADR 0007. The bear is not the world's work: it changes no tree, no wood and nothing built, and no page keeps a copy of it between visits.

## Consequences

- Other players see a beaver slap its tail, fly back and turn furious, and no bear. Players cannot drive off a bear together.
- Only a player's own tail slap takes health from their bear. Another player's or a bot's slap, which the `tailSlap` event marks `remote`, does not.
- A page loaded again has a fresh bear with all its health.
- Bots never meet a bear.
- A bear that everyone sees needs someone to step it for all (the server, once it knows the ground, or the host) and a message for a slap that lands. That is separate work and replaces this decision.

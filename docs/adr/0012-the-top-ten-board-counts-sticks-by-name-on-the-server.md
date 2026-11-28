# The Top-ten board counts sticks by name, on the server

A viewer asked for a ranking of the top ten beavers in the world. The obvious measure, Experience or Level, lives only in each player's browser (ADR 0007), and a page could say any number. The server, though, checks every stick built into the dam, lodge and cache, and knows who sent it. So the server counts those sticks itself, for each name a builder had when the stick went in, ignoring upper and lower case, and leaves bots out. The tally is kept with the world's work (file or Durable Object storage), outlives compaction, and is cleared when the world is reset. The tour's world keeps its own.

We did not have pages report their Experience: it could not be checked, and it counts across worlds. We did not wait for accounts: there are none, and a name is the only handle the game has. A name is not an identity: anyone may play under a name already on the board and add to its count, and a player who changes name starts a new row.

## Consequences

- Sticks built before the tally existed are not counted.
- The kept world's format gains the tally; a file without one starts with an empty tally.

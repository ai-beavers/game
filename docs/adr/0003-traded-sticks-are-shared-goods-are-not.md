# Traded sticks leave the shared world; goods belong to one player

At the trading post a beaver pays sticks for goods. Sticks are part of the shared world, and the server checks every change to them. So a stick paid in leaves the world for everyone through a named build change ("trade"), the same way a stick goes into the dam. Otherwise another player would still see it lying there and could pick it up. The goods, and the piles paid towards them, belong to the player and are kept in their browser, like a hat. A shared shop with a shared backpack would let one player spend another's sticks or take their goods.

## Consequences

- The saved game records which sticks were traded, so they stay out of the world after a reload. When a tree grows back, its traded sticks come back with it (that is the wood farm). The world's own sticks, which grow on no tree, are gone once traded.
- The server's protocol must accept and check the new change, just as it does for "place".
- Goods are not synced: other players don't see what is in someone's backpack.

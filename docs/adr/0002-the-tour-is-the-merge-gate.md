# The tour is the merge gate

Agents build almost every change, so a change has to prove itself to a machine in the way a player would meet it. Every player-facing behavior therefore has a playable station, and a branch is merged only when `bun run check` passes and the whole tour plays through on it. The same stations are what the stream shows of the game, so a feature without a station is neither tested nor seen.

## Consequences

- The tour needs a GPU: it runs on the maintainers' machine before a merge, not in GitHub Actions. CI runs only the checks that need none.
- A flake blocks good changes. A station that fails without a cause in the change is fixed before more is built on it.
- A builder may add stations and may change one only when its task changes that behavior.

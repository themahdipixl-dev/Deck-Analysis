# Deck Analysis

Automated Clash Royale deck statistics for the top Ranked / Path of Legend players.

## Pipeline

1. Fetch the current global top 1000 Ranked / Path of Legend players.
2. Fetch each player's recent battle log.
3. Analyze up to the latest 30 battles per player.
4. Extract exactly 8-card main decks. Tower Cards are excluded from deck identity.
5. Aggregate raw Games, Wins, Losses, Draws, Win Rate, and Total Crowns.
6. Rank eligible decks by Adjusted Win Rate, then Games, then raw Win Rate.
7. Publish the top 30 to data/pol-decks.json.
8. GitHub Actions refreshes the dataset every 3 hours.

## Ranking methodology

- Minimum eligible sample: 20 raw games and 20 effective games.
- A single player contributes at most 10 effective games to the ranking of one deck.
- Raw/display statistics still use all eligible battles.
- Adjusted Win Rate uses a Bayesian prior of 50% with prior strength 20.
- Crown totals, Crown Rate, Average Elixir, and Average Level do not affect ranking.

The collector uses the existing My Royale Cloudflare Worker as the API gateway, so no Clash Royale API token is stored in this repository.

## Manual test

You can run a smaller collection locally or through workflow_dispatch:

~~~bash
PLAYERS=50 npm run update
~~~

The generated dataset is written to data/pol-decks.json.

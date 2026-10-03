# Deck Analysis

Automated Clash Royale deck statistics built from the top Ranked / Path of Legend players for every available country/location.

## Pipeline

1. Fetch all available Clash Royale locations/countries.
2. Fetch up to the top 1000 Ranked / Path of Legend players for every location.
3. Deduplicate players by player tag across locations.
4. Fetch up to the latest 30 battles for each unique player.
5. Analyze only `pathOfLegend` battles and extract exactly 8 main cards plus the Tower Card.
6. Aggregate raw Games, Wins, Losses, Draws, and Total Crowns.
7. Rank eligible decks by Adjusted Win Rate, then Games, then raw Win Rate.
8. Publish the top 30 decks to `data/pol-decks.json`.
9. GitHub Actions refreshes the dataset once every 24 hours.

## Large-scale collection

The collector is designed for roughly 200,000+ candidate players:

- Location rankings are fetched concurrently.
- Player tags are deduplicated before battle-log requests.
- Battle logs are fetched with bounded concurrency.
- Battle results are analyzed incrementally instead of keeping millions of battle objects in memory.
- HTTP 429/5xx/timeout responses use retry with exponential backoff.
- The workflow allows up to 6 hours for the collection job.

GitHub-hosted runners have a 6-hour maximum job execution time, and a matrix can have up to 256 jobs if the workflow later needs to be split further. See the GitHub Actions documentation for the current limits.

## Ranking methodology

- Minimum eligible sample: 20 raw games and 20 effective games.
- A single player contributes at most 10 effective games to the ranking of one deck.
- Raw/display statistics still use all eligible battles.
- Adjusted Win Rate uses a Bayesian prior of 50% with prior strength 20.
- Tower Card is part of deck identity.
- Crown totals, Crown Rate, Average Elixir, and Average Level do not affect ranking.

The collector uses the existing My Royale Cloudflare Worker as the API gateway, so no Clash Royale API token is stored in this repository.

## Manual test

You can run a smaller collection locally or through workflow_dispatch:

~~~bash
PLAYERS_PER_LOCATION=50 npm run update
~~~

The generated dataset is written to `data/pol-decks.json`.

import fs from "node:fs/promises";
import { createApi } from "../collector/api.js";
import { createDeckAnalyzer } from "../collector/deckAnalyzer.js";

const argPlayers = process.argv.find((arg) => arg.startsWith("--players="));
const requestedPlayers = Number(
  process.env.PLAYERS_PER_LOCATION ||
    process.env.PLAYERS ||
    (argPlayers ? argPlayers.split("=")[1] : 1000)
);
const playersPerLocation = Math.min(1000, Math.max(1, requestedPlayers));
const concurrency = Math.max(1, Number(process.env.BATTLELOG_CONCURRENCY || 12));

const api = createApi();

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runWorker)
  );
  return results;
}

console.log("Fetching all Clash Royale locations...");
const rawLocations = await api.fetchLocations();

const locations = rawLocations
  .map((location) => ({
    id: location && location.id,
    name: (location && location.name) || "Unknown",
  }))
  .filter((location) => location.id && String(location.id).toLowerCase() !== "global");

console.log(
  "Found " +
    locations.length +
    " country/location entries. Fetching up to " +
    playersPerLocation +
    " POL players per location..."
);

const locationResults = await mapWithConcurrency(
  locations,
  Math.min(8, concurrency),
  async (location) => {
    try {
      const players = await api.fetchTopPolPlayers(location.id, playersPerLocation);
      return { location, players };
    } catch (error) {
      console.warn(
        "Location failed " +
          location.id +
          " (" +
          location.name +
          "): " +
          ((error && error.message) || error)
      );
      return { location, players: [], failed: true };
    }
  }
);

const uniquePlayers = [];
const seen = new Set();
let locationsFailed = 0;

for (const result of locationResults) {
  if (result.failed) locationsFailed += 1;

  for (const player of result.players) {
    const tag = player && player.tag;
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);

    uniquePlayers.push({
      tag,
      name: (player && player.name) || "Unknown",
      rank: player && player.rank != null ? player.rank : null,
      locations: [result.location.id],
    });
  }
}

console.log(
  "Collected " +
    uniquePlayers.length +
    " unique players from " +
    locations.length +
    " locations. Starting battle-log collection with concurrency " +
    concurrency +
    "..."
);

const analyzer = createDeckAnalyzer();
let completed = 0;
let failed = 0;
let battlesFetched = 0;

await mapWithConcurrency(uniquePlayers, concurrency, async (player) => {
  try {
    const battles = await api.fetchBattlelog(player.tag);
    const selectedBattles = battles.slice(0, 30);
    battlesFetched += selectedBattles.length;
    analyzer.addPlayerBattles(player.tag, selectedBattles);
  } catch (error) {
    failed += 1;
    console.warn(
      "Battlelog failed for " +
        player.tag +
        ": " +
        ((error && error.message) || error)
    );
  }

  completed += 1;
  if (completed % 1000 === 0 || completed === uniquePlayers.length) {
    console.log(
      "Battlelogs: " +
        completed +
        "/" +
        uniquePlayers.length +
        " (failed: " +
        failed +
        ")"
    );
  }
});

const topDecks = analyzer.getTopDecks();

const output = {
  generatedAt: new Date().toISOString(),
  source: {
    ranking: "top_path_of_legend_per_location",
    locationCount: locations.length,
    locationsFailed,
    playersPerLocationRequested: playersPerLocation,
    playersRequested: locations.length * playersPerLocation,
    playersCollected: uniquePlayers.length,
    battlelogsFailed: failed,
    battlesFetched,
    battlesPerPlayer: 30,
    battlelogConcurrency: concurrency,
  },
  methodology: {
    deckIdentity: "8 main cards + tower card; main-card order ignored after Hero/Evolution state is resolved; cardType and evolutionLevel are part of card state",
    cardTypeDetection: "uses evolutionLevel from the active currentDeck or played battle-log card entry: 1 = evolution, 2 = hero, missing/0/other = normal; iconUrls are used only to select the corresponding image asset",
    battleFilter: "pathOfLegend only",
    towerCardSource: "participant.supportCards[0]",
    ranking: ["adjustedWinRate", "games", "winRate"],
    minimumGames: Number(process.env.MIN_DECK_GAMES || 20),
    perPlayerDeckCap: Number(process.env.PLAYER_DECK_CAP || 10),
    priorStrength: Number(process.env.PRIOR_STRENGTH || 20),
    priorWinRate: Number(process.env.PRIOR_WIN_RATE || 0.5),
    rawStatsUseAllEligibleBattles: true,
    playerCollection: "top players are collected independently for every location, then deduplicated by player tag before battle-log analysis",
    processing: "battle logs are analyzed incrementally so the full multi-million-battle dataset is never held in memory at once",
    diagnostics: analyzer.getDiagnostics(),
  },
  decks: topDecks,
};

await fs.mkdir("data", { recursive: true });
await fs.writeFile(
  "data/pol-decks.json",
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);
console.log("Wrote " + topDecks.length + " ranked decks to data/pol-decks.json");

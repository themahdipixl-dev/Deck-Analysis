import fs from "node:fs/promises";
import { createApi } from "../collector/api.js";
import { analyzeBattles } from "../collector/deckAnalyzer.js";

const argPlayers = process.argv.find((arg) => arg.startsWith("--players="));
const requestedPlayers = Number(
  process.env.PLAYERS || (argPlayers ? argPlayers.split("=")[1] : 1000)
);
const playerLimit = Math.min(1000, Math.max(1, requestedPlayers));

const api = createApi();

console.log("Fetching top " + playerLimit + " Ranked / Path of Legend players...");
const players = await api.fetchTopPolPlayers(playerLimit);

const uniquePlayers = [];
const seen = new Set();

for (const player of players) {
  const tag = player && player.tag;
  if (!tag || seen.has(tag)) continue;
  seen.add(tag);
  uniquePlayers.push({
    tag,
    name: (player && player.name) || "Unknown",
    rank: player && player.rank != null ? player.rank : null,
  });
}

console.log("Collected " + uniquePlayers.length + " unique players.");

const playerLogs = [];
let completed = 0;
let failed = 0;

for (const player of uniquePlayers) {
  try {
    const battles = await api.fetchBattlelog(player.tag);
    playerLogs.push({ playerTag: player.tag, battles: battles.slice(0, 30) });
  } catch (error) {
    failed += 1;
    console.warn(
      "Battlelog failed for " + player.tag + ": " + ((error && error.message) || error)
    );
  }

  completed += 1;
  if (completed % 25 === 0 || completed === uniquePlayers.length) {
    console.log(
      "Battlelogs: " + completed + "/" + uniquePlayers.length + " (failed: " + failed + ")"
    );
  }
}

const topDecks = analyzeBattles(playerLogs);

const output = {
  generatedAt: new Date().toISOString(),
  source: {
    ranking: "global_path_of_legend",
    battleType: "pathOfLegend",
    playersRequested: playerLimit,
    playersCollected: uniquePlayers.length,
    battlelogsFailed: failed,
    battlesPerPlayer: 30,
  },
  methodology: {
    deckIdentity: "8 main cards + tower card; main-card order ignored after positional Hero/Evolution classification; cardType and evolutionLevel are part of card state",
    cardTypeDetection: "matches My Royale Current Deck logic; raw API order is preserved; slot 1 = evolution; slot 2 = hero when heroMedium exists, otherwise normal; slot 3 = evolution when slot 2 is a Hero, otherwise hero; slots 4-8 = normal; evolutionLevel is not used alone to determine cardType",
    battleFilter: "pathOfLegend only",
    towerCardSource: "participant.supportCards[0]",
    ranking: ["adjustedWinRate", "games", "winRate"],
    minimumGames: Number(process.env.MIN_DECK_GAMES || 20),
    perPlayerDeckCap: Number(process.env.PLAYER_DECK_CAP || 10),
    priorStrength: Number(process.env.PRIOR_STRENGTH || 20),
    priorWinRate: Number(process.env.PRIOR_WIN_RATE || 0.5),
    rawStatsUseAllEligibleBattles: true,
  },
  decks: topDecks,
};

await fs.mkdir("data", { recursive: true });
await fs.writeFile("data/pol-decks.json", JSON.stringify(output, null, 2) + "\n", "utf8");
console.log("Wrote " + topDecks.length + " ranked decks to data/pol-decks.json");

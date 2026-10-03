const DEFAULT_PRIOR_STRENGTH = 20;
const DEFAULT_PRIOR_WIN_RATE = 0.5;
const DEFAULT_MIN_GAMES = 20;
const DEFAULT_PLAYER_CAP = 10;

function cardKey(card) {
  const id = card && (card.id != null ? card.id : card.name);
  if (id == null) return null;
  const mode = card && Number.isFinite(card.evolutionLevel) ? card.evolutionLevel : 0;
  return String(id) + ":" + mode;
}

function normalizeCard(card) {
  return {
    id: card && card.id != null ? card.id : null,
    name: String((card && card.name) || "Unknown"),
    evolutionLevel: card && Number.isFinite(card.evolutionLevel) ? card.evolutionLevel : 0,
    iconUrl: (card && card.iconUrls && card.iconUrls.medium) || null,
  };
}

function extractEightCardDeck(participant) {
  const cards = Array.isArray(participant && participant.cards) ? participant.cards : [];
  if (cards.length !== 8) return null;
  const normalized = cards.map(normalizeCard);
  const keys = normalized.map(cardKey);
  if (keys.some((key) => key == null) || new Set(keys).size !== 8) return null;
  return { cards: normalized, key: keys.join("|") };
}

function findPlayerParticipant(battle, playerTag) {
  const wanted = String(playerTag).toUpperCase();
  const team = Array.isArray(battle && battle.team) ? battle.team : [];
  const opponent = Array.isArray(battle && battle.opponent) ? battle.opponent : [];
  const inTeam = team.find((entry) => String((entry && entry.tag) || "").toUpperCase() === wanted);
  if (inTeam) return { participant: inTeam, side: "team", team, opponent };
  const inOpponent = opponent.find((entry) => String((entry && entry.tag) || "").toUpperCase() === wanted);
  if (inOpponent) return { participant: inOpponent, side: "opponent", team, opponent };
  return null;
}

function sideScore(entries) {
  return (Array.isArray(entries) ? entries : []).reduce(
    (sum, entry) => sum + Number((entry && entry.crowns) || 0), 0
  );
}

function resolveOutcome(context) {
  const participant = context.participant;

  if (typeof participant.boatBattleWon === "boolean") {
    return participant.boatBattleWon ? "win" : "loss";
  }
  if (typeof participant.trophyChange === "number" && participant.trophyChange !== 0) {
    return participant.trophyChange > 0 ? "win" : "loss";
  }

  const own = sideScore(context.side === "team" ? context.team : context.opponent);
  const enemy = sideScore(context.side === "team" ? context.opponent : context.team);
  if (own > enemy) return "win";
  if (own < enemy) return "loss";
  return "draw";
}

export function analyzeBattles(playerLogs, options = {}) {
  const minGames = Math.max(1, Number(options.minGames || process.env.MIN_DECK_GAMES || DEFAULT_MIN_GAMES));
  const playerCap = Math.max(1, Number(options.playerCap || process.env.PLAYER_DECK_CAP || DEFAULT_PLAYER_CAP));
  const priorStrength = Number(options.priorStrength || process.env.PRIOR_STRENGTH || DEFAULT_PRIOR_STRENGTH);
  const priorWinRate = Number(options.priorWinRate || process.env.PRIOR_WIN_RATE || DEFAULT_PRIOR_WIN_RATE);
  const decks = new Map();

  for (const item of playerLogs) {
    const playerTag = item.playerTag;
    for (const battle of item.battles || []) {
      const context = findPlayerParticipant(battle, playerTag);
      if (!context) continue;

      const deck = extractEightCardDeck(context.participant);
      if (!deck) continue;

      const outcome = resolveOutcome(context);
      const crowns = Number((context.participant && context.participant.crowns) || 0);
      let stats = decks.get(deck.key);

      if (!stats) {
        stats = {
          key: deck.key,
          cards: deck.cards,
          games: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          totalCrowns: 0,
          players: new Map(),
        };
        decks.set(deck.key, stats);
      }

      stats.games += 1;
      stats.totalCrowns += crowns;
      if (outcome === "win") stats.wins += 1;
      else if (outcome === "loss") stats.losses += 1;
      else stats.draws += 1;

      if (!stats.players.has(playerTag)) {
        stats.players.set(playerTag, { games: 0, wins: 0, losses: 0, crowns: 0 });
      }

      const playerStats = stats.players.get(playerTag);
      if (playerStats.games < playerCap) {
        playerStats.games += 1;
        playerStats.crowns += crowns;
        if (outcome === "win") playerStats.wins += 1;
        else if (outcome === "loss") playerStats.losses += 1;
      }
    }
  }

  const ranked = [];

  for (const stats of decks.values()) {
    let effectiveGames = 0;
    let effectiveWins = 0;
    let effectiveLosses = 0;

    for (const playerStats of stats.players.values()) {
      effectiveGames += playerStats.games;
      effectiveWins += playerStats.wins;
      effectiveLosses += playerStats.losses;
    }

    if (stats.games < minGames || effectiveGames < minGames) continue;

    const decisiveGames = stats.wins + stats.losses;
    const effectiveDecisiveGames = effectiveWins + effectiveLosses;
    const winRate = decisiveGames > 0 ? stats.wins / decisiveGames : 0;
    const adjustedWinRate = (
      effectiveWins + priorStrength * priorWinRate
    ) / (
      effectiveDecisiveGames + priorStrength
    );

    ranked.push({
      key: stats.key,
      cards: stats.cards,
      games: stats.games,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      winRate: Number((winRate * 100).toFixed(2)),
      adjustedWinRate: Number((adjustedWinRate * 100).toFixed(2)),
      totalCrowns: stats.totalCrowns,
    });
  }

  ranked.sort((a, b) =>
    b.adjustedWinRate - a.adjustedWinRate ||
    b.games - a.games ||
    b.winRate - a.winRate ||
    b.wins - a.wins
  );

  return ranked.slice(0, 30);
}

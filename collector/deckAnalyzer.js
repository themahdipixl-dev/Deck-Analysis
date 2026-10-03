const DEFAULT_PRIOR_STRENGTH = 20;
const DEFAULT_PRIOR_WIN_RATE = 0.5;
const DEFAULT_MIN_GAMES = 20;
const DEFAULT_PLAYER_CAP = 10;

function cardKey(card) {
  const id = card && (card.id != null ? card.id : card.name);
  if (id == null) return null;

  const evolutionLevel = card && Number.isFinite(card.evolutionLevel)
    ? card.evolutionLevel
    : 0;
  const cardType = card && card.cardType ? card.cardType : "normal";

  return String(id) + ":" + cardType + ":" + evolutionLevel;
}

function normalizeCard(card, cardType = "normal") {
  const iconUrls = (card && card.iconUrls) || {};
  const iconUrl =
    cardType === "evolution"
      ? (iconUrls.evolutionMedium || iconUrls.medium || null)
      : cardType === "hero"
        ? (iconUrls.heroMedium || iconUrls.medium || null)
        : (iconUrls.medium || null);

  return {
    id: card && card.id != null ? card.id : null,
    name: String((card && card.name) || "Unknown"),
    evolutionLevel: card && Number.isFinite(card.evolutionLevel) ? card.evolutionLevel : 0,
    cardType,
    iconUrl,
  };
}

function classifyMainDeckCards(cards) {
  // Match the Current Deck logic in My Royale:
  // Slot 1: Evolution only.
  // Slot 2: Hero only.
  // Slot 3: Hero when Slot 2 is not a Hero; otherwise Evolution.
  // Slots 4-8: Normal only.
  //
  // Hero/Evolution state is determined from the raw API card fields/assets,
  // exactly like Current Deck. Do not infer type from evolutionLevel alone.
  if (!Array.isArray(cards) || cards.length !== 8) return null;

  const classified = cards.map((card, index) => {
    let cardType = "normal";

    if (index === 0) {
      // Slot 1: Evolution only.
      cardType = "evolution";
    } else if (index === 1) {
      // Slot 2: use the Hero asset when the API says this card has one.
      cardType = card?.iconUrls?.heroMedium ? "hero" : "normal";
    } else if (index === 2) {
      // Slot 3 depends on whether Slot 2 is actually a Hero.
      const secondCardIsHero = Boolean(cards[1]?.iconUrls?.heroMedium);
      cardType = secondCardIsHero ? "evolution" : "hero";
    }

    return normalizeCard(card, cardType);
  });

  return classified;
}

function extractTowerCard(participant) {
  const supportCards = Array.isArray(participant && participant.supportCards)
    ? participant.supportCards
    : [];
  if (!supportCards.length) return null;

  const tower = normalizeCard(supportCards[0]);
  const key = cardKey(tower);
  if (key == null) return null;

  return { card: tower, key };
}

function extractEightCardDeck(participant) {
  const cards = Array.isArray(participant && participant.cards) ? participant.cards : [];
  if (cards.length !== 8) return null;

  // Preserve the raw API order while determining Hero/Evolution state.
  const classified = classifyMainDeckCards(cards);
  if (!classified) return null;

  const keys = classified.map(cardKey);
  if (keys.some((key) => key == null) || new Set(keys).size !== 8) return null;

  // Order does not define deck identity after the positional classification
  // has been resolved, so normalize identity by sorting the classified keys.
  const identityKeys = [...keys].sort();

  return {
    // Keep the original API order in the output so the resolved card states
    // remain tied to their actual deck slots.
    cards: classified,
    key: identityKeys.join("|"),
  };
}

function extractDeck(participant) {
  const mainDeck = extractEightCardDeck(participant);
  if (!mainDeck) return null;

  const tower = extractTowerCard(participant);
  if (!tower) return null;

  return {
    cards: mainDeck.cards,
    towerCard: tower.card,
    key: mainDeck.key + "|tower:" + tower.key,
  };
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
      if (battle && battle.type !== "pathOfLegend") continue;

      const context = findPlayerParticipant(battle, playerTag);
      if (!context) continue;

      const deck = extractDeck(context.participant);
      if (!deck) continue;

      const outcome = resolveOutcome(context);
      const crowns = Number((context.participant && context.participant.crowns) || 0);
      let stats = decks.get(deck.key);

      if (!stats) {
        stats = {
          key: deck.key,
          cards: deck.cards,
          towerCard: deck.towerCard,
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
      towerCard: stats.towerCard,
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

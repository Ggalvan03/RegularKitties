export const FOODS = ["chicken", "milk", "fish", "croquettes"] as const;
export type Food = (typeof FOODS)[number];
export type Modifier = "*" | "+" | "2" | "3";
export type PreferenceToken = Food | Modifier | "|";

export type Requirement = { food: Food; min: number; max: number | null };
export type Preference = Requirement[][];

export type FoodCard = { id: string; food: Food };

export function buildFoodDeck(): FoodCard[] {
  return FOODS.flatMap((food) =>
    Array.from({ length: 20 }, (_, index) => ({ id: `${food}-${index + 1}`, food })),
  );
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const shuffled = [...items];
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapWith]] = [shuffled[swapWith], shuffled[index]];
  }
  return shuffled;
}

export function parsePreference(tokens: readonly PreferenceToken[]): Preference {
  if (tokens.length === 0) throw new Error("A preference needs at least one food.");
  const alternatives: Preference = [[]];
  for (const token of tokens) {
    if (token === "|") {
      if (alternatives.at(-1)?.length === 0) throw new Error("An alternative cannot be empty.");
      alternatives.push([]);
      continue;
    }
    if (FOODS.includes(token as Food)) {
      alternatives.at(-1)!.push({ food: token as Food, min: 1, max: 1 });
      continue;
    }
    const current = alternatives.at(-1)!;
    const requirement = current.at(-1);
    if (!requirement || requirement.max !== 1 || requirement.min !== 1) {
      throw new Error("A modifier must follow an unmodified food.");
    }
    if (token === "*") Object.assign(requirement, { min: 0, max: null });
    if (token === "+") Object.assign(requirement, { min: 1, max: null });
    if (token === "2" || token === "3") Object.assign(requirement, { min: Number(token), max: Number(token) });
  }
  if (alternatives.at(-1)?.length === 0) throw new Error("An alternative cannot be empty.");
  return alternatives;
}

export function plateMatches(plate: readonly Food[], preference: Preference): boolean {
  const counts = Object.fromEntries(FOODS.map((food) => [food, 0])) as Record<Food, number>;
  for (const food of plate) counts[food] += 1;
  return preference.some((alternative) => {
    const mentioned = new Set(alternative.map(({ food }) => food));
    if (FOODS.some((food) => !mentioned.has(food) && counts[food] > 0)) return false;
    return alternative.every(({ food, min, max }) => counts[food] >= min && (max === null || counts[food] <= max));
  });
}

export function resolveUniqueLeader<T extends { id: string; plate: readonly Food[] }>(players: readonly T[], preference: Preference): T | null {
  const eligible = players.filter(({ plate }) => plateMatches(plate, preference));
  const largest = Math.max(0, ...eligible.map(({ plate }) => plate.length));
  const leaders = eligible.filter(({ plate }) => plate.length === largest);
  return leaders.length === 1 ? leaders[0] : null;
}

export function competitionRanks(players: readonly { id: string; score: number }[]): Record<string, number> {
  const sortedScores = [...new Set(players.map(({ score }) => score))].sort((a, b) => b - a);
  return Object.fromEntries(players.map(({ id, score }) => [id, players.filter((player) => player.score > score).length + 1 || sortedScores.indexOf(score) + 1]));
}

export function canPaySteal(hand: readonly Food[], food: Food): boolean {
  return hand.filter((card) => card === food).length >= 2;
}

import { describe, expect, it } from "vitest";
import { buildFoodDeck, canPaySteal, competitionRanks, parsePreference, plateMatches, resolveUniqueLeader, seededShuffle } from "./rules";

describe("food deck", () => {
  it("contains 80 cards and 20 of each food", () => {
    const deck = buildFoodDeck();
    expect(deck).toHaveLength(80);
    for (const food of ["chicken", "milk", "fish", "croquettes"]) expect(deck.filter((card) => card.food === food)).toHaveLength(20);
  });
  it("shuffles deterministically", () => expect(seededShuffle([1, 2, 3, 4], 42)).toEqual(seededShuffle([1, 2, 3, 4], 42)));
});

describe("preferences", () => {
  it("parses alternatives and postfix modifiers", () => {
    expect(parsePreference(["fish", "|", "milk", "*", "chicken", "+"])).toEqual([
      [{ food: "fish", min: 1, max: 1 }],
      [{ food: "milk", min: 0, max: null }, { food: "chicken", min: 1, max: null }],
    ]);
  });
  it("requires a complete exact alternative", () => {
    const preference = parsePreference(["fish", "|", "milk", "*", "chicken", "+"]);
    expect(plateMatches(["fish"], preference)).toBe(true);
    expect(plateMatches(["chicken", "chicken"], preference)).toBe(true);
    expect(plateMatches(["milk", "chicken"], preference)).toBe(true);
    expect(plateMatches(["fish", "milk"], preference)).toBe(false);
  });
});

describe("resolution", () => {
  const preference = parsePreference(["fish", "+"]);
  it("returns only a unique largest eligible plate", () => {
    expect(resolveUniqueLeader([{ id: "a", plate: ["fish"] }, { id: "b", plate: ["fish", "fish"] }], preference)?.id).toBe("b");
    expect(resolveUniqueLeader([{ id: "a", plate: ["fish"] }, { id: "b", plate: ["fish"] }], preference)).toBeNull();
  });
  it("uses competition ranking for ties", () => expect(competitionRanks([{ id: "a", score: 5 }, { id: "b", score: 5 }, { id: "c", score: 2 }])).toEqual({ a: 1, b: 1, c: 3 }));
  it("requires two identical cards for a steal", () => {
    expect(canPaySteal(["milk", "milk", "fish"], "milk")).toBe(true);
    expect(canPaySteal(["milk", "fish", "fish"], "milk")).toBe(false);
  });
});

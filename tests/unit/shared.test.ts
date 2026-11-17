import { describe, expect, it } from "vitest";
import { categoryFromTags, guessCategory, parseQuickAdd } from "../../shared/categorize.ts";
import { nameKey } from "../../shared/schema.ts";

describe("parseQuickAdd", () => {
  it.each([
    ["bread", { name: "bread", quantity: null, unit: "" }],
    ["2 milk", { name: "milk", quantity: 2, unit: "" }],
    ["3x eggs", { name: "eggs", quantity: 3, unit: "" }],
    ["500g flour", { name: "flour", quantity: 500, unit: "g" }],
    ["1,5 kg potatoes", { name: "potatoes", quantity: 1.5, unit: "kg" }],
    ["2 cans chickpeas", { name: "chickpeas", quantity: 2, unit: "can" }],
    ["  7up  ", { name: "7up", quantity: null, unit: "" }],
  ])("%s", (input, expected) => {
    expect(parseQuickAdd(input)).toEqual(expected);
  });
});

describe("guessCategory", () => {
  it.each([
    ["Semi-skimmed milk", "Dairy & Eggs"],
    ["Chicken thighs", "Meat & Fish"],
    ["Bananas", "Produce"],
    ["Frozen peas", "Frozen"],
    ["Sourdough bread", "Bakery"],
    ["Basmati rice", "Pantry"],
    ["Tea lights candles", "Household"],
    ["Strawberry yoghurt", "Dairy & Eggs"],
    ["Frozen chicken breasts", "Frozen"],
    ["Chocolate bar", "Snacks"],
    ["Something odd", "Other"],
  ])("%s → %s", (name, cat) => {
    expect(guessCategory(name)).toBe(cat);
  });
});

describe("categoryFromTags", () => {
  it("prefers the most specific tag and skips umbrella tags", () => {
    expect(categoryFromTags(["en:plant-based-foods-and-beverages", "en:plant-based-foods", "en:pastas", "en:noodles"])).toBe("Pantry");
    expect(categoryFromTags(["en:dairies", "en:yogurts"])).toBe("Dairy & Eggs");
    expect(categoryFromTags([])).toBeUndefined();
  });
});

it("nameKey normalises case and spacing", () => {
  expect(nameKey("  Whole   Milk ")).toBe("whole milk");
});

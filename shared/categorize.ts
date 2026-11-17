// Best-guess category and storage location for a food name, used when the
// household catalog has no entry yet. Deliberately small: the catalog learns
// the household's own choices after the first time an item is added.
import type { LocationKind } from "./schema.ts";

const RULES: [string, string[]][] = [
  ["Frozen", ["frozen", "ice cream", "fish fingers", "peas frozen", "ice lolly", "popsicle"]],
  ["Dairy & Eggs", ["milk", "cheese", "yoghurt", "yogurt", "butter", "cream", "egg", "kefir", "feta", "mozzarella", "cheddar", "parmesan", "creme fraiche", "custard"]],
  ["Meat & Fish", ["chicken", "beef", "pork", "lamb", "mince", "bacon", "ham", "sausage", "salmon", "tuna steak", "fish", "prawn", "shrimp", "turkey", "steak", "chorizo", "salami", "cod"]],
  ["Produce", ["apple", "banana", "orange", "lemon", "lime", "grape", "berry", "berries", "strawberr", "tomato", "potato", "onion", "garlic", "carrot", "lettuce", "spinach", "salad", "pepper", "cucumber", "broccoli", "cabbage", "mushroom", "avocado", "herb", "basil", "coriander", "cilantro", "parsley", "ginger", "pear", "plum", "peach", "melon", "kale", "courgette", "zucchini", "celery", "leek", "fruit", "veg"]],
  ["Bakery", ["bread", "loaf", "bagel", "roll", "bun", "croissant", "wrap", "tortilla", "pitta", "pita", "muffin", "baguette", "crumpet"]],
  ["Drinks", ["juice", "water", "soda", "cola", "coffee", "tea", "beer", "wine", "squash", "lemonade", "kombucha"]],
  ["Snacks", ["crisps", "chips", "chocolate", "biscuit", "cookie", "cracker", "popcorn", "nuts", "bars?\\b", "sweets", "candy"]],
  ["Condiments", ["ketchup", "mayo", "mustard", "sauce", "vinegar", "oil", "dressing", "jam", "honey", "spread", "pesto", "salsa", "soy", "stock", "spice", "salt"]],
  ["Household", ["soap", "detergent", "toilet", "paper towel", "kitchen roll", "foil", "cling", "bin bag", "sponge", "shampoo", "toothpaste", "dishwasher", "washing up", "bleach", "tissues", "battery", "batteries", "candle"]],
  ["Pantry", ["rice", "pasta", "flour", "sugar", "oats", "cereal", "beans", "lentil", "chickpea", "tins?\\b", "tinned", "cans?\\b", "canned", "noodle", "quinoa", "couscous", "baking", "yeast", "tomatoes chopped", "passata"]],
];

const COMPILED = RULES.map(([category, words]) => [category, new RegExp(`(^|[^a-z])(${words.join("|")})`, "g")] as const);

/**
 * The keyword that appears last wins, because English puts the head noun last:
 * "strawberry yoghurt" is dairy, "tea light candles" is household. "Frozen" anywhere wins outright.
 */
export function guessCategory(name: string): string {
  const n = name.toLowerCase();
  if (/(^|[^a-z])frozen/.test(n)) return "Frozen";
  let best: { category: string; at: number; len: number } | undefined;
  for (const [category, re] of COMPILED) {
    for (const m of n.matchAll(re)) {
      const at = m.index + m[1].length;
      const len = m[2].length;
      if (!best || at > best.at || (at === best.at && len > best.len)) best = { category, at, len };
    }
  }
  return best?.category ?? "Other";
}

/** Where a category usually lives, so put-away can preselect a location. */
export function defaultLocationKind(category: string): LocationKind {
  switch (category) {
    case "Frozen":
      return "freezer";
    case "Dairy & Eggs":
    case "Meat & Fish":
      return "fridge";
    default:
      return "pantry";
  }
}

/** Map Open Food Facts category tags (e.g. "en:dairies") onto our categories. */
export function categoryFromTags(tags: string[]): string | undefined {
  // Tags run from general ("plant-based-foods-and-beverages") to specific, so try the specific end first.
  for (const tag of [...tags].reverse()) {
    const t = tag.toLowerCase().replace(/^[a-z]{2}:/, "");
    if (t.includes("-and-")) continue; // umbrella tags like "foods-and-beverages"
    for (const [cat, keys] of TAG_PAIRS) if (keys.some((k) => t.includes(k))) return cat;
  }
  return undefined;
}

const TAG_PAIRS: [string, string[]][] = (() => {
  const pairs: [string, string[]][] = [
    ["Frozen", ["frozen"]],
    ["Dairy & Eggs", ["dairies", "dairy", "cheeses", "milks", "yogurts", "eggs", "butters"]],
    ["Meat & Fish", ["meats", "fishes", "seafood", "poultry"]],
    ["Drinks", ["beverages", "drinks", "waters", "juices", "coffees", "teas"]],
    ["Snacks", ["snacks", "chocolates", "biscuits", "confectioneries", "crisps"]],
    ["Bakery", ["breads", "bakery", "pastries"]],
    ["Produce", ["fruits", "vegetables", "fresh"]],
    ["Condiments", ["condiments", "sauces", "spreads", "oils", "vinegars", "spices"]],
    ["Pantry", ["cereals", "pastas", "rices", "legumes", "canned", "flours", "groceries", "noodles", "meals"]],
  ];
  return pairs;
})();

/**
 * Parse a quick-add line like "2 milk", "500g flour", "3x eggs" or "bread".
 * Returns the name plus any leading quantity/unit.
 */
export function parseQuickAdd(input: string): { name: string; quantity: number | null; unit: string } {
  const s = input.trim().replace(/\s+/g, " ");
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(x|×|g|kg|ml|l|pack|packs|cans?|jars?|bottles?|box(?:es)?|bags?|loaf|loaves|dozen)?\s+(.+)$/i);
  if (!m) return { name: s, quantity: null, unit: "" };
  const quantity = Number(m[1].replace(",", "."));
  let unit = (m[2] ?? "").toLowerCase();
  if (unit === "x" || unit === "×") unit = "";
  unit = unit.replace(/^packs$/, "pack").replace(/^cans$/, "can").replace(/^jars$/, "jar").replace(/^bottles$/, "bottle").replace(/^boxes$/, "box").replace(/^bags$/, "bag").replace(/^loaves$/, "loaf");
  return { name: m[3], quantity, unit };
}

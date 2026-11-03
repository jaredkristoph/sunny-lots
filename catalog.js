'use strict';
// ---------------------------------------------------------------
// Game data. Edit prices, grow times and items here.
// grow time is in HOURS (real time). Set GROWTH_SPEED env var to
// speed everything up while testing (e.g. GROWTH_SPEED=60).
// ---------------------------------------------------------------

// id, name, buy cost, sell price, grow hours, art kind, color1, color2, variant
const SEEDS = [
  ['radish', 'Radish', 40, 100, 0.5, 'root', '#e23a5f', '#3fa34d', 0],
  ['carrot', 'Carrot', 70, 170, 1, 'root', '#f08a1c', '#3fa34d', 1],
  ['lettuce', 'Lettuce', 100, 250, 2, 'leafy', '#9be564', '#4fa83a', 0],
  ['tomato', 'Tomato', 150, 380, 3, 'bushfruit', '#e03131', '#2f9e44', 0],
  ['corn', 'Corn', 220, 560, 4, 'stalk', '#f6d13a', '#4cae3c', 0],
  ['strawberry', 'Strawberry', 300, 780, 6, 'bushfruit', '#f03e6e', '#38a04a', 1],
  ['sunflower', 'Sunflower', 400, 1050, 8, 'flower', '#ffd43b', '#6b4423', 0],
  ['pumpkin', 'Pumpkin', 550, 1450, 10, 'gourd', '#f08c00', '#3f9a3a', 0],
  ['blueberry', 'Blueberry', 750, 2000, 12, 'bushfruit', '#4263eb', '#2f8f5b', 2],
  ['eggplant', 'Eggplant', 1000, 2700, 14, 'hang', '#7048a8', '#3f9a3a', 0],
  ['watermelon', 'Watermelon', 1400, 3800, 16, 'gourd', '#2f9e44', '#a6e08a', 1],
  ['pineapple', 'Pineapple', 2000, 5500, 18, 'pine', '#f2b632', '#3f9a3a', 0],
  ['mushroom', 'Glow Mushroom', 2800, 7800, 20, 'mush', '#9c36b5', '#f1e6d0', 0],
  ['cactus', 'Bloom Cactus', 4000, 11500, 22, 'cactus', '#3d9a6a', '#ff6fa5', 0],
  ['dragonfruit', 'Dragonfruit', 6000, 17500, 24, 'hang', '#e64980', '#3f9a3a', 1],
  ['moonflower', 'Moonflower', 10000, 30000, 36, 'flower', '#e7ecff', '#7c93ff', 1],
].map(a => ({ id: a[0], name: a[1], cost: a[2], sell: a[3], hours: a[4], kind: a[5], c1: a[6], c2: a[7], v: a[8] }));

const GOLD_CHANCE = 0.02; // 2% of plantings are golden
const GOLD_MULT = 3;      // golden sells for triple
const START_MONEY = 100;

// 25 base shapes x 4 variants = 100 furniture pieces.
// [shape id, 4 names, base price]
const SHAPES = [
  ['stool', ['Pine Stool', 'Cherry Stool', 'Ocean Stool', 'Royal Stool'], 30],
  ['chair', ['Oak Chair', 'Ruby Chair', 'Sky Chair', 'Velvet Chair'], 50],
  ['lamp', ['Warm Lamp', 'Rose Lamp', 'Aqua Lamp', 'Regal Lamp'], 60],
  ['rug', ['Woven Rug', 'Crimson Rug', 'Tide Rug', 'Palace Rug'], 60],
  ['mailbox', ['Farm Mailbox', 'Cherry Mailbox', 'Harbor Mailbox', 'Grand Mailbox'], 70],
  ['barrel', ['Oak Barrel', 'Wine Barrel', 'Rain Barrel', 'Gilded Barrel'], 70],
  ['plantpot', ['Clay Planter', 'Ruby Planter', 'Azure Planter', 'Imperial Planter'], 80],
  ['bench', ['Park Bench', 'Cherry Bench', 'Bay Bench', 'Royal Bench'], 90],
  ['table', ['Oak Table', 'Cherry Table', 'Lagoon Table', 'Regal Table'], 100],
  ['clock', ['Cuckoo Clock', 'Ruby Clock', 'Tide Clock', 'Grandfather Clock'], 110],
  ['mirror', ['Oak Mirror', 'Rose Mirror', 'Frost Mirror', 'Gilded Mirror'], 120],
  ['chest', ['Wood Chest', 'Ruby Chest', 'Sea Chest', 'Treasure Chest'], 140],
  ['bookshelf', ['Oak Bookshelf', 'Cherry Bookshelf', 'Navy Bookshelf', 'Library Bookshelf'], 150],
  ['desk', ['Study Desk', 'Cherry Desk', 'Blue Desk', 'Executive Desk'], 170],
  ['grill', ['Camp Grill', 'Red Grill', 'Steel Grill', 'Chef Grill'], 180],
  ['sofa', ['Cozy Sofa', 'Ruby Sofa', 'Denim Sofa', 'Velvet Sofa'], 200],
  ['tv', ['Retro TV', 'Crimson TV', 'Cyan TV', 'Cinema TV'], 250],
  ['bed', ['Pine Bed', 'Rose Bed', 'Sky Bed', 'Royal Bed'], 260],
  ['wardrobe', ['Oak Wardrobe', 'Cherry Wardrobe', 'Blue Wardrobe', 'Grand Wardrobe'], 280],
  ['fridge', ['Cream Fridge', 'Red Fridge', 'Blue Fridge', 'Deluxe Fridge'], 320],
  ['aquarium', ['Small Aquarium', 'Coral Aquarium', 'Deep Aquarium', 'Grand Aquarium'], 380],
  ['fireplace', ['Brick Fireplace', 'Ember Fireplace', 'Frost Fireplace', 'Manor Fireplace'], 420],
  ['fountain', ['Stone Fountain', 'Rose Fountain', 'Lagoon Fountain', 'Palace Fountain'], 500],
  ['statue', ['Stone Statue', 'Ruby Statue', 'Marble Statue', 'Golden Statue'], 600],
  ['piano', ['Upright Piano', 'Cherry Piano', 'Midnight Piano', 'Grand Piano'], 800],
];
const PALS = [
  ['#c8934f', '#e8c590', '#7a5228'],
  ['#d64545', '#f4a0a0', '#8c1f1f'],
  ['#3f8fe0', '#9ccdf7', '#1f528f'],
  ['#8e4fc9', '#ffd24d', '#4d2a75'],
];
const MULT = [1, 1.5, 2.2, 3.5];
const FURNITURE = [];
for (const [shape, names, base] of SHAPES) {
  names.forEach((name, v) => {
    FURNITURE.push({ id: shape + '_' + v, name, shape, v, pal: PALS[v], price: Math.round(base * MULT[v] / 10) * 10 });
  });
}

// id, name, slot, price, [color1, color2], pattern/shape, extra
const CLOTHES = [
  // ---- tops (first two are the free common ones)
  ['top_tee_white', 'Plain White Tee', 'top', 0, ['#f1f3f5', '#dee2e6'], 'solid'],
  ['top_tee_grey', 'Plain Grey Tee', 'top', 0, ['#adb5bd', '#868e96'], 'solid'],
  ['top_polo_sky', 'Sky Polo', 'top', 80, ['#4dabf7', '#1c7ed6'], 'collar'],
  ['top_sailor', 'Sailor Stripes', 'top', 150, ['#f8f9fa', '#364fc7'], 'stripes'],
  ['top_hoodie_red', 'Red Hoodie', 'top', 180, ['#e03131', '#a61e1e'], 'collar', 'long'],
  ['top_blouse_dots', 'Polka Blouse', 'top', 160, ['#ffa8cc', '#fff0f6'], 'dots'],
  ['top_flannel', 'Plaid Flannel', 'top', 200, ['#c92a2a', '#212529'], 'check', 'long'],
  ['top_star_tee', 'Starry Tee', 'top', 220, ['#1c2b5a', '#ffd43b'], 'stars'],
  ['top_zigzag', 'Zigzag Sweater', 'top', 240, ['#12b886', '#fff3bf'], 'zigzag', 'long'],
  ['top_heart', 'Heart Tee', 'top', 260, ['#ffc9de', '#e64980'], 'heart'],
  ['top_chef', 'Chef Coat', 'top', 300, ['#ffffff', '#adb5bd'], 'vest', 'long'],
  ['top_purple_jacket', 'Purple Jacket', 'top', 350, ['#7048a8', '#b197fc'], 'vest', 'long'],
  ['top_gold_vest', 'Gold Vest', 'top', 400, ['#f2b632', '#fff3bf'], 'vest'],
  ['top_tux', 'Tuxedo', 'top', 600, ['#212529', '#f8f9fa'], 'vest', 'long'],
  ['top_royal_robe', 'Royal Robe', 'top', 900, ['#862e9c', '#ffd43b'], 'zigzag', 'long'],
  // ---- bottoms
  ['bot_jeans', 'Blue Jeans', 'bottom', 0, ['#4263a8', '#334e8a'], 'solid', 'long'],
  ['bot_shorts_grey', 'Grey Shorts', 'bottom', 0, ['#9aa0a6', '#7d838a'], 'solid', 'short'],
  ['bot_khaki', 'Khaki Pants', 'bottom', 90, ['#c9b37e', '#a8935c'], 'solid', 'long'],
  ['bot_red_shorts', 'Red Shorts', 'bottom', 100, ['#e03131', '#a61e1e'], 'solid', 'short'],
  ['bot_slacks', 'Black Slacks', 'bottom', 120, ['#2b2d31', '#44464c'], 'stripes', 'long'],
  ['bot_pink_skirt', 'Pink Skirt', 'bottom', 140, ['#ff8fb8', '#ffc9de'], 'solid', 'skirt'],
  ['bot_stripe_pants', 'Striped Pants', 'bottom', 180, ['#f8f9fa', '#2f9e44'], 'stripes', 'long'],
  ['bot_plaid_skirt', 'Plaid Skirt', 'bottom', 200, ['#c92a2a', '#212529'], 'check', 'skirt'],
  ['bot_camo', 'Camo Pants', 'bottom', 220, ['#5c7a3a', '#33481f'], 'dots', 'long'],
  ['bot_overalls', 'Denim Overalls', 'bottom', 260, ['#3b6fd1', '#f2b632'], 'dots', 'long'],
  ['bot_gold', 'Gold Pants', 'bottom', 500, ['#f2b632', '#fff3bf'], 'zigzag', 'long'],
  // ---- hats ('' = none, free)
  ['hat_headband', 'Sport Headband', 'hat', 50, ['#e03131', '#ffffff'], 'headband'],
  ['hat_red_cap', 'Red Cap', 'hat', 60, ['#e03131', '#ffffff'], 'cap'],
  ['hat_beanie', 'Blue Beanie', 'hat', 70, ['#3b82f6', '#e7f0ff'], 'beanie'],
  ['hat_straw', 'Straw Hat', 'hat', 90, ['#e8c76a', '#d6472b'], 'straw'],
  ['hat_party', 'Party Hat', 'hat', 100, ['#ff6fb5', '#ffe066'], 'party'],
  ['hat_chef', 'Chef Hat', 'hat', 120, ['#ffffff', '#ffffff'], 'chef'],
  ['hat_cowboy', 'Cowboy Hat', 'hat', 140, ['#8a5a2b', '#e8c76a'], 'cowboy'],
  ['hat_cat', 'Cat Ears', 'hat', 180, ['#2b2b2b', '#ff9ec4'], 'cat'],
  ['hat_flowers', 'Flower Crown', 'hat', 220, ['#ff6fa5', '#ffe066'], 'flowers'],
  ['hat_helmet', 'Safety Helmet', 'hat', 260, ['#f2b632', '#3b3b3b'], 'helmet'],
  ['hat_tophat', 'Top Hat', 'hat', 300, ['#1f1f23', '#c92a2a'], 'tophat'],
  ['hat_wizard', 'Wizard Hat', 'hat', 400, ['#4c3a9e', '#ffd43b'], 'wizard'],
  ['hat_crown', 'Golden Crown', 'hat', 1500, ['#f2b632', '#e03131'], 'crown'],
  // ---- shoes
  ['shoe_plain', 'Plain Sneakers', 'shoes', 0, ['#e9ecef', '#adb5bd'], 'solid'],
  ['shoe_sandals', 'Sandals', 'shoes', 50, ['#c9a066', '#8a6a3a'], 'solid'],
  ['shoe_red', 'Red Sneakers', 'shoes', 80, ['#e03131', '#ffffff'], 'solid'],
  ['shoe_rain', 'Rain Boots', 'shoes', 120, ['#f2c200', '#a68900'], 'solid'],
  ['shoe_boots', 'Black Boots', 'shoes', 150, ['#2b2d31', '#555'], 'solid'],
  ['shoe_gold', 'Gold Shoes', 'shoes', 500, ['#f2b632', '#fff3bf'], 'solid'],
].map(a => {
  const o = { id: a[0], name: a[1], slot: a[2], price: a[3], c: a[4] };
  if (a[2] === 'hat') o.shape = a[5]; else o.pat = a[5];
  if (a[2] === 'bottom') o.len = a[6];
  if (a[2] === 'top') o.long = a[6] === 'long';
  return o;
});

const SKINS = ['#ffe0c7', '#f5cba0', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e'];
const HAIRS = ['#2b1b0e', '#5a3825', '#a0522d', '#e6b800', '#d9d9d9', '#c0392b', '#2e86de', '#8e44ad', '#e84393'];
const DEFAULT_AVATAR = {
  gender: 'male', skin: '#f5cba0', hairColor: '#5a3825',
  top: 'top_tee_white', bottom: 'bot_jeans', hat: '', shoes: 'shoe_plain',
};

// ---- World layout (in tiles). 8 lands: 4 across, 2 rows, shop plaza in the middle.
const LAND_SIZE = 8;
const WORLD = {
  tile: 48,
  landSize: LAND_SIZE,
  landCount: 8,
  width: 42,
  height: 26,
  lands: [],
  shop: { x: 18, y: 11, w: 6, h: 3 },
  shopDoor: { x: 21, y: 14.6 },
};
for (let i = 0; i < 8; i++) WORLD.lands.push({ x: 2 + (i % 4) * 10, y: 2 + Math.floor(i / 4) * 14 });

module.exports = {
  SEEDS, FURNITURE, CLOTHES, SKINS, HAIRS, DEFAULT_AVATAR, WORLD,
  GOLD_CHANCE, GOLD_MULT, START_MONEY,
  SHAPE_IDS: SHAPES.map(s => s[0]),
  SEED_BY: Object.fromEntries(SEEDS.map(s => [s.id, s])),
  FURN_BY: Object.fromEntries(FURNITURE.map(s => [s.id, s])),
  CLOTH_BY: Object.fromEntries(CLOTHES.map(s => [s.id, s])),
};

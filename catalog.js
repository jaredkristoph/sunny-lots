'use strict';
// ---------------------------------------------------------------
// Game data. Edit prices, grow times and items here.
// grow time is in HOURS (real time). Set GROWTH_SPEED env var to
// speed everything up while testing (e.g. GROWTH_SPEED=60).
// ---------------------------------------------------------------

// id, name, buy cost, sell price, grow hours, art kind, color1, color2, variant
// 5/60 ≈ 0.0833 hours = 5 real minutes
const SEEDS = [
  ['sprout', 'Quick Sprout', 15, 28, 5 / 60, 'leafy', '#b2f2bb', '#51cf66', 0],
  ['pea', 'Sugar Pea', 20, 38, 5 / 60, 'bushfruit', '#94d82d', '#2f9e44', 2],
  ['herb', 'Garden Herb', 25, 48, 5 / 60, 'leafy', '#69db7c', '#2b8a3e', 1],
  ['scallion', 'Scallion', 30, 55, 5 / 60, 'stalk', '#ffd43b', '#37b24d', 0],
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
  // house-building pieces
  ['door', ['Pine Door', 'Cherry Door', 'Sky Door', 'Manor Door'], 180],
  ['gate', ['Garden Gate', 'Rose Gate', 'Harbor Gate', 'Iron Gate'], 220],
  ['wall', ['Plaster Wall', 'Brick Wall', 'Blue Wall', 'Marble Wall'], 120],
  ['window', ['Oak Window', 'Rose Window', 'Frost Window', 'Stained Window'], 160],
  ['roof', ['Shingle Roof', 'Red Roof', 'Slate Roof', 'Gold Roof'], 200],
  ['hedge', ['Box Hedge', 'Rose Hedge', 'Topiary Hedge', 'Royal Hedge'], 90],
  ['counter', ['Kitchen Counter', 'Cherry Counter', 'Tile Counter', 'Marble Counter'], 210],
  ['sink', ['Basin Sink', 'Rose Sink', 'Chrome Sink', 'Gold Sink'], 190],
  ['stove', ['Cook Stove', 'Red Stove', 'Steel Stove', 'Chef Stove'], 280],
  ['toilet', ['Basic Toilet', 'Rose Toilet', 'Sea Toilet', 'Royal Toilet'], 240],
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

// 4x4-tile showpieces: one anchor tile (top-left) carries the piece, the other 15 tiles are {type:'part'} markers
const BIG_SHAPES = [
  ['gazebo', ['Garden Gazebo', 'Rose Gazebo', 'Lagoon Gazebo', 'Palace Gazebo'], 2400],
  ['pool', ['Garden Pool', 'Coral Pool', 'Lagoon Pool', 'Royal Pool'], 3000],
  ['windmill', ['Farm Windmill', 'Red Windmill', 'Blue Windmill', 'Royal Windmill'], 3600],
];
for (const [shape, names, base] of BIG_SHAPES) {
  names.forEach((name, v) => FURNITURE.push({ id: shape + '_' + v, name, shape, v, pal: PALS[v], size: 4, price: Math.round(base * MULT[v] / 10) * 10 }));
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

// ---- World layout (in tiles).
// Tile data is stored relative to each land origin — moving a land's world x/y
// does not wipe crops. Never reorder / remove land indices 0–7.
const LAND_SIZE = 8;
const LAND_GAP = 5; // empty tiles between neighboring starter plots
const LAND_STRIDE = LAND_SIZE + LAND_GAP; // 13
const EXPAND_COST = 25000; // separate expansion farm plots
const HOUSE_COST = 10000;  // dedicated house-building lots
const SQUARE_COST = 140; // first extra tile around your starter farm
const SQUARE_GROW = 70;  // each next square costs this much more than the previous
const SQUARE_MAX = 20;   // max bought squares per starter land
/** Price for the next square given how many extras you already own */
function squarePrice(ownedExtras) {
  const n = Math.max(0, Math.floor(Number(ownedExtras) || 0));
  return SQUARE_COST + n * SQUARE_GROW;
}
const TAP_MIN = 0.1;     // plant-care tap earnings while growing
const TAP_MAX = 0.5;
const WORLD = {
  tile: 48,
  landSize: LAND_SIZE,
  // 8 farm + 4 expansion + 8 house + 1 NPC model home (indices 0–7 forever farm starters)
  landCount: 21,
  width: 74,
  height: 66,
  lands: [],
  // shop sits in the 5-tile crossroads between the 8 farm plots
  shop: { x: 23, y: 10, w: 5, h: 4 },
  shopDoor: { x: 25.5, y: 14.2 },
  stalls: [
    { id: 'lemonade', name: 'Lemonade Stand', x: 0.5, y: 8, game: 'typing', pay: [12, 20], cd: 45 },
    { id: 'flowers', name: 'Flower Cart', x: 0.5, y: 12, game: 'simon', pay: [12, 22], cd: 50 },
    { id: 'craft', name: 'Egg Catch Hut', x: 0.5, y: 16, game: 'eggs', pay: [14, 24], cd: 50 },
    { id: 'bakery', name: 'Invader Arcade', x: 0.5, y: 20, game: 'invader', pay: [15, 26], cd: 55 },
    { id: 'arcade', name: 'Race Booth', x: 49.5, y: 12, game: 'race', pay: [15, 26], cd: 55 },
  ],
  petShop: { x: 12, y: 24, w: 4, h: 3 },
  pens: {
    chicken: { x: 1, y: 24, w: 4, h: 2 },
    cow: { x: 1, y: 26, w: 4, h: 2 },
    sheep: { x: 6, y: 26, w: 4, h: 2 },
  },
  park: { x: 22, y: 24, w: 10, h: 5 },
  // Sunny Casino — two tables east of the park (min bet 50, see casino.js)
  casino: [
    { id: 'roulette', name: 'Roulette Table', x: 55, y: 30 },
    { id: 'blackjack', name: 'Blackjack Table', x: 55, y: 35 },
  ],
  bushes: [
    { id: 'b1', x: 36, y: 25 }, { id: 'b2', x: 40, y: 27 }, { id: 'b3', x: 48, y: 26 },
    { id: 'b4', x: 54, y: 8 }, { id: 'b5', x: 54, y: 20 }, { id: 'b6', x: 18, y: 37 },
    { id: 'b7', x: 32, y: 37 }, { id: 'b8', x: 46, y: 37 },
  ],
};
// Farm starters (0–7): 5 empty tiles between each 8×8 plot
for (let i = 0; i < 8; i++) {
  WORLD.lands.push({
    x: 2 + (i % 4) * LAND_STRIDE,
    y: 2 + Math.floor(i / 4) * LAND_STRIDE,
    expand: false,
  });
}
// Expansion farm lots (8–11) — far east, clear of house/NPC lots
WORLD.lands.push(
  { x: 62, y: 2, expand: true },
  { x: 62, y: 16, expand: true },
  { x: 62, y: 30, expand: true },
  { x: 62, y: 44, expand: true },
);
// House-building lots (12–19) — south of the farm grid (not expandable)
for (let i = 0; i < 8; i++) {
  WORLD.lands.push({
    x: 2 + (i % 4) * LAND_STRIDE,
    y: 32 + Math.floor(i / 4) * LAND_STRIDE,
    house: true,
  });
}
// NPC model home (20) — south of house lots, clear of expansions (needs height ≥ 66)
WORLD.lands.push({ x: 28, y: 54, house: true, npc: true });
// Jar Sea — a sea in the south-west corner, clear of house lots (y<=52) and the model home (x>=28).
// Shipped to the client as a precomputed tile list ("x,y") so both sides agree on the shoreline.
WORLD.sea = { name: 'Jar Sea', tiles: [] };
for (let ty = 0; ty < WORLD.height; ty++) {
  for (let tx = 0; tx < WORLD.width; tx++) {
    const eastShore = 20 + Math.round(2.2 * Math.sin(ty * 0.75) + 1.2 * Math.sin(ty * 0.31 + 1));
    const northShore = 58 + Math.round(1.6 * Math.sin(tx * 0.5) + 1.0 * Math.sin(tx * 0.21 + 2));
    if (tx < eastShore && ty >= northShore) WORLD.sea.tiles.push(tx + ',' + ty);
  }
}
{ // drop stray single tiles so the shoreline has no little puddles
  const set = new Set(WORLD.sea.tiles);
  WORLD.sea.tiles = WORLD.sea.tiles.filter(k => {
    const [x, y] = k.split(',').map(Number);
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => set.has((x + dx) + ',' + (y + dy)) || x + dx < 0 || y + dy >= WORLD.height).length >= 2;
  });
}
WORLD.width = 74;
WORLD.height = 66;

// Interior furniture only — walls/roof come from the cottage shell voxel
const NPC_HOME_VER = 3;
const NPC_HOME_FURN = [
  // bedroom (back-left)
  ['1,1', 'bed_1'], ['2,1', 'wardrobe_0'], ['1,2', 'lamp_0'], ['2,2', 'chest_0'],
  // living room (center)
  ['3,2', 'sofa_0'], ['4,2', 'rug_0'], ['5,2', 'tv_0'], ['4,3', 'table_0'], ['3,3', 'lamp_1'], ['5,3', 'bookshelf_0'],
  // kitchen (right)
  ['6,1', 'fridge_0'], ['6,2', 'stove_0'], ['6,3', 'counter_0'], ['5,1', 'sink_0'],
  // bath (front-right corner nook)
  ['6,5', 'toilet_0'], ['6,4', 'mirror_0'],
  // cozy extras
  ['2,4', 'fireplace_0'], ['3,4', 'plantpot_0'], ['1,5', 'clock_0'],
  // front garden path
  ['2,7', 'hedge_0'], ['3,7', 'gate_0'], ['4,7', 'hedge_0'], ['5,7', 'mailbox_0'], ['1,7', 'plantpot_1'],
];

// Exclusive bush loot — not sold in shops (buyable: false). ~5% drop when foraging.
const RARE_FURN = [
  { id: 'bush_gnome', name: 'Garden Gnome', shape: 'gnome', v: 0, pal: ['#d6453d', '#f8f4ec', '#3b5ba5'], price: 0, buyable: false },
  { id: 'bush_lantern', name: 'Firefly Lantern', shape: 'lantern', v: 1, pal: ['#ffe066', '#fff9db', '#c9a227'], price: 0, buyable: false },
  { id: 'bush_totem', name: 'Moss Totem', shape: 'totem', v: 1, pal: ['#5c7a3a', '#b2f2bb', '#33481f'], price: 0, buyable: false },
  { id: 'bush_hammock', name: 'Leaf Hammock', shape: 'hammock', v: 0, pal: ['#8ce99a', '#d8f5a2', '#2f9e44'], price: 0, buyable: false },
];
const RARE_CLOTH = [
  { id: 'top_leafcloak', name: 'Leaf Cloak', slot: 'top', price: 0, c: ['#40c057', '#212529'], pat: 'zigzag', long: true, buyable: false },
  { id: 'hat_acorn', name: 'Acorn Cap', slot: 'hat', price: 0, c: ['#8a5a2b', '#f2b632'], shape: 'beanie', buyable: false },
  { id: 'bot_vines', name: 'Vine Trousers', slot: 'bottom', price: 0, c: ['#2f9e44', '#94d82d'], pat: 'stripes', len: 'long', buyable: false },
  { id: 'shoe_moss', name: 'Moss Slippers', slot: 'shoes', price: 0, c: ['#69db7c', '#2b8a3e'], pat: 'solid', buyable: false },
];
for (const f of RARE_FURN) FURNITURE.push(f);
for (const c of RARE_CLOTH) CLOTHES.push(c);

const BUSH_DROP = 0.05;
const BUSH_CD = 90; // seconds between forages per bush per player
const BUSH_LOOT = [...RARE_FURN.map(f => ({ kind: 'furn', id: f.id })), ...RARE_CLOTH.map(c => ({ kind: 'cloth', id: c.id }))];

const ANIMALS = {
  chicken: { name: 'Chicken', buy: 90, eggEvery: 480, eggSell: 14, meatSell: 45, max: 8 },
  cow: { name: 'Cow', buy: 280, milkPay: [16, 26], milkCd: 70, meatSell: 120, max: 4 },
  sheep: { name: 'Sheep', buy: 200, woolCd: 90, woolSell: 20, meatSell: 90, max: 6 },   // woolCd: seconds for a sheared sheep to regrow
};
const PETS = [
  { id: 'pet_dog', name: 'Puppy', price: 350 },
  { id: 'pet_cat', name: 'Kitten', price: 320 },
  { id: 'pet_bunny', name: 'Bunny', price: 280 },
];
const PRODUCTS = {
  egg: { name: 'Egg', sell: 14 },
  milk: { name: 'Milk', sell: 20 },
  wool: { name: 'Wool', sell: 20 },
  meat: { name: 'Meat', sell: 50 },
};

const MINIGAMES = {
  typing: { name: 'Typing Sentence' },
  simon: { name: 'Simon Says' },
  eggs: { name: 'Catch Falling Eggs' },
  invader: { name: 'Space Invaders' },
  race: { name: 'Race Simulator' },
};

module.exports = {
  SEEDS, FURNITURE, CLOTHES, SKINS, HAIRS, DEFAULT_AVATAR, WORLD,
  GOLD_CHANCE, GOLD_MULT, START_MONEY, EXPAND_COST, HOUSE_COST, SQUARE_COST, SQUARE_GROW, SQUARE_MAX, squarePrice,
  TAP_MIN, TAP_MAX, NPC_HOME_FURN, NPC_HOME_VER,
  BUSH_DROP, BUSH_CD, BUSH_LOOT, ANIMALS, PETS, PRODUCTS, MINIGAMES, RARE_FURN, RARE_CLOTH,
  SHAPE_IDS: SHAPES.concat(BIG_SHAPES).map(s => s[0]),
  SEED_BY: Object.fromEntries(SEEDS.map(s => [s.id, s])),
  FURN_BY: Object.fromEntries(FURNITURE.map(s => [s.id, s])),
  CLOTH_BY: Object.fromEntries(CLOTHES.map(s => [s.id, s])),
  PET_BY: Object.fromEntries(PETS.map(p => [p.id, p])),
};

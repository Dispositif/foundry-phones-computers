import { hasSignal } from "./devices.js";
import { t } from "./i18n.js";
import { universeKey } from "./universes.js";
/* -------------------------------------------- */
/*  Random names that fit the world's universe   */
/* -------------------------------------------- */

/*
 * Model patterns: "#" any digit, "%" a digit from 1 to 9, "@" a capital letter,
 * "$" a hexadecimal digit, "&" a capital letter or a digit, "{a|b}" one of the choices.
 * Real brands only come with invented model numbers. Cyberpunk brands are all invented
 * (never names from existing games or films).
 */
const BRANDS = {
  retro: {
    mobile: {
      Motorola: ["R##", "C#0", "Z###", "{Micro|Star}line %0"],
      Nokia: ["%##0", "%%10", "%1#"],
      Ericsson: ["GH ###", "T%#", "A#{s|e}"],
      Alcatel: ["HC ###", "One %0"],
      Siemens: ["S%", "C##", "M#5"],
      Sagem: ["MC ###", "RC %0"],
      NEC: ["P###", "G#"],
      Philips: ["Fizz %", "Genie %0"]
    },
    // 1980s brick phones.
    brick: {
      Motorola: ["DynaTAC %000X", "DynaTAC %500"]
    },
    pager: {
      Motorola: ["P-###", "LX#", "Bravo A#"],
      NEC: ["Page %#", "R%"],
      Panasonic: ["KX-P%#"],
      Philips: ["Beep ###", "P%0"]
    },
    landline: {
      Thomson: ["TX-%#0", "Telic %"],
      Matra: ["Matracom %#", "MT-%#"],
      Philips: ["TD ###", "Onis %"],
      Panasonic: ["KX-T####"],
      Siemens: ["Euroset %#"]
    },
    computer: {
      Toshiba: ["T%###", "Satellite %##"],
      Compaq: ["LTE %86", "Armada %##"],
      IBM: ["ThinkPad %#0", "PS/% L##"],
      NEC: ["UltraLite %#"],
      Zenith: ["MinisPort %#"],
      Olivetti: ["Quaderno %#"]
    },
    desktop: {
      IBM: ["PS/% %0", "%#86"],
      Commodore: ["PC %0", "Amiga %000"],
      Olivetti: ["M2#", "PCS %#"],
      Compaq: ["Deskpro %86"],
      Digital: ["VT%##", "VAXstation %0"],
      Bull: ["Questar %##"],
      Tandy: ["%000 {SX|TX|HX}"]
    }
  },
  modern: {
    smartphone: {
      Samsung: ["Galaxy S2#", "Galaxy A#%"],
      Google: ["Pixel %#", "Pixel %{a| Pro}"],
      Xiaomi: ["Redmi Note %#", "%#T Pro"],
      Sony: ["Xperia % {V|IV}"],
      Motorola: ["Edge %0", "Moto G#%"],
      Nokia: ["X#%", "G#%"],
      Oppo: ["Find X%", "Reno %#"],
      Fairphone: ["%"]
    },
    mobile: {
      Nokia: ["%10", "%#10 Flip"],
      Alcatel: ["%0#%"],
      Doro: ["%#0"],
      Samsung: ["B#%0"]
    },
    // Satellite phone
    "sat-brick": {
      Iridium: ["%5##", "Extreme %"]
    },
    pager: {
      Motorola: ["PX %##"],
      Unication: ["G%", "Elite%"],
      Apollo: ["Gold %", "A%#"]
    },
    landline: {
      Panasonic: ["KX-TG%##0"],
      Gigaset: ["C%##", "A%##"],
      Philips: ["D%##"],
      Cisco: ["IP %8#1"],
      Polycom: ["VVX %0#"]
    },
    computer: {
      Dell: ["Latitude %#%0", "XPS 1%"],
      Lenovo: ["ThinkPad X1#", "ThinkBook 1% G%"],
      HP: ["EliteBook %#0 G%", "ProBook %#0"],
      Asus: ["ZenBook 1%", "VivoBook %#"],
      Acer: ["Swift %", "Aspire %"],
      Dynabook: ["Portégé X%0"]
    },
    desktop: {
      Dell: ["OptiPlex %0#0", "Precision %#%0"],
      HP: ["EliteDesk %00 G%", "ProDesk %00"],
      Lenovo: ["ThinkCentre M%0", "IdeaCentre %"],
      Asus: ["ExpertCenter D%"],
      Fujitsu: ["Esprimo P%#"]
    }
  },
  cyberpunk: {
    smartphone: {
      Kaido: ["{Wraith|Kitsune|Oni} K%", "K-%#"],
      Hexatron: ["Pulse %#$", "HX-%#"],
      Ryūsei: ["{Raijin|Sora|Hikari} %", "RS-%0"],
      Voltaic: ["Shard %#", "V-{Neo|Max} %"],
      MiraiTek: ["Echo %#", "MT-%#0"]
    },
    computer: {
      Kaido: ["{Ghost|Wraith} Deck %", "KD-%#"],
      Hexatron: ["Cortex %#$", "HX-Deck %"],
      Okabe: ["OL-%#0", "Nomad %"],
      "Obsidian Labs": ["Monolith %#", "Shade %"],
      Voltaic: ["Arc %#"]
    },
    desktop: {
      Hexatron: ["Mainframe %#", "HX-Rig %0#"],
      Okabe: ["Bastion %#0", "OL-Core %"],
      "Obsidian Labs": ["Basalt %#", "Node %#$"],
      Ryūsei: ["Tenshu %#"],
      MiraiTek: ["Hive %#0"]
    },
    pager: {
      Hexatron: ["Blip %#", "HX-P %"],
      Voltaic: ["Ping %#"],
      Ryūsei: ["Kotoba %"]
    },
    landline: {
      Okabe: ["Desk Link %#"],
      MiraiTek: ["Vox %0"],
      Hexatron: ["Hardline %#"]
    },
    jammer: {
      "Obsidian Labs": ["Hush %"],
      Kaido: ["Silencer K%", "Void %#"]
    }
  },
  // Every universe: invented military-looking brands.
  any: {
    jammer: {
      Sentinel: ["J-%#0", "J-%00"],
      Ironwall: ["JX-%#", "JX-%#0"],
      Aegis: ["RF-%#0", "RF-%#"]
    }
  }
};

/** Network operators, shown when a phone is switched on (also reusable as the network's own sender). */
export const OPERATORS = {
  retro: ["Continental Cellular", "Pacific Bellwave", "Unitel 2000"],
  modern: ["Halcyon Mobile", "Soren Telecom", "Nexa"],
  cyberpunk: ["Hexanet", "Sable Mesh", "Tetsu Grid"]
};

/** Machine names of laptops and terminals. */
const HOSTS = {
  retro: { computer: ["PORT-%#", "LAPTOP-0%", "PC-%##"], desktop: ["SYS-0%#", "NODE%#", "HQ-0%", "UNIX-%#", "PC-%##"] },
  modern: { computer: ["LAPTOP-&&&&&&&"], desktop: ["DESKTOP-&&&&&&&", "WS-%####"] },
  cyberpunk: { computer: ["DECK-%#@", "GHOST-%#", "SHARD-$$$"], desktop: ["NODE-$$", "RIG-$$$$", "CORE-%#$"] }
};

/** Mail domains (invented). */
const MAIL = {
  retro: { domains: ["dialnet.net", "telmail.com", "bbslink.net", "infoserv.com"], numeric: ["dialnet.net", "infoserv.com"] },
  modern: { domains: ["mailbox.net", "postia.com", "inboxa.net", "zephyrmail.com"] }
};
const HANDLES = ["contact", "office", "admin", "info", "archives", "desk", "staff"];

/* Universe whose lists are used: an unknown one falls back on modern. */
function eras() {
  const key = universeKey();
  return BRANDS[key] ? [key] : ["modern"];
}

/** A random function: Math.random, or one fixed by a seed (same seed, same result). */
function rng(seed) {
  if (seed === undefined || seed === null || seed === "") return Math.random;
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (list, r) => list[Math.floor(r() * list.length)];

/** Expands a pattern (see above). */
function expand(pattern, r = Math.random) {
  const sets = { "#": "0123456789", "%": "123456789", "@": "ABCDEFGHJKLMNPRSTVWXYZ", $: "0123456789ABCDEF", "&": "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ" };
  return pattern
    .replace(/\{([^}]*)\}/g, (m, choices) => pick(choices.split("|"), r))
    .replace(/[#%@$&]/g, (c) => pick(sets[c], r));
}

/**
 * Random "brand model" for a new device of this model, in the world's universe ("Motorola R33"). null if none fits.
 * satellite: a satellite device takes a name from the "sat-<model>" lists when the universe has one.
 */
export function deviceName(model, { satellite = false } = {}) {
  if (satellite && eras().some((era) => BRANDS[era]?.[`sat-${model}`])) model = `sat-${model}`;
  const pool = [];
  for (const era of [...eras(), "any"]) {
    const brands = BRANDS[era]?.[model];
    if (brands) for (const [brand, models] of Object.entries(brands)) pool.push([brand, models]);
  }
  // A model the universe does not know (smartphone in the 80s): modern brands.
  if (!pool.length && BRANDS.modern[model]) pool.push(...Object.entries(BRANDS.modern[model]));
  if (!pool.length) return null;
  const [brand, models] = pick(pool, Math.random);
  return `${brand} ${expand(pick(models, Math.random))}`;
}

/** Network operator of a phone: always the same for a given device (seeded by its number). */
export function operatorName(phone) {
  const key = universeKey();
  const list = OPERATORS[key] ?? OPERATORS.modern;
  return pick(list, rng(phone?.number || "operator"));
}

/** How long the operator shows when a phone is switched on (ms). */
export const BOOT_MS = 2500;

/** Text shown when a phone is switched on: its operator, or "No signal". */
export function bootText(phone) {
  return hasSignal(phone) && game.users.activeGM ? operatorName(phone) : t("Net.NoSignalShort");
}

/** Machine name of a laptop or a terminal: always the same for a given device (seeded by its number). */
export function hostName(phone) {
  const r = rng(phone?.number || "host");
  const key = universeKey();
  const era = HOSTS[key] ? key : "modern";
  const list = HOSTS[era][phone?.model === "desktop" ? "desktop" : "computer"];
  return expand(pick(list, r), r);
}

/* "Ana María Reyes" -> ["ana", "maria", "reyes"] (letters and digits only). */
function nameWords(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Random mail address in the universe's style, made from the holder's name when there is one. */
export function mailAddress(name) {
  const r = Math.random;
  const words = nameWords(name);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : null;
  const two = () => String(Math.floor(r() * 90) + 10);
  const era = MAIL[universeKey()] ? universeKey() : "modern";
  if (era === "retro") {
    // Online services of the time: numeric IDs, or 8-letter user names.
    if (!words.length || r() < 0.4) return `7${Math.floor(r() * 9000) + 1000}.${Math.floor(r() * 900) + 100}@${pick(MAIL.retro.numeric, r)}`;
    return `${(last ? first[0] + last : first).slice(0, 8)}@${pick(MAIL.retro.domains, r)}`;
  }
  const domain = pick(MAIL.modern.domains, r);
  if (!words.length) return `${pick(HANDLES, r)}${two()}@${domain}`;
  if (!last) return `${first}${two()}@${domain}`;
  return pick([`${first}.${last}`, `${first[0]}.${last}${two()}`, `${first}${last[0]}${two()}`], r) + `@${domain}`;
}

import { DialogV2, MODULE_ID } from "./constants.js";
import { allPhones } from "./devices.js";
import { esc } from "./util.js";
import { t } from "./i18n.js";

/* -------------------------------------------- */
/*  GM: "What's new" after an update            */
/* -------------------------------------------- */

/**
 * Version whose highlights are in the language files ("News.Lines", one per line, **bold** allowed,
 * "## 1.5" starts a version's section, so the previous version can stay listed below).
 * Update both together at release time; a release without new highlights keeps the old version here.
 */
export const NEWS_VERSION = "1.5.0";

const CHANGELOG_URL = "https://github.com/Dispositif/foundry-phones-computers/blob/main/CHANGELOG.md";

export function openNews() {
  const bold = (l) => esc(l).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  let lines = "";
  let open = false;
  for (const l of t("News.Lines").split("\n").map((x) => x.trim()).filter(Boolean)) {
    if (l.startsWith("## ")) {
      lines += `${open ? "</ul>" : ""}<h3>${esc(l.slice(3))}</h3><ul>`;
      open = true;
      continue;
    }
    if (!open) lines += "<ul>";
    open = true;
    lines += `<li>${bold(l)}</li>`;
  }
  if (open) lines += "</ul>";
  return DialogV2.prompt({
    window: { title: t("News.Title", { version: NEWS_VERSION.replace(/\.0$/, "") }), icon: "fas fa-gift" },
    position: { width: 520 },
    content: `<div class="spt-news">${lines}
      <p class="spt-news-more"><a href="${CHANGELOG_URL}" target="_blank" rel="noopener">${t("News.Changelog")}</a></p></div>`,
    ok: { label: t("Ok"), icon: "fas fa-check" },
    rejectClose: false
  }).catch(() => {});
}

/**
 * Shown once per GM (user flag) when the module reaches NEWS_VERSION.
 * A world with no device yet gets the welcome window instead: nothing new for a new GM.
 */
export async function maybeNews() {
  if (!game.user.isGM) return;
  const version = game.modules.get(MODULE_ID)?.version ?? "0";
  if (foundry.utils.isNewerVersion(NEWS_VERSION, version)) return;
  const seen = game.user.getFlag(MODULE_ID, "newsSeen") ?? "0";
  if (!foundry.utils.isNewerVersion(NEWS_VERSION, seen)) return;
  await game.user.setFlag(MODULE_ID, "newsSeen", NEWS_VERSION);
  if (allPhones({ jammers: true }).length) openNews();
}

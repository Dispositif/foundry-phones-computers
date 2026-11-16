import { MODULE_ID } from "./constants.js";
import { PhonePanel } from "./gm-panel.js";
import { openPanel } from "./main.js";
import { t } from "./i18n.js";

/* -------------------------------------------- */
/*  Guided tour of the GM panel (Foundry Tour)  */
/* -------------------------------------------- */

const TOUR_ID = "network";
const PANEL = "#spt-phone-panel";

/** Steps: the panel tab to show, and the element to point at. */
const STEPS = [
  { id: "send", tab: "send", selector: `${PANEL} .spt-tab[data-tab="send"]` },
  { id: "recipient", tab: "send", selector: `${PANEL} .spt-gm-send .spt-send-to` },
  { id: "sender", tab: "send", selector: `${PANEL} .spt-gm-send .form-group:has([name="sender"])` },
  { id: "mode", tab: "send", selector: `${PANEL} .spt-gm-send .spt-segmented, ${PANEL} .spt-gm-send .spt-phone-row` },
  { id: "inbox", tab: "inbox", selector: `${PANEL} .spt-tab[data-tab="inbox"]` },
  { id: "devices", tab: "devices", selector: `${PANEL} .spt-tab[data-tab="devices"]` },
  { id: "network", tab: "send", selector: `${PANEL} .spt-gm-status` }
];

/** Waits until the test passes (an element rendered), at most a few seconds. */
async function until(test, ms = 3000) {
  const end = Date.now() + ms;
  while (!test() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
}

export function tourAvailable() {
  return !!foundry.nue?.Tour && !!game.tours;
}

/** Built on demand: texts follow the module language, the panel is opened on the right tab at each step. */
function buildTour() {
  class NetworkTour extends foundry.nue.Tour {
    async _preStep() {
      await super._preStep();
      const step = this.currentStep;
      const panel = PhonePanel.instance;
      if (!panel?.rendered) openPanel({ tab: step.tab });
      else if (panel._state.tab !== step.tab) await panel._setState({ tab: step.tab });
      await until(() => document.querySelector(step.selector));
    }
  }
  const panel = t("Gm.PanelTitle");
  return new NetworkTour(
    {
      title: t("Tour.Title"),
      description: t("Tour.Description"),
      restricted: true,
      display: true,
      canBeResumed: false,
      steps: STEPS.map((s) => ({ ...s, title: t(`Tour.${s.id}.title`, { panel }), content: `<div class="spt-tour">${t(`Tour.${s.id}.content`, { panel })}</div>` }))
    },
    { id: TOUR_ID, namespace: MODULE_ID }
  );
}

/** Registered (or replaced) in Foundry's tour list, so it can also be started from Tour Management. */
export function registerTour() {
  if (!game.user.isGM || !tourAvailable()) return null;
  const tour = buildTour();
  try {
    game.tours.register(MODULE_ID, TOUR_ID, tour);
  } catch (err) {
    console.warn(`${MODULE_ID} | tour`, err);
  }
  return tour;
}

export async function startTour() {
  const tour = registerTour();
  if (!tour) return;
  foundry.nue.Tour.activeTour?.exit?.();
  await tour.reset();
  tour.start();
}

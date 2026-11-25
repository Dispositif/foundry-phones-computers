import { feature } from "./features.js";
import { DialogV2, MODULE_ID, SOCKET } from "./constants.js";
import { DEFAULT_THEME, MODELS, directoryText, saveNpc, createPhone, newTheme, getPhoneData, markPhone, modelImg, phoneUsers, randomAddress, shownTheme, themeChoices } from "./devices.js";
import { modelAllowed, satellitePolicy } from "./universes.js";
import { deviceName } from "./names.js";
import { esc, isMailAddress, norm, shieldIcon } from "./util.js";
import { t } from "./i18n.js";
/* -------------------------------------------- */
/*  Dialogs (GM, and contacts for the player)    */
/* -------------------------------------------- */

export async function phoneFormDialog({ title, selectHtml = "", label = null, number = null, model = "smartphone", sceneId = null, theme = null, inbox = "on", pub = false, secure = false, satellite = false, withModel = true, holder = null, give = false }) {
  // Default name = a random brand and model, following the model as long as the GM has not changed it.
  const randomName = (m) => deviceName(m) ?? MODELS[m]?.label ?? MODELS.smartphone.label;
  const autoLabel = label === null;
  label ??= randomName(model);
  const autoNumber = number === null;
  number ??= randomAddress(model, { name: holder });
  // Satellite-only model (satellite phone): nothing to tick.
  const forcedSat = (m) => satellitePolicy(m) === "forced" || !!MODELS[m]?.satAlways;
  // Models of the universe (plus the device's own, kept even if the universe does not offer it).
  const modelOpts = Object.entries(MODELS)
    .filter(([k]) => k === model || (modelAllowed(k) && (k !== "jammer" || feature("jammer"))))
    .map(([k, m]) => `<option value="${k}" ${k === model ? "selected" : ""}>${m.label}</option>`)
    .join("");
  // Looks: every look offered for some model, tagged with the models it is offered for.
  const choices = Object.fromEntries(Object.keys(MODELS).map((m) => [m, themeChoices(m)]));
  const shown = shownTheme(theme ?? newTheme(model), model);
  // The device keeps its own look, even one the universe does not offer.
  if (!choices[model]?.includes(shown)) choices[model] = [shown, ...(choices[model] ?? [])];
  const themeOpts = [...new Set(Object.values(choices).flat())]
    .map((k) => {
      const models = Object.keys(choices).filter((m) => choices[m].includes(k));
      return `<option value="${k}" data-models="${models.join(" ")}" ${k === shown ? "selected" : ""}>${t(`Theme.${k}`)}</option>`;
    })
    .join("");
  const scenes = game.scenes.map((sc) => `<option value="${esc(sc.name)}">`).join("");
  // An installed device without a place keeps none; a device becoming installed defaults to the current scene.
  const sceneName = sceneId ? game.scenes.get(sceneId)?.name ?? "" : MODELS[model]?.fixed ? "" : canvas?.scene?.name ?? "";
  return DialogV2.wait({
    classes: ["spt-dialog"],
    window: { title, icon: "fas fa-mobile-screen" },
    position: { width: 400 },
    content: `<div class="spt-phone-form">
        ${withModel ? `<div class="form-group"><label>${t("Form.Model")}</label><select name="model">${modelOpts}</select></div>` : ""}
        <div class="spt-if-mobile">${selectHtml}</div>
        <div class="form-group spt-if-landline"><label>${t("Form.Place")}</label>
          <input type="text" name="scene" list="spt-scenes" value="${esc(sceneName)}" placeholder="${t("Form.NoPlace")}">
          <datalist id="spt-scenes">${scenes}</datalist><p class="hint">${t("Form.PlaceHint")}</p></div>
        <div class="form-group"><label>${t("Form.DeviceName")}</label><div class="form-fields">
          <input type="text" name="label" value="${esc(label)}" placeholder="${t("Form.DeviceNameHint")}">
          <button type="button" class="spt-dice" data-dice="label" title="${t("NewDev.OtherName")}"><i class="fas fa-dice"></i></button></div></div>
        <div class="form-group spt-if-number"><label>${t("Form.Number")}</label><div class="form-fields">
          <input type="text" name="number" value="${esc(number)}">
          <button type="button" class="spt-dice" data-dice="number" title="${t("NewDev.OtherNumber")}"><i class="fas fa-dice"></i></button></div><p class="hint">${t("Form.NumberHint")}</p></div>
        <div class="form-group spt-if-themes"><label>${t("Form.Theme")}</label><select name="theme">${themeOpts}</select></div>
        <div class="form-group spt-if-computer"><label>${t("Form.Inbox")}</label><select name="inbox">${["on", "locked", "none"].map((k) => `<option value="${k}" ${k === inbox ? "selected" : ""}>${t(`Form.Inbox_${k}`)}</option>`).join("")}</select></div>
        ${MODELS[model]?.jammer ? "" : publicRow(pub)}
        ${secureRow(secure)}
        ${satelliteRow(satellite)}
      </div>`,
    render: (event, x) => {
      // v13+: (event, dialog); an HTML element is accepted too.
      const root = x?.element ?? x;
      const select = root?.querySelector?.("[name=model]");
      const labelInput = root?.querySelector?.("[name=label]");
      let lastAuto = autoLabel ? labelInput?.value : null;
      select?.addEventListener("change", () => {
        if (!labelInput || lastAuto === null || labelInput.value !== lastAuto) return;
        labelInput.value = lastAuto = randomName(select.value);
      });
      root?.querySelector?.("[data-dice=label]")?.addEventListener("click", () => {
        labelInput.value = randomName(select?.value ?? model);
      });
      // Random number not edited yet: it follows the model (number or email address).
      const numberInput = root?.querySelector?.("[name=number]");
      let lastNumber = autoNumber ? numberInput?.value : null;
      select?.addEventListener("change", () => {
        if (!numberInput || lastNumber === null || numberInput.value !== lastNumber) return;
        if (!!MODELS[select.value]?.mail === isMailAddress(lastNumber)) return;
        numberInput.value = lastNumber = randomAddress(select.value, { name: holder });
      });
      root?.querySelector?.("[data-dice=number]")?.addEventListener("click", () => {
        numberInput.value = randomAddress(select?.value ?? model, { name: holder });
      });
      const sync = () => {
        const landline = !!MODELS[select?.value ?? model]?.fixed;
        root.querySelector(".spt-if-landline")?.classList.toggle("hidden", !landline);
        root.querySelector(".spt-if-mobile")?.classList.toggle("hidden", landline);
        root.querySelector(".spt-if-computer")?.classList.toggle("hidden", !MODELS[select?.value ?? model]?.mail);
        // A jammer has no number.
        root.querySelector(".spt-if-number")?.classList.toggle("hidden", !!MODELS[select?.value ?? model]?.jammer);
        root.querySelector(".spt-secure-row")?.classList.toggle("hidden", !!MODELS[select?.value ?? model]?.jammer);
        // Satellite: smartphone, pager and laptop (option), satellite phone (always); nothing to tick when the model is satellite-only.
        root.querySelector(".spt-satellite-row")?.classList.toggle("hidden", !MODELS[select?.value ?? model]?.satellite || forcedSat(select?.value ?? model));
        // Looks: only those that fit the chosen model.
        const m = select?.value ?? model;
        const themeSel = root.querySelector("[name=theme]");
        for (const o of themeSel?.options ?? []) {
          const ok = !o.dataset.models || o.dataset.models.split(" ").includes(m);
          o.hidden = o.disabled = !ok;
          if (!ok && o.selected) themeSel.value = newTheme(m);
        }
        // A single look: nothing to choose.
        root.querySelector(".spt-if-themes")?.classList.toggle("hidden", (choices[m]?.length ?? 0) < 2);
      };
      select?.addEventListener("change", sync);
      sync();
    },
    buttons: [
      {
        action: "ok",
        label: t("Ok"),
        icon: "fas fa-check",
        default: true,
        callback: (event, button) => {
          const f = button.form.elements;
          const model = f.model?.value;
          const sceneName = f.scene?.value?.trim();
          // Becoming a jammer, or no longer one: the hidden id and a real number do not mix.
          let number = f.number.value.trim();
          if (!!MODELS[model]?.jammer !== number.startsWith("jam-")) number = "";
          const scene = sceneName ? game.scenes.find((sc) => norm(sc.name) === norm(sceneName)) : null;
          return {
            target: f.target?.value,
            label: f.label.value.trim() || randomName(model),
            number: number || randomAddress(model, { name: holder }),
            model,
            sceneName,
            theme: f.theme?.value ?? DEFAULT_THEME,
            inbox: MODELS[model ?? "smartphone"]?.mail ? f.inbox?.value ?? "on" : undefined,
            pub: f.pub ? f.pub.checked : undefined,
            secure: f.secure ? f.secure.checked : undefined,
            satellite: forcedSat(model) ? true : f.satellite ? f.satellite.checked && !!MODELS[model]?.satellite : undefined,
            sceneId: MODELS[model]?.fixed ? scene?.id ?? null : undefined
          };
        }
      },
      // Edit device: "Give…" closes this form (unsaved changes dropped) and opens the Give window.
      ...(give ? [{ action: "give", label: `${t("Give.Give")}…`, icon: "fas fa-hand-holding-hand", callback: () => "give" }] : []),
      { action: "cancel", label: t("Cancel"), icon: "fas fa-xmark", callback: () => false }
    ],
    rejectClose: false
  });
}

/** "Public" option, in New device and Edit device: other PCs find the device by name. */
function publicRow(checked) {
  return `<div class="spt-public-row"><label class="spt-secure-check"><input type="checkbox" name="pub" ${checked ? "checked" : ""}> <i class="fas fa-globe"></i> ${t("Gm.NewDevicePublic")}</label></div>`;
}

/** "Secure (encrypted)" option, in New device and Edit device. */
function secureRow(checked) {
  if (!feature("secure")) return "";
  return `<div class="spt-secure-row"><label class="spt-secure-check"><input type="checkbox" name="secure" ${checked ? "checked" : ""}> ${shieldIcon()} ${t("Form.Secure")}</label><p class="hint">${t("Form.SecureHint")}</p></div>`;
}

/** "Satellite" option (advanced feature): Edit device, and New device where the universe makes it an option. */
function satelliteRow(checked) {
  if (!feature("satellite")) return "";
  return `<div class="spt-satellite-row"><label class="spt-secure-check"><input type="checkbox" name="satellite" ${checked ? "checked" : ""}> <i class="fas fa-satellite"></i> ${t("Form.Satellite")}</label><p class="hint">${t("Form.SatelliteHint")}</p></div>`;
}

export function playerActors() {
  return game.actors.filter((a) => game.users.some((u) => !u.isGM && a.testUserPermission(u, "OWNER")));
}

/**
 * "Holder" field: free input with suggestions (agents first, then NPCs).
 * Empty = nobody (world item). Avoids a long dropdown of NPCs.
 */
export function holderField(current = "") {
  const pcs = playerActors();
  const npcs = game.actors.filter((a) => !pcs.includes(a)).sort((a, b) => a.name.localeCompare(b.name));
  const opts = [...pcs, ...npcs].map((a) => `<option value="${esc(a.name)}">`).join("");
  return `<div class="form-group"><label>${t("Form.HeldBy")}</label>
      <input type="text" name="target" list="spt-holders" value="${esc(current)}" placeholder="${t("Form.Nobody")}">
      <datalist id="spt-holders">${opts}</datalist></div>
    <p class="hint">${t("Form.HeldByHint")}</p>`;
}

/** Finds the typed actor (null = nobody, undefined = not found). */
export function resolveHolder(name) {
  name = name?.trim();
  if (!name) return null;
  const n = norm(name);
  return game.actors.find((a) => norm(a.name) === n);
}

/* New device: step 1 picks the model on big tiles, step 2 is a short form for that model. */

/** Tiles: carried devices first, then installed ones. A landline look (modern, rotary) is its own tile. */
const NEW_KINDS = [
  { key: "smartphone", model: "smartphone", carried: true },
  { key: "mobile", model: "mobile", carried: true },
  { key: "brick", model: "brick", carried: true },
  { key: "satphone", model: "satphone", carried: true },
  { key: "pager", model: "pager", carried: true },
  { key: "computer", model: "computer", carried: true },
  { key: "jammer", model: "jammer", carried: true },
  { key: "landline", model: "landline", theme: "modern" },
  { key: "rotary", model: "landline", theme: "vintage", icon: "rotary" },
  { key: "desktop", model: "desktop" }
];
const kindLabel = (k) => (k.key === "landline" || k.key === "rotary" ? t(`NewDev.${k.key}`) : MODELS[k.model].label);
const kindCaps = (k) => t(`NewDev.Caps.${k.key}`);
const kindIcon = (k) => `modules/${MODULE_ID}/icons/${k.icon ?? k.model}.svg`;

/** Carried models of the world's universe, as the new-device tiles show them (GM panel quick creation). */
export function quickKinds() {
  return NEW_KINDS.filter((k) => k.carried && !MODELS[k.model].jammer && modelAllowed(k.model)).map((k) => ({
    key: k.key,
    model: k.model,
    img: kindIcon(k),
    label: kindLabel(k),
    caps: kindCaps(k)
  }));
}

/** Step 1: resolves with the chosen kind, or null. */
async function pickKind() {
  const tile = (k) => `<button type="button" class="spt-kind" data-kind="${k.key}">
      <img src="${kindIcon(k)}" alt="">
      <b>${esc(kindLabel(k))}</b><small>${kindCaps(k)}</small></button>`;
  // Only the models (and landline looks) of the world's universe.
  const kinds = NEW_KINDS.filter((k) => modelAllowed(k.model) && (!k.theme || themeChoices(k.model).includes(k.theme)) && (k.model !== "jammer" || feature("jammer")));
  let picked = null;
  // DialogV2.wait wires the render callback (a plain constructor ignores it); a tile click closes it.
  await DialogV2.wait({
    window: { title: `${t("NewDevice")} · 1/2`, icon: "fas fa-plus" },
    classes: ["spt-dialog", "spt-new-device"],
    position: { width: 500 },
    content: `<div class="spt-kinds">
        <h4>${t("NewDev.Carried")}</h4><div class="spt-kind-grid">${kinds.filter((k) => k.carried).map(tile).join("")}</div>
        <h4>${t("NewDev.Installed")}</h4><div class="spt-kind-grid three">${kinds.filter((k) => !k.carried).map(tile).join("")}</div>
      </div>`,
    buttons: [{ action: "cancel", label: t("Cancel"), icon: "fas fa-xmark", callback: () => false }],
    render: (event, x) => {
      const dialog = x?.element ? x : event?.target;
      const root = dialog?.element ?? x;
      root?.querySelectorAll?.("[data-kind]").forEach((b) =>
        b.addEventListener("click", (ev) => {
          ev.preventDefault();
          picked = NEW_KINDS.find((k) => k.key === b.dataset.kind);
          dialog?.close();
        })
      );
    },
    rejectClose: false
  });
  return picked;
}

/** Step 2: short form for the chosen kind. Resolves with { ...data, open } or "back" or false. */
function kindForm(kind, { actor = null } = {}) {
  const model = MODELS[kind.model];
  const fixed = !!model.fixed;
  const pcs = playerActors();
  const npcs = game.actors.filter((a) => !pcs.includes(a)).sort((a, b) => a.name.localeCompare(b.name));
  const first = (actor && pcs.includes(actor) ? actor : pcs[0]) ?? null;
  // Satellite: forced by the universe, or a box to tick where it is an option.
  const satPolicy = satellitePolicy(kind.model);
  // Name: a random brand and model of the universe ("Motorola R33"), a satellite one if satellite.
  const randomName = (satellite = satPolicy === "forced") => deviceName(kind.model, { satellite }) ?? kindLabel(kind);
  const chip = (value, inner, checked = false) => `<label class="spt-chip"><input type="radio" name="holder" value="${value}" ${checked ? "checked" : ""}>${inner}</label>`;
  const holderRow = fixed
    ? `<div class="form-group"><label>${t("Form.Place")}</label><select name="scene">${game.scenes
        .map((sc) => `<option value="${sc.id}" ${sc.id === canvas?.scene?.id ? "selected" : ""}>${esc(sc.name)}</option>`)
        .join("")}<option value="">${t("Form.NoPlace")}</option></select></div>
      <p class="hint">${t("Form.NoPlaceHint")}</p>`
    : `<div class="spt-row"><label>${t("Form.HeldBy")}</label><div class="spt-chips">
        ${pcs.map((a) => chip(a.id, `<img src="${esc(a.img)}" alt="">${esc(a.name)}`, a === first)).join("")}
        ${chip("npc", `<i class="fas fa-user"></i> ${t("NewDev.Npc")}`)}
        ${chip("", `<i class="fas fa-ban"></i> ${t("NewDev.Nobody")}`, !first)}
      </div>
      <div class="spt-npc hidden"><input type="text" name="npc" list="spt-npcs" placeholder="${t("NewDev.NpcName")}"><datalist id="spt-npcs">${npcs
        .map((a) => `<option value="${esc(a.name)}">`)
        .join("")}</datalist>${model.jammer ? "" : `<p class="hint">${t("NewDev.NpcHint")}</p>
        <button type="button" class="spt-to-directory"><i class="fas fa-address-book"></i> ${t("NewDev.ToDirectory")}</button>`}</div></div>`;
  // Looks: only when the model has a choice (a landline's look is its tile). The first one is the default.
  const looks = kind.theme ? [] : themeChoices(kind.model);
  const lookRow =
    looks.length > 1
      ? `<div class="spt-row"><label>${t("Form.Theme")}</label><div class="spt-chips">${looks
          .map((k, i) => `<label class="spt-chip plain"><input type="radio" name="theme" value="${k}" ${i === 0 ? "checked" : ""}>${t(`Theme.${k}`)}</label>`)
          .join("")}</div></div>`
      : "";
  const read = (form, open) => {
    const f = form.elements;
    const holder = f.holder?.value ?? "";
    let actor = null;
    if (!fixed && holder === "npc") actor = resolveHolder(f.npc.value) ?? undefined;
    else if (!fixed && holder) actor = game.actors.get(holder) ?? null;
    return {
      actor,
      npcName: f.npc?.value ?? "",
      label: f.label.value.trim() || randomName(),
      number: model.jammer ? randomAddress(kind.model) : f.number.value.trim() || randomAddress(kind.model, { name: actor?.name }),
      model: kind.model,
      theme: kind.theme ?? f.theme?.value ?? DEFAULT_THEME,
      sceneId: fixed ? f.scene?.value || null : undefined,
      pub: !!f.pub?.checked,
      secure: !!f.secure?.checked,
      satellite: satPolicy === "forced" || (satPolicy === "option" && !!f.satellite?.checked),
      open
    };
  };
  return DialogV2.wait({
    window: { title: `${t("NewDevice")} · 2/2`, icon: "fas fa-plus" },
    classes: ["spt-dialog", "spt-new-device"],
    position: { width: 500 },
    content: `<div class="spt-phone-form">
        <div class="spt-chosen"><img src="${kindIcon(kind)}" alt="">
          <div><b>${esc(kindLabel(kind))}</b><small>${kindCaps(kind)}</small></div></div>
        ${holderRow}
        <div class="form-group"><label>${t("Form.DeviceName")}</label><div class="form-fields">
          <input type="text" name="label" value="${esc(randomName())}">
          <button type="button" class="spt-dice" data-dice="label" title="${t("NewDev.OtherName")}"><i class="fas fa-dice"></i></button></div></div>
        <div class="form-group ${model.jammer ? "hidden" : ""}"><label>${t("Form.Number")}</label><div class="form-fields">
          <input type="text" name="number" value="${esc(randomAddress(kind.model, { name: fixed ? null : first?.name }))}">
          <button type="button" class="spt-dice" data-dice="number" title="${t("NewDev.OtherNumber")}"><i class="fas fa-dice"></i></button></div><p class="hint">${t("Form.NumberHint")}</p></div>
        ${model.jammer ? `<p class="hint">${t("Jammer.NewHint")}</p>` : ""}
        ${lookRow}
        ${model.jammer ? "" : publicRow(false)}
        ${model.jammer ? "" : secureRow(false)}
        ${satPolicy === "option" ? satelliteRow(false) : ""}
      </div>`,
    render: (event, x) => {
      const root = x?.element ?? x;
      const numberInput = root?.querySelector?.("[name=number]");
      let lastAuto = numberInput?.value;
      const holderName = () => {
        if (fixed) return null;
        const v = root.querySelector("[name=holder]:checked")?.value ?? "";
        const actor = v === "npc" ? resolveHolder(root.querySelector("[name=npc]")?.value) : game.actors.get(v);
        return actor?.name ?? null;
      };
      // An email address is made from the holder's name: it follows the holder until the GM types one.
      const follow = () => {
        if (!model.mail || !numberInput || numberInput.value !== lastAuto) return;
        numberInput.value = lastAuto = randomAddress(kind.model, { name: holderName() });
      };
      root?.querySelectorAll?.("[name=holder]").forEach((r) =>
        r.addEventListener("change", () => {
          root.querySelector(".spt-npc")?.classList.toggle("hidden", r.value !== "npc" || !r.checked);
          follow();
        })
      );
      root?.querySelector?.("[name=npc]")?.addEventListener("change", follow);
      // An NPC only needs a directory line to call or text: saved there, no device created.
      root?.querySelector?.(".spt-to-directory")?.addEventListener("click", async () => {
        const name = root.querySelector("[name=npc]")?.value.trim() ?? "";
        const number = numberInput?.value.trim() ?? "";
        if (!(await saveNpc({ name, number }))) return;
        ui.notifications.info(t("NewDev.AddedToDirectory", { name: name || number }));
        (x?.element ? x : event?.target)?.close();
      });
      root?.querySelector?.("[data-dice=number]")?.addEventListener("click", () => {
        numberInput.value = lastAuto = randomAddress(kind.model, { name: holderName() });
      });
      const satBox = root?.querySelector?.("[name=satellite]");
      const labelInput = root?.querySelector?.("[name=label]");
      let lastLabel = labelInput?.value;
      root?.querySelector?.("[data-dice=label]")?.addEventListener("click", () => {
        labelInput.value = lastLabel = randomName(satBox ? satBox.checked : undefined);
      });
      // Satellite ticked: a satellite name, as long as the GM has not typed one.
      satBox?.addEventListener("change", () => {
        if (labelInput && labelInput.value === lastLabel) labelInput.value = lastLabel = randomName(satBox.checked);
      });
    },
    buttons: [
      { action: "back", label: t("NewDev.Change"), icon: "fas fa-arrow-left", callback: () => "back" },
      { action: "create", label: t("NewDev.Create"), icon: "fas fa-check", callback: (event, button) => read(button.form, false) },
      { action: "open", label: t("NewDev.CreateOpen"), icon: `fas ${model.icon}`, default: true, callback: (event, button) => read(button.form, true) }
    ],
    rejectClose: false
  });
}

/** GM: new device in two steps. Resolves with { item, open } or nothing. */
export async function newPhoneDialog({ actor = null, kind: preset = null } = {}) {
  for (;;) {
    // A preset model (GM panel quick creation, "More options…") skips step 1 the first time.
    const kind = preset ? NEW_KINDS.find((k) => k.key === preset) : await pickKind();
    preset = null;
    if (!kind) return;
    const res = await kindForm(kind, { actor });
    if (res === "back") continue;
    if (!res || typeof res !== "object") return;
    if (res.actor === undefined) return ui.notifications.warn(t("Warn.ActorNotFound", { name: res.npcName }));
    if (MODELS[res.model]?.fixed) {
      // No scene: a device reached over the network only (shared from the Items sidebar).
      const item = await createPhone(null, res);
      ui.notifications.info(`📍 ${t("Info.Installed", { model: kindLabel(kind), label: res.label })}`);
      return { item, open: res.open };
    }
    const item = await createPhone(res.actor, res);
    ui.notifications.info(`📱 ${t("Info.Created", { label: res.label, number: MODELS[res.model]?.jammer ? "—" : res.number })}`);
    return { item, open: res.open };
  }
}

/** Gives the device to another holder (or back to world items), history included. */
export async function transferPhone(item, actor) {
  if ((item.parent ?? null) === (actor ?? null)) return item;
  const data = item.toObject();
  delete data._id;
  // A jammer changes hands switched off.
  const ph = data.flags?.[MODULE_ID]?.phone;
  if (ph?.jamming) ph.jamming = false;
  const created = await Item.create(data, actor ? { parent: actor, spt: true } : { spt: true });
  await item.delete();
  return created;
}

export async function giveDialog(item) {
  const phone = getPhoneData(item);
  const res = await DialogV2.wait({
    classes: ["spt-dialog"],
    window: { title: t("Give.Title", { label: phone.label, number: MODELS[phone.model]?.jammer ? "—" : phone.number }), icon: "fas fa-hand-holding-hand" },
    position: { width: 380 },
    content: `<div class="spt-phone-form">${holderField()}</div>`,
    buttons: [
      { action: "ok", label: t("Give.Give"), icon: "fas fa-check", default: true, callback: (event, button) => button.form.elements.target.value },
      { action: "cancel", label: t("Cancel"), icon: "fas fa-xmark", callback: () => false }
    ],
    rejectClose: false
  });
  if (res === false || res == null) return; // Cancel (DialogV2 turns a null callback result into the action name)
  const actor = resolveHolder(res);
  if (actor === undefined) return ui.notifications.warn(t("Warn.ActorNotFound", { name: res }));
  const created = await transferPhone(item, actor);
  ui.notifications.info(`📱 ${actor ? t("Give.NowHeld", { label: phone.label, name: actor.name }) : t("Give.NowWorld", { label: phone.label })}`);
  // The connected players of that character get a window (Foundry's notifications are too discreet).
  const to = actor ? phoneUsers(actor, { activeOnly: true }).map((u) => u.id) : [];
  if (created && to.length) game.socket.emit(SOCKET, { type: "deviceGiven", targetUserIds: to, itemUuid: created.uuid, name: actor.name });
}

/** Player: the GM just gave one of their characters a device (name only: a locked device keeps its number hidden). "Open" opens it. */
export async function receiveDeviceGiven({ itemUuid, name }) {
  // The message can arrive before the new item reaches this client: a few short retries.
  let phone = null;
  for (let i = 0; i < 10 && !phone; i++) {
    phone = getPhoneData(fromUuidSync(itemUuid));
    if (!phone) await new Promise((r) => setTimeout(r, 200));
  }
  if (!phone) return;
  DialogV2.wait({
    classes: ["spt-dialog", "spt-given"],
    window: { title: t("Given.Title"), icon: "fas fa-hand-holding-hand" },
    position: { width: 360 },
    content: `<div class="spt-given-body"><img src="${modelImg(phone.model)}" alt=""><p>${t("Given.Body", { name: esc(name ?? ""), label: `<strong>${esc(phone.label)}</strong>` })}</p></div>`,
    buttons: [
      { action: "open", label: t("Given.Open"), icon: "fas fa-mobile-screen", default: true },
      { action: "later", label: t("Given.Later"), icon: "fas fa-clock" }
    ],
    rejectClose: false
  }).then(async (res) => {
    // main.js imports this file: loaded on demand.
    if (res === "open") (await import("./main.js")).openPhone(itemUuid);
  });
}

export async function editPhoneDialog(item) {
  const phone = getPhoneData(item);
  const res = await phoneFormDialog({
    title: `${t("EditDevice")} — ${item.name}`,
    label: phone.label,
    number: phone.number,
    model: phone.model ?? "smartphone",
    sceneId: phone.sceneId,
    theme: phone.theme ?? null,
    inbox: phone.inbox ?? "on",
    pub: !!phone.pub,
    secure: !!phone.secure,
    satellite: !!phone.satellite,
    holder: item.parent?.name ?? null,
    give: !MODELS[phone.model ?? "smartphone"]?.fixed
  });
  if (res === "give") return giveDialog(item);
  if (!res) return;
  // An empty place is allowed (network access only); a name that matches no scene is not.
  if (MODELS[res.model]?.fixed && !res.sceneId && res.sceneName) return ui.notifications.warn(t("Warn.SceneNotFound", { name: res.sceneName }));
  await markPhone(item, res);
}

/** Contacts: one per line, "Name | number" (number optional). */
export async function contactsDialog(item) {
  const phone = getPhoneData(item);
  const text = (phone.contacts ?? []).map((c) => (c.number ? `${c.name} | ${c.number}` : c.name)).join("\n");
  const res = await DialogV2.wait({
    window: { title: `${t("Contacts.Title")} — ${item.parent?.name ?? ""} (${phone.label})`, icon: "fas fa-address-book", resizable: true },
    classes: ["spt-dialog", "spt-text-dialog"],
    position: { width: 480, height: 420 },
    content: `<div class="spt-phone-form">
        <p class="hint">${t("Contacts.Hint")}</p>
        <textarea name="contacts" rows="8" placeholder="${t("Contacts.Placeholder")}">${esc(text)}</textarea>
      </div>`,
    buttons: [
      { action: "ok", label: t("Save"), icon: "fas fa-check", default: true, callback: (event, button) => button.form.elements.contacts.value },
      { action: "cancel", label: t("Cancel"), icon: "fas fa-xmark", callback: () => false }
    ],
    rejectClose: false
  });
  if (res === false || res == null) return; // Cancel (DialogV2 turns a null callback result into the action name)
  const contacts = res
    .split("\n")
    .map((l) => l.split("|").map((s) => s.trim()))
    .filter(([name]) => name)
    .map(([name, number]) => ({ name, number: number || "" }));
  await item.update({ [`flags.${MODULE_ID}.phone.contacts`]: contacts });
}


/** Names a correspondent: adds a contact with this number (or address). */
export async function addContactDialog(item, key, name = "") {
  const chosen = await DialogV2.prompt({
    classes: ["spt-dialog"],
    window: { title: t("Contacts.Add"), icon: "fas fa-user-plus" },
    position: { width: 340 },
    content: `<div class="spt-phone-form">
        <label>${t("Contacts.Name")} <input type="text" name="name" value="${esc(name)}" autofocus></label>
        <p class="hint">${esc(key)}</p>
      </div>`,
    ok: { label: t("Save"), icon: "fas fa-check", callback: (event, button) => button.form.elements.name.value.trim() },
    rejectClose: false
  });
  if (!chosen) return;
  const phone = getPhoneData(item);
  const contacts = [...(phone.contacts ?? []), { name: chosen, number: key }];
  await item.update({ [`flags.${MODULE_ID}.phone.contacts`]: contacts });
}

/** GM: the NPC directory, edited as text like contacts. */
export async function directoryDialog() {
  const res = await DialogV2.wait({
    window: { title: `${t("Directory.Title")} · ${t("Directory.EditText")}`, icon: "fas fa-file-import", resizable: true },
    classes: ["spt-dialog", "spt-text-dialog"],
    position: { width: 640, height: 560 },
    content: `<div class="spt-phone-form">
        <p class="spt-dir-purpose">${t("Directory.Purpose")}</p>
        <p class="hint">${t("Directory.Hint")}</p>
        <textarea name="directory" rows="16" placeholder="${t("Directory.Placeholder")}">${esc(directoryText())}</textarea>
      </div>`,
    buttons: [
      { action: "ok", label: t("Save"), icon: "fas fa-check", default: true, callback: (event, button) => button.form.elements.directory.value },
      { action: "cancel", label: t("Cancel"), icon: "fas fa-xmark", callback: () => false }
    ],
    rejectClose: false
  });
  if (res === false || res == null) return; // Cancel (DialogV2 turns a null callback result into the action name)
  await game.settings.set(MODULE_ID, "directory", res.trim());
}

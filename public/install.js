/* Mamaschine install helper: one friendly path to the home screen for every phone. */
(() => {
  "use strict";
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  const ua = navigator.userAgent || "";
  const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|Pinterest|GSA\/|; wv\)/i.test(ua);
  const isSamsung = /SamsungBrowser/i.test(ua);
  const isFirefox = /Firefox|FxiOS/i.test(ua);

  const get = (k, d) => { try { const v = localStorage.getItem("mamaschine." + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem("mamaschine." + k, JSON.stringify(v)); } catch {} };

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; refreshLinks(); });
  window.addEventListener("appinstalled", () => { set("installed", true); deferred = null; close(); refreshLinks(); });

  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="vertical-align:-4px"><path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const DOTS = '<b style="font-size:20px;line-height:0">⋮</b>';

  function content() {
    if (inApp) {
      return {
        title: "Erst raus aus der App",
        text: "Du bist gerade im Browser von Instagram, WhatsApp & Co. Von hier aus kann Mamaschine nicht aufs Handy.",
        steps: isIOS
          ? ["Tippe auf die drei Punkte oder „…“ oben oder unten", "Wähle „In Safari öffnen“", "Dort nochmal auf „Aufs Handy holen“"]
          : ["Tippe oben rechts auf " + DOTS, "Wähle „Im Browser öffnen“ oder „In Chrome öffnen“", "Dort nochmal auf „Aufs Handy holen“"],
        copy: true,
      };
    }
    if (deferred) return { title: "Mamaschine aufs Handy", text: "Ein Tipp, und die Maschine wohnt auf deinem Homescreen. Startet wie eine App und funktioniert auch im Keller mit schlechtem Empfang.", native: true };
    if (isIOS) {
      return {
        title: "Mamaschine aufs iPhone",
        text: "Dauert zehn Sekunden. Danach startet Mamaschine wie eine App, auch im Keller mit schlechtem Empfang.",
        steps: ["Tippe unten (bei Chrome oben) auf Teilen " + SHARE_ICON, "Scrolle runter und wähle „Zum Home-Bildschirm“", "Oben rechts auf „Hinzufügen“. Fertig."],
      };
    }
    if (isSamsung) {
      return { title: "Mamaschine aufs Handy", text: "So landet Mamaschine auf deinem Homescreen:", steps: ["Tippe unten auf das Menü ☰", "Wähle „Seite hinzufügen zu“", "Dann „Startbildschirm“"] };
    }
    if (isFirefox) {
      return { title: "Mamaschine aufs Handy", text: "So landet Mamaschine auf deinem Homescreen:", steps: ["Tippe auf " + DOTS + " (Menü)", "Wähle „Installieren“ oder „Zum Startbildschirm hinzufügen“"] };
    }
    if (isAndroid) {
      return { title: "Mamaschine aufs Handy", text: "So landet Mamaschine auf deinem Homescreen:", steps: ["Tippe oben rechts auf " + DOTS, "Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“"] };
    }
    return { title: "Mamaschine aufs Handy", text: "Am einfachsten öffnest du mamaschine.net direkt am Handy. Am Computer kannst du sie über das Installations-Symbol in der Adressleiste als App speichern.", copy: true };
  }

  let sheet;
  function build() {
    sheet = document.createElement("div");
    sheet.className = "isheet";
    sheet.hidden = true;
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "isheetTitle");
    document.body.append(sheet);
    sheet.addEventListener("click", (e) => { if (e.target === sheet) later(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) later(); });
  }
  function open() {
    if (isStandalone()) return;
    if (!sheet) build();
    const c = content();
    sheet.innerHTML = `<div class="isheet-card">
      <div class="isheet-head"><img src="/icons/icon-192.png" alt="" width="56" height="56"><div><h2 id="isheetTitle">${c.title}</h2><p>${c.text}</p></div></div>
      ${c.steps ? `<ol class="isheet-steps">${c.steps.map((s) => `<li><span>${s}</span></li>`).join("")}</ol>` : ""}
      <div class="isheet-actions">
        ${c.native ? `<button type="button" class="btn btn-yellow" data-a="install">Aufs Handy holen</button>` : ""}
        ${c.copy ? `<button type="button" class="btn btn-yellow" data-a="copy">Link kopieren</button>` : ""}
        <button type="button" class="text-link" data-a="later">${c.native || c.copy ? "Später" : "Alles klar"}</button>
      </div>
    </div>`;
    sheet.hidden = false;
    document.documentElement.classList.add("isheet-open");
    sheet.querySelector("[data-a=install]")?.addEventListener("click", install);
    sheet.querySelector("[data-a=later]").addEventListener("click", later);
    sheet.querySelector("[data-a=copy]")?.addEventListener("click", async (e) => {
      try { await navigator.clipboard.writeText("https://mamaschine.net"); e.target.textContent = "Kopiert!"; }
      catch { e.target.textContent = "mamaschine.net"; }
    });
    sheet.querySelector(".btn, .text-link")?.focus();
  }
  function close() {
    if (!sheet) return;
    sheet.hidden = true;
    document.documentElement.classList.remove("isheet-open");
  }
  function later() { set("installSnooze", Date.now()); close(); }
  async function install() {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice.catch(() => ({}));
    deferred = null;
    if (outcome === "accepted") set("installed", true); else set("installSnooze", Date.now());
    close(); refreshLinks();
  }

  /* When to ask: after a real "aha" moment, or on a returning visit. Never twice within 5 days. */
  const SNOOZE = 5 * 24 * 3600 * 1000;
  function canNag() {
    if (isStandalone() || get("installed", false)) return false;
    return Date.now() - get("installSnooze", 0) > SNOOZE;
  }
  function maybePrompt() {
    if (!canNag()) return;
    setTimeout(() => { if (canNag()) open(); }, 1500);
  }
  const visits = get("visits", 0) + 1; set("visits", visits);
  if (visits >= 2) setTimeout(maybePrompt, 15000);

  /* Permanent entry points: any element with data-install opens the sheet. */
  function refreshLinks() {
    document.querySelectorAll("[data-install]").forEach((el) => { el.hidden = isStandalone(); });
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-install]");
    if (!t) return;
    e.preventDefault();
    if (deferred) install(); else open();
  });
  document.addEventListener("DOMContentLoaded", refreshLinks);
  refreshLinks();

  window.mmInstall = { maybePrompt, open };
})();

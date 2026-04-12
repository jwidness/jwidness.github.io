// ==UserScript==
// @name         iNaturalist — merged taxon flags
// @namespace    https://www.inaturalist.org/
// @version      1.6.4
// @description  On the flags page: merged taxon flags, or switch back to the standard iNat flags UI.
// @match        https://www.inaturalist.org/flags*
// @match        https://*.inaturalist.org/flags*
// @match        https://inaturalist.ca/flags*
// @match        https://inaturalist.ala.org.au/flags*
// @match        https://www.inaturalist.ala.org.au/flags*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      www.inaturalist.org
// @connect      inaturalist.org
// @connect      api.inaturalist.org
// @connect      inaturalist.ala.org.au
// ==/UserScript==

(function () {
  "use strict";

  const STORAGE_KEY = "inat_merged_flags_taxon_ids";
  /** JSON map: id string -> { name, common } from autocomplete or /v1/taxa */
  const TAXON_NAMES_KEY = "inat_merged_flags_taxon_names";
  const MODE_KEY = "inat_flags_ui_mode";

  /** Bumped on each taxon chip sync so stale name-hydrate runs exit before rendering. */
  let taxonHydrateGen = 0;

  function safeGMSet(key, value) {
    try {
      GM_setValue(key, value);
    } catch (e) {
      /* Storage can throw (quota, disabled); chips UI must still update. */
    }
  }

  /** Taxon curation flags are category "other"; server still needs flags[] set. */
  const TAXON_FLAG_TYPES = ["other"];

  /** Same endpoint as `jquery/plugins/inat/user_autocomplete.js.erb` on the real flags form. */
  const USER_AUTOCOMPLETE_API = "https://api.inaturalist.org/v1/users/autocomplete";

  /** Same path as the site (see `user_autocomplete.js.erb`); `thumb.png` on www works reliably. */
  const DEFAULT_USER_ICON =
    "https://www.inaturalist.org/attachment_defaults/users/icons/defaults/thumb.png";

  /**
   * @param {{ icon?: string, icon_url?: string }} u User object from the users autocomplete API
   */
  function userIconUrl(u) {
    const raw = u.icon || u.icon_url;
    if (!raw) {
      return DEFAULT_USER_ICON;
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    if (raw.charAt(0) === "/") {
      return "https://www.inaturalist.org" + raw;
    }
    return raw;
  }

  /**
   * @param {HTMLInputElement} textInput
   * @param {HTMLInputElement} hiddenInput
   * @param {{ onFocus?: () => void }} [opts]
   */
  function attachUserAutocomplete(textInput, hiddenInput, opts) {
    opts = opts || {};
    const wrap = textInput.closest(".inat-user-ac-wrap");
    if (!wrap || !hiddenInput) {
      return;
    }

    let menu = null;
    let debounceTimer = null;
    let activeIndex = -1;
    /** @type {Array<{id:number,login:string,icon?:string}>} */
    let lastResults = [];

    function closeMenu() {
      if (menu && menu.parentNode) {
        menu.remove();
      }
      menu = null;
      activeIndex = -1;
      lastResults = [];
    }

    function selectUser(user) {
      textInput.value = user.login;
      hiddenInput.value = String(user.id);
      closeMenu();
    }

    function updateActive(items) {
      items.forEach((el, i) => {
        el.classList.toggle("inat-active", i === activeIndex);
        if (i === activeIndex) {
          el.scrollIntoView({ block: "nearest" });
        }
      });
    }

    textInput.addEventListener("focus", () => {
      if (typeof opts.onFocus === "function") {
        opts.onFocus();
      }
    });

    textInput.addEventListener("input", () => {
      hiddenInput.value = "";
      clearTimeout(debounceTimer);
      const q = textInput.value.trim();
      if (!q) {
        closeMenu();
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const url =
            USER_AUTOCOMPLETE_API +
            "?q=" +
            encodeURIComponent(q) +
            "&per_page=10&order=activity&include_suspended=true";
          const res = await fetch(url, { credentials: "omit" });
          if (!res.ok) {
            throw new Error("HTTP " + res.status);
          }
          const data = await res.json();
          const results = data.results || [];
          closeMenu();
          if (!results.length) {
            return;
          }
          lastResults = results;
          menu = document.createElement("ul");
          menu.className = "inat-user-ac-menu list-unstyled";
          menu.setAttribute("role", "listbox");
          results.forEach((u, i) => {
            const li = document.createElement("li");
            li.className = "inat-user-ac-item";
            li.setAttribute("role", "option");
            const img = document.createElement("img");
            img.className = "usericon";
            img.width = 24;
            img.height = 24;
            img.alt = "";
            img.src = userIconUrl(u);
            img.addEventListener("error", function onErr() {
              img.removeEventListener("error", onErr);
              img.src = DEFAULT_USER_ICON;
            });
            const span = document.createElement("span");
            span.textContent = u.login;
            li.appendChild(img);
            li.appendChild(span);
            li.addEventListener("mousedown", (e) => {
              e.preventDefault();
              selectUser(u);
            });
            menu.appendChild(li);
          });
          wrap.appendChild(menu);
          activeIndex = -1;
        } catch (e) {
          closeMenu();
        }
      }, 300);
    });

    textInput.addEventListener("keydown", (e) => {
      if (!menu) {
        return;
      }
      const items = menu.querySelectorAll(".inat-user-ac-item");
      const n = items.length;
      if (!n) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = activeIndex < n - 1 ? activeIndex + 1 : 0;
        updateActive(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = activeIndex > 0 ? activeIndex - 1 : n - 1;
        updateActive(items);
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && lastResults[activeIndex]) {
          e.preventDefault();
          selectUser(lastResults[activeIndex]);
        }
      } else if (e.key === "Escape") {
        closeMenu();
      }
    });

    document.addEventListener("click", (e) => {
      if (wrap.contains(e.target)) {
        return;
      }
      closeMenu();
    });
  }

  GM_addStyle(`
    #inat-merge-panel {
      margin: 1rem 0 1.5rem;
      padding: 1rem 1.25rem;
      background: #f8f9fa;
      border: 1px solid #dee2e6;
      border-radius: 6px;
      font-size: 14px;
    }
    #inat-merge-panel h3 {
      margin: 0 0 0.75rem;
      font-size: 1.1rem;
    }
    #inat-merge-panel textarea#inat-merge-taxa {
      display: none !important;
    }
    .inat-merge-taxa-chips-field {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      min-height: 38px;
      padding: 4px 8px;
      width: 100%;
      max-width: 100%;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-sizing: border-box;
    }
    .inat-merge-taxa-chips-field:focus-within {
      border-color: #66afe9;
      outline: 0;
      box-shadow: inset 0 1px 1px rgba(0,0,0,.075), 0 0 8px rgba(102, 175, 233, 0.35);
    }
    #inat-merge-taxa-chips {
      display: contents;
    }
    .inat-merge-taxon-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      max-width: 100%;
      padding: 2px 4px 2px 10px;
      font-size: 13px;
      line-height: 1.35;
      background: #e8f0fe;
      border: 1px solid #c6dafc;
      border-radius: 14px;
      color: #174ea6;
    }
    .inat-merge-taxon-chip-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 280px;
    }
    .inat-merge-taxon-chip.inat-merge-taxon-chip-pending {
      font-style: italic;
      color: #555;
      background: #f5f5f5;
      border-color: #ddd;
    }
    .inat-merge-taxon-chip-remove {
      flex-shrink: 0;
      margin: 0;
      padding: 0 6px 0 2px;
      border: none;
      background: transparent;
      color: #666;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      border-radius: 50%;
    }
    .inat-merge-taxon-chip-remove:hover {
      color: #c00;
      background: rgba(0,0,0,0.06);
    }
    .inat-merge-taxon-combo-input {
      flex: 1 1 140px;
      min-width: 120px;
      border: none !important;
      box-shadow: none !important;
      outline: none !important;
      padding: 4px 2px;
      margin: 0;
      font-size: 14px;
      background: transparent;
    }
    #inat-merge-panel .inat-merge-row {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
      align-items: flex-end;
      margin-top: 0.75rem;
    }
    #inat-merge-panel label { display: block; margin-bottom: 0.25rem; font-weight: 600; }
    #inat-merge-filters-row {
      margin-top: 0.75rem;
    }
    #inat-merge-panel #inat-merge-filters-row .flagger-type {
      margin-bottom: 0.5rem;
    }
    #inat-merge-panel #inat-merge-filters-row .flagger-type .radio {
      margin-top: 0;
      margin-bottom: 6px;
    }
    #inat-merge-panel #inat-merge-filters-row .flagger-type .radio:last-of-type {
      margin-bottom: 0;
    }
    #inat-merge-panel #inat-merge-filters-row .flagger-type .radio label {
      font-weight: normal;
      padding-left: 20px;
    }
    #inat-merge-actions-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
      margin-top: 0.75rem;
    }
    #inat-merge-actions-row .btn {
      vertical-align: middle;
    }
    #inat-merge-actions-row #inat-merge-status {
      margin-top: 0 !important;
      line-height: 34px;
    }
    #inat-merge-panel #inat-merge-filters-row .form-group {
      margin-bottom: 0;
    }
    #inat-merge-panel table.inat-merge-table { margin-top: 1rem; background: #fff; }
    #inat-merge-status,
    #inat-merge-status-bottom { margin-top: 0.75rem; color: #555; font-size: 13px; }
    #inat-merge-table-footer {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      align-items: center;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid #ddd;
    }
    #inat-merge-table-footer #inat-merge-status-bottom {
      margin-top: 0;
    }
    #inat-merge-mode-toggle {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #dee2e6;
    }
    #inat-merge-mode-toggle .btn-group .btn.inat-active {
      background: #337ab7;
      color: #fff;
      border-color: #2e6da4;
    }
    body.inat-merge-official-hidden #controls,
    body.inat-merge-official-hidden .container table.table:not(.inat-merge-table),
    body.inat-merge-official-hidden .container .pagination,
    body.inat-merge-official-hidden .container ul.pagination {
      display: none !important;
    }
    #inat-merge-standard-hint {
      margin: 0;
      font-size: 13px;
      color: #555;
    }
    body:not(.inat-merge-official-hidden) #inat-merge-merged-ui {
      display: none !important;
    }
    body.inat-merge-official-hidden #inat-merge-standard-hint {
      display: none !important;
    }
    .inat-user-ac-wrap {
      position: relative;
    }
    .inat-user-ac-menu {
      position: absolute;
      left: 0;
      right: 0;
      top: 100%;
      z-index: 2000;
      margin: 2px 0 0;
      padding: 0;
      list-style: none;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      max-height: 240px;
      overflow-y: auto;
    }
    .inat-user-ac-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-weight: normal;
    }
    .inat-user-ac-item:hover,
    .inat-user-ac-item.inat-active {
      background: #f5f5f5;
    }
    .inat-user-ac-item img.usericon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .inat-taxon-ac-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 10px;
      cursor: pointer;
      font-weight: normal;
    }
    .inat-taxon-ac-item:hover,
    .inat-taxon-ac-item.inat-active {
      background: #f5f5f5;
    }
    .inat-taxon-ac-thumb {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .inat-taxon-ac-text {
      flex: 1;
      min-width: 0;
    }
    .inat-taxon-ac-title {
      font-weight: 600;
      line-height: 1.25;
      word-break: break-word;
    }
    .inat-taxon-ac-sub {
      font-size: 12px;
      color: #666;
      margin-top: 2px;
      line-height: 1.2;
    }
  `);

  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        anonymous: false,
        onload(res) {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.responseText);
          } else {
            reject(new Error("HTTP " + res.status + " for " + url));
          }
        },
        onerror() {
          reject(new Error("Network error for " + url));
        },
      });
    });
  }

  /**
   * Parse flag rows from /flags HTML. Skips moderator-action rows (colspan).
   * Sort key: numeric flag id (desc = newest-first; matches server created_at desc in practice).
   */
  function parseFlagRows(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const out = [];
    doc.querySelectorAll("table.table tbody tr").forEach((tr) => {
      const td0 = tr.querySelector("td");
      if (td0 && td0.getAttribute("colspan")) return;
      const tds = tr.querySelectorAll("td");
      if (tds.length < 2) return;
      const a = tr.querySelector('a[href*="/flags/"]');
      if (!a) return;
      const m = a.getAttribute("href").match(/\/flags\/(\d+)/);
      if (!m) return;
      const flagId = parseInt(m[1], 10);
      if (Number.isNaN(flagId)) return;
      out.push({ flagId, tr });
    });
    return out;
  }

  function buildFlagsUrl(origin, taxonId, page, options) {
    const p = new URLSearchParams();
    p.set("utf8", "✓");
    p.set("flaggable_type", "Taxon");
    p.set("taxon_id", String(taxonId));
    p.set("deleted", "any");
    p.set("resolved", options.resolved || "no");
    const types = options.flagTypes || TAXON_FLAG_TYPES;
    types.forEach((t) => p.append("flags[]", t));
    if (options.reasonQuery && options.reasonQuery.trim()) {
      p.set("reason_query", options.reasonQuery.trim());
    }
    const ft = options.flaggerType || "any";
    p.set("flagger_type", ft);
    if (ft === "user") {
      if (options.flaggerName && options.flaggerName.trim()) {
        p.set("flagger_name", options.flaggerName.trim());
      }
      if (options.flaggerUserId && String(options.flaggerUserId).trim()) {
        p.set("flagger_user_id", String(options.flaggerUserId).trim());
      }
    }
    if (options.userName && options.userName.trim()) {
      p.set("user_name", options.userName.trim());
    }
    if (options.userId && String(options.userId).trim()) {
      p.set("user_id", String(options.userId).trim());
    }
    if (options.resolverName && options.resolverName.trim()) {
      p.set("resolver_name", options.resolverName.trim());
    }
    if (options.resolverUserId && String(options.resolverUserId).trim()) {
      const rid = String(options.resolverUserId).trim();
      p.set("resolver_id", rid);
      p.set("resolver_user_id", rid);
    }
    p.set("page", String(page));
    return origin + "/flags?" + p.toString();
  }

  class TaxonStream {
    constructor(taxonId, origin, options) {
      this.taxonId = taxonId;
      this.origin = origin;
      this.options = options;
      this.nextPage = 1;
      /** @type {{ flagId: number, tr: HTMLTableRowElement }[]} */
      this.buffer = [];
      this.exhausted = false;
      this.error = null;
    }

    async fetchNextPage() {
      if (this.exhausted) return;
      const url = buildFlagsUrl(this.origin, this.taxonId, this.nextPage++, this.options);
      const html = await gmGet(url);
      const rows = parseFlagRows(html);
      rows.forEach((r) => this.buffer.push(r));
      if (rows.length === 0 || rows.length < 50) {
        this.exhausted = true;
      }
    }

    async ensureHead() {
      while (this.buffer.length === 0 && !this.exhausted && !this.error) {
        try {
          await this.fetchNextPage();
        } catch (e) {
          this.error = e;
          this.exhausted = true;
        }
      }
    }
  }

  function pickBestStream(streams) {
    let best = null;
    let bestId = -Infinity;
    for (const s of streams) {
      if (s.buffer.length === 0) continue;
      const fid = s.buffer[0].flagId;
      if (fid > bestId) {
        bestId = fid;
        best = s;
      }
    }
    return best;
  }

  function parseTaxonIds(text) {
    const raw = String(text == null ? "" : text)
      .replace(/\u00a0/g, " ")
      .replace(/[，；｜]/g, ",")
      .replace(/[;|]/g, ",");
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseInt(s, 10))
      .filter((n) => !Number.isNaN(n));
  }

  /** True if clipboard/text should become taxon ID chips (not a name search). */
  function pastedLooksLikeTaxonIdList(text) {
    const ids = uniqueTaxonIds(parseTaxonIds(text));
    if (ids.length === 0) {
      return false;
    }
    if (ids.length >= 2) {
      return true;
    }
    return !/[a-zA-Z]/.test(String(text));
  }

  /** First occurrence wins; drops duplicate IDs from pasted lists. */
  function uniqueTaxonIds(ids) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const n = ids[i];
      if (!seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  }

  function getTaxonNameCache() {
    try {
      const raw = GM_getValue(TAXON_NAMES_KEY, "{}");
      const o = JSON.parse(String(raw));
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }

  function setTaxonNameCacheObject(obj) {
    safeGMSet(TAXON_NAMES_KEY, JSON.stringify(obj));
  }

  /**
   * @param {number} id
   * @param {{ name?: string, preferred_common_name?: string }} t
   */
  function setTaxonNameCacheEntry(id, t) {
    const c = getTaxonNameCache();
    c[String(id)] = {
      name: t.name || "",
      common: t.preferred_common_name || "",
    };
    setTaxonNameCacheObject(c);
  }

  function clearTaxonNameCache() {
    safeGMSet(TAXON_NAMES_KEY, "{}");
  }

  /**
   * Drops cached names for taxa no longer in the list (keeps storage small).
   * @param {number[]} ids
   */
  function pruneTaxonNameCache(ids) {
    const keep = new Set(ids.map(String));
    const c = getTaxonNameCache();
    let changed = false;
    Object.keys(c).forEach(function (k) {
      if (!keep.has(k)) {
        delete c[k];
        changed = true;
      }
    });
    if (changed) {
      setTaxonNameCacheObject(c);
    }
  }

  /** Same endpoint as `taxon_autocomplete.js.erb` on the real flags form. */
  const TAXON_AUTOCOMPLETE_API = "https://api.inaturalist.org/v1/taxa/autocomplete";
  const TAXA_BY_ID_API = "https://api.inaturalist.org/v1/taxa";
  const DEFAULT_TAXON_ICON =
    "https://static.inaturalist.org/assets/iconic_taxa/unknown-75px.png";

  function taxonPhotoUrl(t) {
    if (t.default_photo) {
      const p = t.default_photo;
      if (p.square_url) {
        return p.square_url;
      }
      if (p.url) {
        return p.url;
      }
    }
    if (t.iconic_taxon_name) {
      const slug = String(t.iconic_taxon_name)
        .toLowerCase()
        .replace(/\s+/g, "_");
      return "https://static.inaturalist.org/assets/iconic_taxa/" + slug + "-75px.png";
    }
    return DEFAULT_TAXON_ICON;
  }

  function taxonTitleLine(t) {
    return t.name || "Taxon " + t.id;
  }

  function taxonSubtitleLine(t) {
    const common = t.preferred_common_name;
    const name = t.name;
    if (common && name && common !== name) {
      return common;
    }
    if (t.matched_term && t.matched_term !== name) {
      return t.matched_term;
    }
    return t.rank || "";
  }

  /**
   * @param {HTMLElement} chipsContainer
   * @param {HTMLTextAreaElement} hiddenTextarea
   */
  function renderTaxonChips(chipsContainer, hiddenTextarea) {
    if (!chipsContainer || !hiddenTextarea) {
      return;
    }
    const ids = uniqueTaxonIds(parseTaxonIds(hiddenTextarea.value));
    const cache = getTaxonNameCache();
    chipsContainer.textContent = "";
    ids.forEach((id) => {
      const meta = cache[String(id)] || {};
      const chip = document.createElement("span");
      chip.className = "inat-merge-taxon-chip";
      chip.dataset.taxonId = String(id);
      if (!meta.name) {
        chip.classList.add("inat-merge-taxon-chip-pending");
      }
      const label = document.createElement("span");
      label.className = "inat-merge-taxon-chip-label";
      const namePart = meta.name || "Loading…";
      const common = meta.common;
      label.textContent = common
        ? namePart + " (" + id + ") — " + common
        : namePart + " (" + id + ")";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "inat-merge-taxon-chip-remove";
      rm.setAttribute("aria-label", "Remove taxon " + id);
      rm.appendChild(document.createTextNode("\u00d7"));
      rm.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const next = uniqueTaxonIds(
          parseTaxonIds(hiddenTextarea.value).filter((n) => n !== id)
        );
        hiddenTextarea.value = next.join("\n");
        syncTaxonChips(hiddenTextarea);
      });
      chip.appendChild(label);
      chip.appendChild(rm);
      chipsContainer.appendChild(chip);
    });
  }

  /**
   * @param {HTMLTextAreaElement} textarea
   * @param {HTMLElement} chipsEl
   * @param {number} gen Generation from syncTaxonChips; stale runs abort before rendering.
   */
  async function hydrateTaxonNames(textarea, chipsEl, gen) {
    if (gen !== taxonHydrateGen) {
      return;
    }
    const ids = uniqueTaxonIds(parseTaxonIds(textarea.value));
    const cache = getTaxonNameCache();
    const missing = ids.filter((id) => {
      const m = cache[String(id)];
      return !m || !m.name;
    });
    if (missing.length === 0) {
      if (gen !== taxonHydrateGen) {
        return;
      }
      renderTaxonChips(chipsEl, textarea);
      return;
    }
    const chunkSize = 40;
    for (let i = 0; i < missing.length; i += chunkSize) {
      const part = missing.slice(i, i + chunkSize);
      const url =
        TAXA_BY_ID_API + "?id=" + part.map((n) => String(n)).join(",");
      try {
        const res = await fetch(url, { credentials: "omit" });
        if (!res.ok) {
          throw new Error("HTTP " + res.status);
        }
        const data = await res.json();
        const results = data.results || [];
        const byId = new Map(results.map((t) => [t.id, t]));
        part.forEach((id) => {
          const t = byId.get(id);
          if (t) {
            setTaxonNameCacheEntry(id, t);
          } else {
            setTaxonNameCacheEntry(id, {
              name: "(not found)",
              preferred_common_name: "",
            });
          }
        });
      } catch (e) {
        part.forEach((id) => {
          const cur = getTaxonNameCache()[String(id)];
          if (!cur || !cur.name) {
            setTaxonNameCacheEntry(id, {
              name: "(lookup failed)",
              preferred_common_name: "",
            });
          }
        });
      }
      if (gen !== taxonHydrateGen) {
        return;
      }
      renderTaxonChips(chipsEl, textarea);
    }
  }

  /**
   * @param {HTMLTextAreaElement} textarea
   * @returns {HTMLElement | null}
   */
  function resolveTaxonChips(textarea) {
    if (!textarea || typeof textarea.closest !== "function") {
      return null;
    }
    const panel = textarea.closest("#inat-merge-panel");
    if (!panel) {
      return null;
    }
    return panel.querySelector("#inat-merge-taxa-chips");
  }

  /**
   * Normalizes ID list in hidden textarea, re-renders chips, saves, hydrates names.
   * @param {HTMLTextAreaElement} textarea
   */
  function syncTaxonChips(textarea) {
    try {
      if (!textarea) {
        return;
      }
      const chipsEl = resolveTaxonChips(textarea);
      if (!chipsEl) {
        return;
      }
      const ids = uniqueTaxonIds(parseTaxonIds(textarea.value));
      textarea.value = ids.join("\n");
      renderTaxonChips(chipsEl, textarea);
      safeGMSet(STORAGE_KEY, textarea.value.trim());
      pruneTaxonNameCache(ids);
      taxonHydrateGen++;
      const gen = taxonHydrateGen;
      hydrateTaxonNames(textarea, chipsEl, gen);
    } catch (e) {
      console.error("[inat-merge] syncTaxonChips", e);
    }
  }

  /**
   * @param {HTMLTextAreaElement} textarea
   * @param {number} taxonId
   * @param {object | null} [taxonFromAutocomplete] full taxon from autocomplete (optional)
   */
  function appendTaxonIdToList(textarea, taxonId, taxonFromAutocomplete) {
    const idNum = parseInt(String(taxonId), 10);
    if (Number.isNaN(idNum)) {
      return;
    }
    const existing = uniqueTaxonIds(parseTaxonIds(textarea.value));
    if (existing.includes(idNum)) {
      return;
    }
    const v = textarea.value.trim();
    const sep = v ? "\n" : "";
    textarea.value = v + sep + String(idNum);
    if (taxonFromAutocomplete && taxonFromAutocomplete.id != null) {
      setTaxonNameCacheEntry(taxonFromAutocomplete.id, taxonFromAutocomplete);
    }
    if (resolveTaxonChips(textarea)) {
      syncTaxonChips(textarea);
    } else {
      safeGMSet(
        STORAGE_KEY,
        uniqueTaxonIds(parseTaxonIds(textarea.value)).join("\n")
      );
    }
  }

  /**
   * @param {HTMLInputElement} searchInput
   * @param {HTMLTextAreaElement} listTextarea
   */
  function attachTaxonAutocomplete(searchInput, listTextarea) {
    const wrap = searchInput.closest(".inat-user-ac-wrap");
    if (!wrap || !listTextarea) {
      return;
    }

    let menu = null;
    let debounceTimer = null;
    let activeIndex = -1;
    /** @type {object[]} */
    let lastResults = [];

    function closeMenu() {
      if (menu && menu.parentNode) {
        menu.remove();
      }
      menu = null;
      activeIndex = -1;
      lastResults = [];
    }

    function selectTaxon(t) {
      appendTaxonIdToList(listTextarea, t.id, t);
      searchInput.value = "";
      closeMenu();
    }

    function updateActive(items) {
      items.forEach((el, i) => {
        el.classList.toggle("inat-active", i === activeIndex);
        if (i === activeIndex) {
          el.scrollIntoView({ block: "nearest" });
        }
      });
    }

    searchInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const q = searchInput.value.trim();
      if (!q) {
        closeMenu();
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          const url =
            TAXON_AUTOCOMPLETE_API +
            "?q=" +
            encodeURIComponent(q) +
            "&per_page=10";
          const res = await fetch(url, { credentials: "omit" });
          if (!res.ok) {
            throw new Error("HTTP " + res.status);
          }
          const data = await res.json();
          const raw = data.results || [];
          const results = raw.filter(function (r) {
            return (
              r &&
              r.id != null &&
              r.type !== "search_external" &&
              r.type !== "message"
            );
          });
          closeMenu();
          if (!results.length) {
            return;
          }
          lastResults = results;
          menu = document.createElement("ul");
          menu.className = "inat-user-ac-menu list-unstyled inat-taxon-ac-menu";
          menu.setAttribute("role", "listbox");
          results.forEach((t, i) => {
            const li = document.createElement("li");
            li.className = "inat-taxon-ac-item";
            li.setAttribute("role", "option");
            const img = document.createElement("img");
            img.className = "inat-taxon-ac-thumb";
            img.width = 40;
            img.height = 40;
            img.alt = "";
            img.src = taxonPhotoUrl(t);
            img.addEventListener("error", function onErr() {
              img.removeEventListener("error", onErr);
              img.src = DEFAULT_TAXON_ICON;
            });
            const text = document.createElement("div");
            text.className = "inat-taxon-ac-text";
            const title = document.createElement("div");
            title.className = "inat-taxon-ac-title";
            title.textContent = taxonTitleLine(t);
            text.appendChild(title);
            const sub = taxonSubtitleLine(t);
            if (sub) {
              const subEl = document.createElement("div");
              subEl.className = "inat-taxon-ac-sub";
              subEl.textContent = sub;
              text.appendChild(subEl);
            }
            li.appendChild(img);
            li.appendChild(text);
            li.addEventListener("mousedown", (e) => {
              e.preventDefault();
              selectTaxon(t);
            });
            menu.appendChild(li);
          });
          wrap.appendChild(menu);
          activeIndex = -1;
        } catch (e) {
          closeMenu();
        }
      }, 300);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (!menu) {
        return;
      }
      const items = menu.querySelectorAll(".inat-taxon-ac-item");
      const n = items.length;
      if (!n) {
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        activeIndex = activeIndex < n - 1 ? activeIndex + 1 : 0;
        updateActive(items);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeIndex = activeIndex > 0 ? activeIndex - 1 : n - 1;
        updateActive(items);
      } else if (e.key === "Enter") {
        if (activeIndex >= 0 && lastResults[activeIndex]) {
          e.preventDefault();
          selectTaxon(lastResults[activeIndex]);
        }
      } else if (e.key === "Escape") {
        closeMenu();
      }
    });

    document.addEventListener("click", (e) => {
      if (wrap.contains(e.target)) {
        return;
      }
      closeMenu();
    });
  }

  function injectPanel() {
    const container = document.querySelector(".container .col-xs-12") || document.querySelector(".container");
    if (!container || document.getElementById("inat-merge-panel")) return;

    const saved = GM_getValue(STORAGE_KEY, "47604\n200152");
    const savedMode = GM_getValue(MODE_KEY, "standard");

    const panel = document.createElement("div");
    panel.id = "inat-merge-panel";
    panel.innerHTML = `
      <div id="inat-merge-mode-toggle">
        <strong style="margin-right:0.5rem">Flags view:</strong>
        <div class="btn-group" role="group">
          <button type="button" class="btn btn-default" id="inat-mode-standard" title="Official filters and table (observations, users, all flag types, etc.)">Standard iNat</button>
          <button type="button" class="btn btn-default" id="inat-mode-merged" title="Multi-taxon merged list (taxon flags, type &quot;other&quot; only)">Merged taxa</button>
        </div>
      </div>
      <p id="inat-merge-standard-hint" class="text-muted">
        Using the normal iNaturalist flags page below. Switch to <strong>Merged taxa</strong> for the multi-taxon queue.
      </p>
      <div id="inat-merge-merged-ui">
        <h3>Merged taxon flags (lazy merge)</h3>
        <p class="text-muted" style="margin:0 0 0.5rem;font-size:13px;">
          <strong>Taxa:</strong> type to search and pick from the list, or paste comma-separated taxon IDs. Merge order is <strong>newest first</strong> by flag ID.
        </p>
        <label for="inat-merge-taxon-combo">Taxa</label>
        <div class="inat-user-ac-wrap inat-merge-taxa-chips-field" id="inat-merge-taxon-combo-wrap">
          <div id="inat-merge-taxa-chips" class="inat-merge-taxa-chips" aria-live="polite"></div>
          <input type="text" id="inat-merge-taxon-combo" class="inat-merge-taxon-combo-input form-control" placeholder="Search taxa or paste IDs (comma-separated)" autocomplete="off" />
        </div>
        <p class="text-muted" style="margin:0.35rem 0 0.5rem;font-size:12px;">
          Backspace with an empty field removes the last chip. Pasting a list of numeric IDs adds them all as chips.
        </p>
        <textarea id="inat-merge-taxa" aria-hidden="true" tabindex="-1"></textarea>
        <div class="row" id="inat-merge-filters-row">
          <div class="col-xs-3">
            <label>Flagger</label>
            <div class="flagger-type">
              <div class="radio">
                <label><input type="radio" name="inat-merge-flagger-type" value="any" checked /> Any</label>
              </div>
              <div class="radio">
                <label><input type="radio" name="inat-merge-flagger-type" value="auto" /> Automatic</label>
              </div>
              <div class="radio">
                <label><input type="radio" name="inat-merge-flagger-type" value="user" /> User</label>
              </div>
            </div>
            <div id="inat-merge-flagger-user-fields" class="form-group">
              <div class="inat-user-ac-wrap">
                <input type="search" id="inat-merge-flagger-name" name="flagger_name" class="form-control" placeholder="Start typing someone's name" autocomplete="off" />
                <input type="hidden" id="inat-merge-flagger-user-id" name="flagger_user_id" value="" />
              </div>
            </div>
          </div>
          <div class="col-xs-3">
            <label for="inat-merge-user-name">Content author</label>
            <div class="inat-user-ac-wrap">
              <input type="search" id="inat-merge-user-name" name="user_name" class="form-control" placeholder="Start typing someone's name" autocomplete="off" />
              <input type="hidden" id="inat-merge-user-id" name="user_id" value="" />
            </div>
          </div>
          <div class="col-xs-3">
            <label for="inat-merge-reason">Search Reasons</label>
            <input type="search" id="inat-merge-reason" class="form-control" placeholder="Search Reasons" />
          </div>
          <div class="col-xs-3">
            <div class="form-group">
              <label for="inat-merge-resolved">Resolved</label>
              <select id="inat-merge-resolved" class="form-control">
                <option value="no" selected>No</option>
                <option value="yes">Yes</option>
                <option value="any">Any</option>
              </select>
            </div>
            <div class="form-group">
              <label for="inat-merge-resolver-name">Resolver</label>
              <div class="inat-user-ac-wrap">
                <input type="search" id="inat-merge-resolver-name" name="resolver_name" class="form-control" placeholder="Start typing someone's name" autocomplete="off" />
                <input type="hidden" id="inat-merge-resolver-user-id" name="resolver_user_id" value="" />
              </div>
            </div>
          </div>
        </div>
        <div id="inat-merge-actions-row">
          <button type="button" class="btn btn-primary" id="inat-merge-start">Load merged table</button>
          <button type="button" class="btn btn-default" id="inat-merge-load-more" disabled>Load 50 more</button>
          <button type="button" class="btn btn-link" id="inat-merge-reset" title="Clear filters (same idea as the official page)">Reset</button>
          <span id="inat-merge-status"></span>
        </div>
        <div id="inat-merge-table-wrap" style="display:none;margin-top:1rem;overflow:auto">
          <table class="table inat-merge-table">
            <thead>
              <tr>
                <th>Taxon filter</th>
                <th>Flagger</th>
                <th>Content author</th>
                <th>Content</th>
                <th class="reason">Reason</th>
                <th>Flag page</th>
                <th class="resolution">Resolution</th>
              </tr>
            </thead>
            <tbody id="inat-merge-tbody"></tbody>
          </table>
          <div id="inat-merge-table-footer">
            <button type="button" class="btn btn-default" id="inat-merge-load-more-bottom" disabled>Load 50 more</button>
            <span id="inat-merge-status-bottom"></span>
          </div>
        </div>
      </div>
    `;

    const h2 = container.querySelector("h2");
    if (h2) {
      const expl =
        h2.nextElementSibling && h2.nextElementSibling.matches("p.text-muted")
          ? h2.nextElementSibling
          : null;
      if (expl) {
        expl.insertAdjacentElement("afterend", panel);
      } else {
        h2.insertAdjacentElement("afterend", panel);
      }
    } else {
      container.insertBefore(panel, container.firstChild);
    }

    const statusEl = panel.querySelector("#inat-merge-status");
    const statusBottomEl = panel.querySelector("#inat-merge-status-bottom");
    const tbody = panel.querySelector("#inat-merge-tbody");
    const tableWrap = panel.querySelector("#inat-merge-table-wrap");
    const btnStart = panel.querySelector("#inat-merge-start");
    const btnMore = panel.querySelector("#inat-merge-load-more");
    const btnMoreBottom = panel.querySelector("#inat-merge-load-more-bottom");
    const ta = panel.querySelector("#inat-merge-taxa");
    const taxonCombo = panel.querySelector("#inat-merge-taxon-combo");
    const chipsWrap = panel.querySelector("#inat-merge-taxon-combo-wrap");
    if (ta) {
      ta.value = String(saved != null ? saved : "");
    }

    function focusTaxonCombo() {
      if (taxonCombo) {
        taxonCombo.focus();
      }
    }
    if (chipsWrap) {
      chipsWrap.addEventListener("click", function (e) {
        if (e.target === chipsWrap || e.target.closest("#inat-merge-taxa-chips")) {
          focusTaxonCombo();
        }
      });
    }
    if (taxonCombo && ta) {
      taxonCombo.addEventListener("paste", function (e) {
        const clip = e.clipboardData && e.clipboardData.getData("text/plain");
        if (!clip || !pastedLooksLikeTaxonIdList(clip)) {
          return;
        }
        e.preventDefault();
        const newIds = uniqueTaxonIds(parseTaxonIds(clip));
        if (newIds.length === 0) {
          return;
        }
        const existing = uniqueTaxonIds(parseTaxonIds(ta.value));
        ta.value = uniqueTaxonIds(existing.concat(newIds)).join("\n");
        taxonCombo.value = "";
        syncTaxonChips(ta);
      });
      taxonCombo.addEventListener("keydown", function (e) {
        const wrap = taxonCombo.closest(".inat-user-ac-wrap");
        const acMenu = wrap && wrap.querySelector(".inat-user-ac-menu");
        if (e.key === "Backspace" && !taxonCombo.value) {
          if (acMenu) {
            return;
          }
          const ids = uniqueTaxonIds(parseTaxonIds(ta.value));
          if (ids.length === 0) {
            return;
          }
          e.preventDefault();
          ids.pop();
          ta.value = ids.join("\n");
          syncTaxonChips(ta);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          const q = taxonCombo.value.trim();
          if (!q || !pastedLooksLikeTaxonIdList(q)) {
            return;
          }
          if (acMenu) {
            return;
          }
          e.preventDefault();
          const newIds = uniqueTaxonIds(parseTaxonIds(q));
          if (newIds.length === 0) {
            return;
          }
          const existing = uniqueTaxonIds(parseTaxonIds(ta.value));
          ta.value = uniqueTaxonIds(existing.concat(newIds)).join("\n");
          taxonCombo.value = "";
          syncTaxonChips(ta);
        }
      });
    }

    if (ta) {
      syncTaxonChips(ta);
    }

    const btnModeStandard = panel.querySelector("#inat-mode-standard");
    const btnModeMerged = panel.querySelector("#inat-mode-merged");
    const mergedUi = panel.querySelector("#inat-merge-merged-ui");

    attachUserAutocomplete(
      mergedUi.querySelector("#inat-merge-flagger-name"),
      mergedUi.querySelector("#inat-merge-flagger-user-id"),
      {
        onFocus() {
          const r = mergedUi.querySelector(
            'input[name="inat-merge-flagger-type"][value="user"]'
          );
          if (r) {
            r.checked = true;
          }
        },
      }
    );
    attachUserAutocomplete(
      mergedUi.querySelector("#inat-merge-user-name"),
      mergedUi.querySelector("#inat-merge-user-id")
    );
    attachUserAutocomplete(
      mergedUi.querySelector("#inat-merge-resolver-name"),
      mergedUi.querySelector("#inat-merge-resolver-user-id")
    );
    attachTaxonAutocomplete(
      mergedUi.querySelector("#inat-merge-taxon-combo"),
      ta
    );

    function applyViewMode(mode) {
      const isMerged = mode === "merged";
      document.body.classList.toggle("inat-merge-official-hidden", isMerged);
      btnModeStandard.classList.toggle("inat-active", !isMerged);
      btnModeMerged.classList.toggle("inat-active", isMerged);
      safeGMSet(MODE_KEY, mode);
    }

    applyViewMode(savedMode === "merged" ? "merged" : "standard");

    btnModeStandard.addEventListener("click", () => applyViewMode("standard"));
    btnModeMerged.addEventListener("click", () => applyViewMode("merged"));

    let streams = [];
    const seenIds = new Set();
    let loading = false;

    function setStatus(msg) {
      const t = msg || "";
      statusEl.textContent = t;
      statusBottomEl.textContent = t;
    }

    function readOptions() {
      const flaggerTypeEl = mergedUi.querySelector(
        'input[name="inat-merge-flagger-type"]:checked'
      );
      return {
        resolved: mergedUi.querySelector("#inat-merge-resolved").value,
        reasonQuery: mergedUi.querySelector("#inat-merge-reason").value,
        flagTypes: TAXON_FLAG_TYPES,
        flaggerType: flaggerTypeEl ? flaggerTypeEl.value : "any",
        flaggerName: mergedUi.querySelector("#inat-merge-flagger-name").value,
        flaggerUserId: mergedUi.querySelector("#inat-merge-flagger-user-id").value,
        userName: mergedUi.querySelector("#inat-merge-user-name").value,
        userId: mergedUi.querySelector("#inat-merge-user-id").value,
        resolverName: mergedUi.querySelector("#inat-merge-resolver-name").value,
        resolverUserId: mergedUi.querySelector("#inat-merge-resolver-user-id").value,
      };
    }

    function resetMergedFilters() {
      mergedUi.querySelector('input[name="inat-merge-flagger-type"][value="any"]').checked = true;
      mergedUi.querySelector("#inat-merge-flagger-name").value = "";
      mergedUi.querySelector("#inat-merge-flagger-user-id").value = "";
      mergedUi.querySelector("#inat-merge-user-name").value = "";
      mergedUi.querySelector("#inat-merge-user-id").value = "";
      mergedUi.querySelector("#inat-merge-resolver-name").value = "";
      mergedUi.querySelector("#inat-merge-resolver-user-id").value = "";
      mergedUi.querySelector("#inat-merge-resolved").value = "no";
      mergedUi.querySelector("#inat-merge-reason").value = "";
      mergedUi.querySelector("#inat-merge-taxon-combo").value = "";
      ta.value = "";
      safeGMSet(STORAGE_KEY, "");
      clearTaxonNameCache();
      syncTaxonChips(ta);
      setStatus("Filters reset.");
    }

    async function loadMore(batchSize) {
      if (loading || streams.length === 0) return;
      loading = true;
      btnMore.disabled = true;
      btnMoreBottom.disabled = true;
      btnStart.disabled = true;
      setStatus("Loading…");

      let added = 0;
      const errors = [];

      try {
        while (added < batchSize) {
          await Promise.all(streams.map((s) => s.ensureHead()));
          streams.forEach((s) => {
            if (s.error) errors.push("Taxon " + s.taxonId + ": " + s.error.message);
          });

          const best = pickBestStream(streams);
          if (!best) break;

          const row = best.buffer.shift();
          if (seenIds.has(row.flagId)) continue;
          seenIds.add(row.flagId);

          const imported = document.importNode(row.tr, true);
          let cells = imported.querySelectorAll("td");
          if (cells.length > 2) {
            cells[2].remove();
          }
          cells = imported.querySelectorAll("td");
          if (cells.length >= 6) {
            const commentsTd = cells[4];
            const actionsTd = cells[5];
            const hrefEl =
              actionsTd.querySelector('a[href*="/flags/"]') ||
              commentsTd.querySelector('a[href*="/flags/"]');
            let n = 0;
            const badgeLink = commentsTd.querySelector("a.badge");
            if (badgeLink) {
              const parsed = parseInt(badgeLink.textContent.trim(), 10);
              if (!Number.isNaN(parsed)) {
                n = parsed;
              }
            }
            const merged = document.createElement("td");
            merged.className = "inat-flag-page-cell";
            const a = document.createElement("a");
            const href = hrefEl && hrefEl.getAttribute("href");
            a.href = href || "#";
            a.className = "btn btn-info btn-sm";
            a.textContent = "Open (" + n + ")";
            const cmtWord = n === 1 ? "comment" : "comments";
            a.title = "Open flag page (" + n + " " + cmtWord + ")";
            merged.appendChild(a);
            commentsTd.replaceWith(merged);
            actionsTd.remove();
          }
          const firstCell = document.createElement("td");
          firstCell.textContent = String(best.taxonId);
          imported.insertBefore(firstCell, imported.firstChild);
          tbody.appendChild(imported);
          added++;
        }
      } finally {
        loading = false;
        btnStart.disabled = false;
        const errMsg = errors.length ? " Some streams failed: " + errors.join(" | ") : "";
        const n = tbody.children.length;
        let atEnd = false;
        if (streams.length > 0) {
          await Promise.all(streams.map((s) => s.ensureHead()));
          atEnd = streams.every((s) => s.buffer.length === 0);
        }
        const moreOff = streams.length === 0 || atEnd;
        btnMore.disabled = moreOff;
        btnMoreBottom.disabled = moreOff;
        setStatus(
          (atEnd && streams.length > 0 ? "Showing all " : "Showing ") +
            n +
            " merged rows." +
            errMsg
        );
      }
    }

    btnStart.addEventListener("click", async () => {
      syncTaxonChips(ta);
      const ids = uniqueTaxonIds(parseTaxonIds(ta.value));
      if (ids.length === 0) {
        alert("Enter at least one taxon ID.");
        return;
      }

      const options = readOptions();

      tbody.innerHTML = "";
      seenIds.clear();
      tableWrap.style.display = "block";

      const origin = window.location.origin;
      streams = ids.map((id) => new TaxonStream(id, origin, options));

      await loadMore(50);
    });

    btnMore.addEventListener("click", () => loadMore(50));
    btnMoreBottom.addEventListener("click", () => loadMore(50));
    panel.querySelector("#inat-merge-reset").addEventListener("click", resetMergedFilters);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectPanel);
  } else {
    injectPanel();
  }
})();

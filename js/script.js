/* =====================================================================
   SOUQORA CONFIGURATION - edit these values
   ===================================================================== */

/* Your deployed Google Apps Script Web App URL ("Anyone" access). */
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxg7wSa4A6x8cR7bLc_yAnCS3d_xqH_6-kZQbOilD6AkQ5CbEZVWoQeu59MLlkbdt2Y/exec";

/* Bank transfer instructions shown to customers. Replace the placeholders. */
const BANK_DETAILS = {
  bankName: "Arab National Bank",
  accountName: "MOHAMMED MOTIUR MTIA RAHMAN",
  accountNumber: "", // optional: leave empty to hide this line (the IBAN is enough for most transfers)
  iban: "SA7230100991100836952831",
};

const ORDER_TIMEOUT_MS = 30000; // give up waiting for Google after 30 seconds

/* ---------------------------------------------------------------------
   Sends ONE order to Google Sheets. Resolves only when the Apps Script
   reports success; otherwise it throws an Error with a customer-friendly
   message. The body is a plain string (no JSON content-type header), so
   the browser sends a "simple" request and no CORS preflight is needed.
   --------------------------------------------------------------------- */
async function sendOrderToGoogleSheets(orderData) {
  if (!GOOGLE_SCRIPT_URL || GOOGLE_SCRIPT_URL.includes("PASTE_MY")) {
    throw new Error("Online ordering is not configured yet. Please contact us to place your order.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ORDER_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(GOOGLE_SCRIPT_URL, { method: "POST", body: JSON.stringify(orderData), redirect: "follow", signal: ctrl.signal });
  } catch (err) {
    throw new Error(err && err.name === "AbortError"
      ? "The order server took too long to respond, so we could not confirm your order."
      : "We could not reach the order server. Please check your internet connection.");
  } finally { clearTimeout(timer); }
  if (!response.ok) throw new Error("The order server returned an error (" + response.status + "). Please try again.");
  let raw = "";
  try { raw = await response.text(); } catch (e) { throw new Error("We could not read the order server's reply, so we could not confirm your order."); }
  const snippet = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  let result = null;
  try { result = JSON.parse(raw); } catch (e) { result = null; }
  const bad = /\b(error|fail|failed|exception|invalid|denied)\b/i;
  if (result === null || typeof result !== "object") {
    // Plain-text reply: accept only a clear success message (never an HTML error page).
    if (!/<html|<!doctype/i.test(raw) && /\b(success|saved|received|submitted)\b/i.test(raw) && !bad.test(raw)) {
      const m = raw.match(/order\s*(?:id|number|no)\W+([\w-]+)/i);
      return { orderId: m ? m[1] : "", text: raw };
    }
    console.error("Order server response (not understood):", raw.slice(0, 500));
    throw new Error("The order server sent a reply we could not understand, so we could not confirm your order. Server reply: " + (snippet || "(empty)"));
  }
  const orderId = String(result.orderId || result.orderID || result.order_id || result.id || "");
  const word = String(result.status || result.result || "").toLowerCase();
  const failed = result.success === false || result.error || word === "error" || word === "fail" || word === "failed";
  const ok = !failed && (result.success === true || word === "success" || word === "ok" || !!orderId);
  if (!ok) {
    console.error("Order server response (not recognised as success):", result);
    throw new Error((result.error || result.message) ? String(result.error || result.message) : "Your order could not be confirmed. Server reply: " + snippet);
  }
  return Object.assign({}, result, { orderId: orderId });
}

/* Souqora - store logic (vanilla JS). Product data is read from index.html, so edit products there. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const S = $("#settings").dataset;
  const money = (n) => S.currency + Number(n).toLocaleString("en-US");
  const num = (t) => parseFloat(String(t).replace(/[^\d.]/g, "")) || 0;
  const detail = $("#detail-modal"), successModal = $("#success-modal"), orderModal = $("#order-modal");
  const baseTitle = document.title;
  let submitting = false; // true while an order is being sent (blocks double submits)

  /* ---- Fill settings into contact/footer/social ---- */
  $$("[data-fill]").forEach((el) => { el.textContent = S[el.dataset.fill]; });
  $$("[data-link]").forEach((a) => {
    const k = a.dataset.link;
    a.href = { email: "mailto:" + S.email, wa: "https://wa.me/" + S.whatsapp, site: "https://" + S.site, fb: S.facebook, ig: S.instagram, yt: S.youtube }[k];
  });

  /* ---- Marquee: repeat the text so it loops seamlessly ---- */
  const track = $("#marquee"), item = $(".mq-item", track);
  for (let i = 0; i < 7; i++) track.appendChild(item.cloneNode(true));

  /* ---- Read products from the HTML ---- */
  const products = $$(".product-card").map((el) => ({
    el, id: el.dataset.id, cat: el.dataset.category,
    name: $(".p-name", el).textContent.trim(), catName: $(".p-cat", el).textContent.trim(),
    price: num($(".p-price", el).textContent), orig: num($(".p-orig", el).textContent),
    disc: $(".p-disc", el).textContent.trim(), desc: $(".p-desc", el).textContent.trim(),
    rating: $(".p-rating", el).textContent.trim(), reviews: $(".p-reviews", el).textContent.trim(),
    stars: $("[aria-hidden]", el.querySelector("p[aria-label]")).textContent,
    main: $(".img-main", el).getAttribute("src"), hover: $(".img-hover", el).getAttribute("src"),
    // Optional: add data-gallery-1, data-gallery-2 and data-gallery-3 to a product card.
    gallery: [el.getAttribute("data-gallery-1"), el.getAttribute("data-gallery-2"), el.getAttribute("data-gallery-3")].filter(Boolean),
  }));
  const byId = (id) => products.find((p) => p.id === id);

  /* ---- Toast + modal helpers ---- */
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200); }
  function openModal(m) {
    if (!m) return;
    m.classList.remove("hidden");
    m.classList.add("is-open");
    // Explicit inline display makes modal visibility reliable even if the
    // project's external CSS is missing or overrides .modal.is-open.
    m.style.display = "flex";
    document.body.style.overflow = "hidden";
  }
  function closeModal(m) {
    if (m === orderModal && submitting) return; // don't lose the form while sending
    m.classList.add("hidden"); m.classList.remove("is-open");
    m.style.display = "none";
    if (!$(".modal.is-open") && $("#cart-drawer").getAttribute("aria-hidden") === "true") document.body.style.overflow = "";
    if (m === detail) { document.title = baseTitle; leaveProductUrl(); }
    if (m === successModal) { if (detail.classList.contains("is-open")) closeModal(detail); $("#shop").scrollIntoView(); }
  }
  $$(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(m); });
  });

  /* ---- Mobile menu + search ---- */
  const menuBtn = $("#menu-toggle"), menu = $("#mobile-menu");
  menuBtn.addEventListener("click", () => { const open = menu.classList.toggle("hidden") === false; menuBtn.setAttribute("aria-expanded", open); });
  $$("a", menu).forEach((a) => a.addEventListener("click", () => { menu.classList.add("hidden"); menuBtn.setAttribute("aria-expanded", "false"); }));
  $("#search-toggle").addEventListener("click", () => { const b = $("#search-bar"); b.classList.toggle("hidden"); if (!b.classList.contains("hidden")) $("#search-input").focus(); });

  /* ---- Filtering + search ---- */
  const state = { cat: "all", q: "" };
  function applyFilters() {
    const q = state.q.trim().toLowerCase(); let shown = 0;
    products.forEach((p) => {
      const ok = (state.cat === "all" || p.cat === state.cat) && (!q || (p.name + " " + p.catName + " " + p.desc).toLowerCase().includes(q));
      p.el.classList.toggle("hidden", !ok); if (ok) shown++;
    });
    $("#no-results").classList.toggle("hidden", shown > 0);
    $("#result-count").textContent = shown ? "Showing " + shown + " product" + (shown > 1 ? "s" : "") : "";
    $$(".filter-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.filter === state.cat));
  }
  $$(".filter-btn").forEach((b) => b.addEventListener("click", () => { state.cat = b.dataset.filter; applyFilters(); }));
  $("#search-input").addEventListener("input", (e) => { state.q = e.target.value; applyFilters(); if (state.q) $("#shop").scrollIntoView(); });
  $$(".cat-card").forEach((c) => c.addEventListener("click", () => { state.cat = c.dataset.cat; state.q = ""; $("#search-input").value = ""; applyFilters(); $("#shop").scrollIntoView(); }));
  applyFilters();

  /* ---- Category slider: arrows, auto-slide, swipe (native scrolling) ---- */
  const cTrack = $("#cat-track"); const step = () => cTrack.clientWidth * 0.7;
  const slide = (dir) => {
    const max = cTrack.scrollWidth - cTrack.clientWidth;
    if (dir > 0 && cTrack.scrollLeft >= max - 4) cTrack.scrollTo({ left: 0 });
    else if (dir < 0 && cTrack.scrollLeft <= 4) cTrack.scrollTo({ left: max });
    else cTrack.scrollBy({ left: dir * step() });
  };
  $("#cat-prev").addEventListener("click", () => slide(-1));
  $("#cat-next").addEventListener("click", () => slide(1));
  let auto = setInterval(() => slide(1), 3500);
  const pause = () => clearInterval(auto), resume = () => { clearInterval(auto); auto = setInterval(() => slide(1), 3500); };
  ["mouseenter", "touchstart", "focusin"].forEach((ev) => cTrack.addEventListener(ev, pause, { passive: true }));
  ["mouseleave", "touchend", "focusout"].forEach((ev) => cTrack.addEventListener(ev, resume, { passive: true }));

  /* ---- Cart (localStorage) ---- */
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem("souqora-cart")) || []; } catch (e) { cart = []; }
  cart = cart.filter((c) => byId(c.id));
  const save = () => { try { localStorage.setItem("souqora-cart", JSON.stringify(cart)); } catch (e) {} };
  const drawer = $("#cart-drawer"), overlay = $("#cart-overlay");
  function openCart() { drawer.classList.remove("translate-x-full"); drawer.setAttribute("aria-hidden", "false"); overlay.classList.remove("hidden"); document.body.style.overflow = "hidden"; $("#cart-close").focus(); }
  function closeCart() { drawer.classList.add("translate-x-full"); drawer.setAttribute("aria-hidden", "true"); overlay.classList.add("hidden"); if (!$(".modal.is-open")) document.body.style.overflow = ""; }
  function addToCart(id, qty = 1) {
    const line = cart.find((c) => c.id === id); if (line) line.qty = Math.min(99, line.qty + qty); else cart.push({ id, qty });
    save(); renderCart(); toast("Added to cart");
  }
  function renderCart() {
    const qty = cart.reduce((n, c) => n + c.qty, 0), sub = cart.reduce((n, c) => n + c.qty * byId(c.id).price, 0);
    $("#cart-count").textContent = qty; $("#cart-qty").textContent = qty; $("#cart-subtotal").textContent = money(sub);
    $("#cart-foot").classList.toggle("hidden", !cart.length);
    $("#cart-items").innerHTML = cart.length ? cart.map((c) => { const p = byId(c.id); return `
      <div class="flex gap-3 rounded-2xl border border-slate-200 p-2" data-line="${p.id}">
        <img src="${p.main}" alt="${p.name}" class="h-20 w-20 rounded-xl object-cover" width="80" height="80">
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="truncate font-semibold text-ink">${p.name}</p><p class="text-sm text-slate-600">${money(p.price)}</p>
          <div class="mt-auto flex items-center justify-between">
            <div class="flex items-center rounded-full border border-slate-300">
              <button class="h-8 w-8 text-lg" data-act="dec" aria-label="Decrease quantity">−</button><span class="w-6 text-center text-sm">${c.qty}</span><button class="h-8 w-8 text-lg" data-act="inc" aria-label="Increase quantity">+</button></div>
            <button class="text-sm font-medium text-rose-600 hover:underline" data-act="rm">Remove</button></div>
        </div></div>`; }).join("") : '<p class="py-16 text-center text-slate-600">Your cart is empty. Add something you like!</p>';
  }
  $("#cart-items").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest("[data-line]").dataset.line, line = cart.find((c) => c.id === id);
    if (b.dataset.act === "inc") line.qty = Math.min(99, line.qty + 1);
    if (b.dataset.act === "dec") line.qty -= 1;
    if (b.dataset.act === "rm" || line.qty < 1) cart = cart.filter((c) => c.id !== id);
    save(); renderCart();
  });
  $("#cart-open").addEventListener("click", openCart); $("#cart-close").addEventListener("click", closeCart);
  overlay.addEventListener("click", closeCart); $("#cart-continue").addEventListener("click", closeCart);
  $("#cart-clear").addEventListener("click", () => { cart = []; save(); renderCart(); });
  $("#cart-checkout").addEventListener("click", () => { closeCart(); openOrder(cart.map((c) => ({ p: byId(c.id), qty: c.qty })), true); });
  renderCart();

  /* ---- Product detail (full-screen) ---- */
  /* ---- Direct product links: ?product=PRODUCT-ID ---- */
  let urlBusy = false;
  function setProductUrl(id) {
    try {
      const u = new URL(location.href); u.searchParams.set("product", id);
      if (detail.classList.contains("is-open")) history.replaceState(history.state, "", u);
      else history.pushState({ souqora: 1 }, "", u);
    } catch (e) { /* e.g. file:// preview - links simply won't update */ }
  }
  function leaveProductUrl() {
    if (urlBusy) return;
    try {
      const u = new URL(location.href); if (!u.searchParams.has("product")) return;
      if (history.state && history.state.souqora) return history.back();
      u.searchParams.delete("product"); history.replaceState(null, "", u);
    } catch (e) {}
  }
  window.addEventListener("popstate", () => {
    const id = new URLSearchParams(location.search).get("product"); urlBusy = true;
    try {
      if (id && byId(id)) openDetail(id, true);
      else $$(".modal.is-open").forEach((m) => closeModal(m));
    } finally { urlBusy = false; }
  });

  function openDetail(id, fromUrl) {
    const p = byId(id); if (!p) return;
    if (!fromUrl) setProductUrl(id);
    document.title = p.name + " | " + S.store;
    const related = products.filter((r) => r.cat === p.cat && r.id !== p.id).slice(0, 4);
    // Use the three optional gallery images when supplied. For old products without
    // gallery fields, keep the UI intact by falling back to existing product images.
    // Only real images are shown (no duplicates): a one-image product gets no thumbnail strip.
    const images = [...new Set([...p.gallery, p.main, p.hover].filter(Boolean))].slice(0, 3);
    const firstImage = images[0] || p.main;

    $("#detail-body").innerHTML = `
      <nav class="mb-5 flex flex-wrap items-center gap-x-2 text-sm" aria-label="Breadcrumb">
        <button type="button" id="d-home" class="font-medium text-teal-700 hover:underline">&larr; Home</button><span class="text-slate-400">/</span>
        <button type="button" id="d-cat" class="font-medium text-teal-700 hover:underline">${p.catName}</button></nav>
      <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div>
          <div class="flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl bg-slate-100 shadow-sm sm:min-h-[560px]">
            <img id="d-main-image" src="${firstImage}" alt="${p.name}" class="h-full max-h-[650px] w-full object-contain" width="800" height="800">
          </div>
          ${images.length > 1 ? `<div class="mt-4 grid ${images.length === 2 ? "grid-cols-2" : "grid-cols-3"} gap-3" aria-label="Product image gallery">
            ${images.map((src, index) => `
              <button type="button" class="d-thumb overflow-hidden rounded-2xl border-2 ${index === 0 ? 'border-ink' : 'border-slate-200'} bg-slate-50 p-1 transition hover:border-ink" data-image="${src}" aria-label="View product image ${index + 1}" aria-pressed="${index === 0}">
                <img src="${src}" alt="${p.name} view ${index + 1}" class="aspect-square w-full rounded-xl object-cover" width="180" height="180">
              </button>`).join("")}
          </div>` : ""}
        </div>

        <div class="flex min-h-full flex-col justify-center py-2 lg:py-6">
          <span class="text-sm font-medium text-teal-700">${p.catName}</span>
          <h2 class="mt-1 font-display text-3xl font-bold text-ink sm:text-4xl">${p.name}</h2>
          <p class="mt-3 flex items-center gap-2"><span class="text-amber-500" aria-hidden="true">${p.stars}</span><span class="font-semibold">${p.rating}</span><span class="text-slate-500">(${p.reviews} reviews)</span></p>
          <p class="mt-4 flex flex-wrap items-baseline gap-3"><span class="text-3xl font-bold text-ink">${money(p.price)}</span><s class="text-slate-500">${money(p.orig)}</s><span class="rounded-full bg-rose-600 px-2.5 py-0.5 text-sm font-bold text-white">-${p.disc}%</span></p>
          <div class="mt-5 rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h3 class="font-semibold text-ink">Product Description</h3>
            <p id="d-desc" class="mt-2 whitespace-pre-line leading-relaxed text-slate-600">${p.desc}</p>
            <button type="button" id="d-more" class="mt-2 hidden text-sm font-semibold text-teal-700 hover:underline" aria-expanded="false">Read more</button>
          </div>
          <div class="mt-6 flex items-center gap-3"><span class="font-semibold">Quantity</span>
            <div class="flex items-center rounded-full border border-slate-300 bg-white"><button id="d-dec" class="h-10 w-10 text-xl" aria-label="Decrease quantity">−</button><output id="d-qty" class="w-8 text-center font-semibold">1</output><button id="d-inc" class="h-10 w-10 text-xl" aria-label="Increase quantity">+</button></div></div>
          <p class="mt-3 text-sm text-slate-600">Total: <strong id="d-total" class="text-lg text-ink">${money(p.price)}</strong></p>
          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <button id="d-add" class="rounded-full border-2 border-ink py-3 font-semibold text-ink transition hover:bg-ink hover:text-white">Add to Cart</button>
            <button id="d-buy" class="rounded-full bg-saffron py-3 font-semibold text-ink transition hover:brightness-95">Order Now</button></div>
        </div>
      </div>
      ${related.length ? `<section class="mt-14" aria-labelledby="rel-title"><h3 id="rel-title" class="font-display text-2xl font-bold text-ink">You may also like</h3>
        <div class="mt-4 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">${related.map((r) => `
          <button type="button" class="rel-card rounded-2xl border border-slate-200 bg-white p-2.5 text-left transition hover:shadow-lg" data-rel="${r.id}">
            <span class="block aspect-square overflow-hidden rounded-xl bg-slate-100"><img src="${r.main}" alt="${r.name}" class="h-full w-full object-cover" loading="lazy" width="300" height="300"></span>
            <span class="mt-2 line-clamp-2 block text-sm font-semibold text-ink">${r.name}</span><span class="block text-sm font-bold text-ink">${money(r.price)}</span></button>`).join("")}
        </div></section>` : ""}`;

    $("#d-home").onclick = () => { closeModal(detail); window.scrollTo({ top: 0 }); };
    $("#d-cat").onclick = () => { state.cat = p.cat; state.q = ""; $("#search-input").value = ""; applyFilters(); closeModal(detail); $("#shop").scrollIntoView(); };
    $$(".rel-card", $("#detail-body")).forEach((b) => b.addEventListener("click", () => openDetail(b.dataset.rel)));

    const mainImage = $("#d-main-image");
    $$(".d-thumb", $("#detail-body")).forEach((thumb) => {
      thumb.addEventListener("click", () => {
        mainImage.src = thumb.dataset.image;
        $$(".d-thumb", $("#detail-body")).forEach((item) => {
          item.classList.remove("border-ink");
          item.classList.add("border-slate-200");
          item.setAttribute("aria-pressed", "false");
        });
        thumb.classList.remove("border-slate-200");
        thumb.classList.add("border-ink");
        thumb.setAttribute("aria-pressed", "true");
      });
    });

    let q = 1; const out = $("#d-qty");
    const upd = () => { out.textContent = q; $("#d-total").textContent = money(p.price * q); };
    $("#d-inc").onclick = () => { q = Math.min(99, q + 1); upd(); };
    $("#d-dec").onclick = () => { q = Math.max(1, q - 1); upd(); };
    $("#d-add").onclick = () => addToCart(id, q);
    $("#d-buy").onclick = () => openOrder([{ p, qty: q }], false);
    detail.scrollTop = 0; openModal(detail); $(".close-btn", detail).focus();
    // Collapse long descriptions to about six lines using inline styles,
    // so this works even if Tailwind's line-clamp utility is unavailable.
    const desc = $("#d-desc"), more = $("#d-more");
    const collapsedHeight = "9.75em"; // about six lines with leading-relaxed
    desc.style.maxHeight = collapsedHeight;
    desc.style.overflow = "hidden";
    more.classList.add("hidden");
    more.textContent = "Read more";
    more.setAttribute("aria-expanded", "false");
    if (desc.scrollHeight > desc.clientHeight + 2) {
      more.classList.remove("hidden");
      more.onclick = () => {
        const expanded = more.getAttribute("aria-expanded") !== "true";
        desc.style.maxHeight = expanded ? "none" : collapsedHeight;
        desc.style.overflow = expanded ? "visible" : "hidden";
        more.textContent = expanded ? "Show less" : "Read more";
        more.setAttribute("aria-expanded", String(expanded));
      };
    }
  }

  /* ---- Product card clicks ---- */
  $("#product-grid").addEventListener("click", (e) => {
    const card = e.target.closest(".product-card"); if (!card) return;
    if (e.target.closest(".btn-add")) return addToCart(card.dataset.id);
    if (e.target.closest(".btn-buy")) return openOrder([{ p: byId(card.dataset.id), qty: 1 }], false);
    if (e.target.closest("[data-open]")) openDetail(card.dataset.id);
  });
  $("#product-grid").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".img-wrap")) openDetail(e.target.closest(".product-card").dataset.id); });

  /* ---- Checkout: validate -> save to Google Sheets -> success popup ---- */
  const order = orderModal, form = $("#order-form"), qtyInput = $("#f-qty");
  const BANK = "Direct Bank Transfer", BKASH = "bKash";
  const needsTxn = () => payMethod() === BANK || payMethod() === BKASH;
  let items = [], fromCart = false;
  const val = (id) => $(id).value.trim();
  const payMethod = () => $('input[name="pay"]:checked').value;
  $("#bank-name").textContent = BANK_DETAILS.bankName; $("#bank-account-name").textContent = BANK_DETAILS.accountName;
  $("#bank-account-number").textContent = BANK_DETAILS.accountNumber; $("#bank-iban").textContent = BANK_DETAILS.iban;
  if (!BANK_DETAILS.accountNumber) { $("#bank-account-number").classList.add("hidden"); $("#bank-account-number").previousElementSibling.classList.add("hidden"); }

  function renderSummary() {
    const total = items.reduce((n, i) => n + i.qty * i.p.price, 0);
    $("#order-summary").innerHTML = items.map((i) => `<p class="flex justify-between gap-3 py-0.5"><span>${i.p.name} × ${i.qty}<small class="block text-xs text-slate-500">ID: ${i.p.id} · ${money(i.p.price)} each</small></span><span class="font-medium">${money(i.p.price * i.qty)}</span></p>`).join("") +
      `<p class="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-ink"><span>Total</span><span>${money(total)}</span></p><p class="mt-1 text-xs text-slate-500">Delivery fee will be confirmed when we process your order.</p>`;
    return total;
  }
  function fieldErr(key, msg) {
    const f = $("#f-" + key), e = $("#e-" + key);
    f.classList.toggle("invalid", !!msg); f.setAttribute("aria-invalid", msg ? "true" : "false");
    if (e) { e.textContent = msg || ""; e.classList.toggle("hidden", !msg); }
  }
  const showFormError = (m) => { const e = $("#form-error"); e.textContent = m; e.classList.remove("hidden"); e.scrollIntoView({ block: "center", behavior: "smooth" }); };
  const hideFormError = () => $("#form-error").classList.add("hidden");
  function setBusy(b) {
    $("#order-submit").disabled = b; $("#order-spinner").classList.toggle("hidden", !b);
    $("#order-submit-label").textContent = b ? "Submitting your order…" : "Place Order";
  }
  function syncPayment() {
    const m = payMethod();
    $("#bank-box").classList.toggle("hidden", m !== BANK); $("#bkash-box").classList.toggle("hidden", m !== BKASH);
    $("#txn-wrap").classList.toggle("hidden", !needsTxn());
    $("#txn-label").textContent = m === BKASH ? "bKash Transaction ID (TrxID)" : "Transaction / Reference Number";
    if (!needsTxn()) { $("#f-txn").value = ""; fieldErr("txn", ""); }
  }
  function openOrder(list, cartMode) {
    if (!list.length) return toast("Your cart is empty");
    items = list; fromCart = cartMode; // detail page (if open) stays underneath, so closing checkout returns to it
    $("#f-product").value = items.map((i) => i.p.name).join(", ");
    qtyInput.value = items.reduce((n, i) => n + i.qty, 0); qtyInput.disabled = items.length > 1 || cartMode;
    ["name", "phone", "city", "qty", "address", "txn"].forEach((k) => fieldErr(k, ""));
    renderSummary(); syncPayment(); hideFormError(); setBusy(false); openModal(order);
  }
  qtyInput.addEventListener("input", () => {
    if (items.length !== 1) return;
    const n = Number(qtyInput.value);
    if (qtyInput.value !== "" && Number.isInteger(n) && n >= 1 && n <= 99) { items[0].qty = n; renderSummary(); fieldErr("qty", ""); }
  });
  $$('input[name="pay"]').forEach((r) => r.addEventListener("change", syncPayment));
  form.addEventListener("input", (e) => { if (e.target.id && e.target.classList.contains("invalid")) fieldErr(e.target.id.slice(2), ""); });

  function validate() {
    const bad = [], chk = (k, m) => { fieldErr(k, m); if (m) bad.push(k); };
    const phone = val("#f-phone"), digits = phone.replace(/\D/g, "");
    chk("name", val("#f-name").length < 2 ? "Please enter your full name." : "");
    chk("phone", !/^\+?[\d\s\-()]+$/.test(phone) || digits.length < 8 || digits.length > 15 ? "Please enter a valid mobile number (8 to 15 digits)." : "");
    chk("city", val("#f-city").length < 2 ? "Please enter your city." : "");
    if (items.length === 1) { const n = Number(qtyInput.value); chk("qty", qtyInput.value === "" || !Number.isInteger(n) || n < 1 || n > 99 ? "Quantity must be a whole number from 1 to 99." : ""); }
    chk("address", val("#f-address").length < 8 ? "Please enter your full delivery address." : "");
    if (needsTxn()) chk("txn", !/^[A-Za-z0-9\-_/. ]{4,60}$/.test(val("#f-txn")) ? "Please enter your transaction/reference number (4-60 letters or numbers)." : "");
    return bad;
  }

  function showSuccess(done, method, txn) {
    const box = $("#success-details"); box.textContent = "";
    const tot = $("#success-total"); if (tot) tot.textContent = money(done.reduce((n, it) => n + it.p.price * it.qty, 0));
    const row = (label, value) => {
      const r = document.createElement("p"), a = document.createElement("span"), b = document.createElement("span");
      r.className = "flex justify-between gap-4 py-1"; a.className = "text-slate-500"; b.className = "break-all text-right font-medium text-ink";
      a.textContent = label; b.textContent = value; r.append(a, b); box.append(r);
    };
    done.forEach((it, i) => {
      if (i) { const hr = document.createElement("hr"); hr.className = "my-2 border-slate-200"; box.append(hr); }
      if (it.orderId) row("Order ID", it.orderId);
      row("Product", it.p.name); row("Quantity", String(it.qty)); row("Unit price", money(it.p.price)); row("Total", money(it.p.price * it.qty));
    });
    if (done.length > 1) row("Grand total", money(done.reduce((n, it) => n + it.p.price * it.qty, 0)));
    row("Payment method", method); if (txn) row("Reference number", txn);
    openModal(successModal); $("#success-continue").focus();
  }
  $("#success-continue").addEventListener("click", () => closeModal(successModal));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;
    const bad = validate();
    if (bad.length) { showFormError("Please correct the highlighted fields and try again."); return $("#f-" + bad[0]).focus(); }
    hideFormError();
    submitting = true; setBusy(true);
    const method = payMethod(), txn = needsTxn() ? val("#f-txn") : "";
    const customer = { customerName: val("#f-name"), phone: val("#f-phone"), address: val("#f-address") + ", " + val("#f-city") };
    try {
      for (const it of items) {
        if (it.orderId !== undefined) continue; // already saved during an earlier attempt - never re-send
        const res = await sendOrderToGoogleSheets(Object.assign({}, customer, {
          productName: it.p.name, quantity: it.qty, unitPrice: it.p.price,
          paymentMethod: method, transactionNumber: txn, productId: it.p.id,
        }));
        it.orderId = res.orderId;
        if (fromCart) { cart = cart.filter((c) => c.id !== it.p.id); save(); renderCart(); }
      }
    } catch (err) {
      const saved = items.filter((i) => i.orderId !== undefined).length;
      showFormError(err.message + (saved ? " " + saved + " of " + items.length + " items were already saved; pressing Place Order again only sends the rest." : " Your details are still here - please try again. If you think the order may already have been received, contact us before retrying to avoid a duplicate."));
      submitting = false; setBusy(false); return;
    }
    // Reaching this point means every order was confirmed saved by the server.
    submitting = false; setBusy(false);
    const done = items.slice();
    closeModal(order); form.reset(); syncPayment(); items = [];
    try { showSuccess(done, method, txn); }
    catch (err) { // the order IS saved - never leave the customer without a confirmation
      console.error("Success popup failed:", err);
      alert("Order placed successfully!\n" + done.map((i) => (i.orderId ? "Order ID: " + i.orderId + " - " : "") + i.p.name + " x " + i.qty).join("\n") + "\nPayment: " + method + (txn ? " (" + txn + ")" : ""));
    }
  });

  /* ---- Footer policy pop-ups (edit the text here) ---- */
  const info = {
    support: ["Customer Support", "Message us on WhatsApp or email any time. We usually reply within a few hours."],
    shipping: ["Shipping Policy", "Orders are submitted online, reviewed by our team and dispatched quickly. Delivery time and fee depend on your city."],
    returns: ["Return Policy", "If your item arrives damaged or incorrect, contact us within 3 days and we will arrange a replacement or refund."],
    privacy: ["Privacy Policy", "We only use your details to process and deliver your order. We never sell your personal information."],
    terms: ["Terms & Conditions", "By placing an order you agree to provide correct delivery details. Prices and availability may change without notice."],
  };
  $$("[data-policy]").forEach((b) => b.addEventListener("click", () => { const d = info[b.dataset.policy]; $("#info-title").textContent = d[0]; $("#info-text").textContent = d[1]; openModal($("#info-modal")); }));

  /* ---- Open the product named in the URL (?product=ID) on load / refresh ---- */
  const startId = new URLSearchParams(location.search).get("product");
  if (startId && byId(startId)) openDetail(startId, true);

  /* ---- Escape closes whatever is open ---- */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = $$(".modal.is-open"); if (open.length) closeModal(open[open.length - 1]); else closeCart();
  });
})();

/* Souqora - store logic (vanilla JS). Product data is read from index.html, so edit products there. */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const S = $("#settings").dataset;
  const money = (n) => S.currency + Number(n).toLocaleString("en-US");
  const num = (t) => parseFloat(String(t).replace(/[^\d.]/g, "")) || 0;

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
  function openModal(m) { m.classList.remove("hidden"); m.classList.add("is-open"); document.body.style.overflow = "hidden"; }
  function closeModal(m) { m.classList.add("hidden"); m.classList.remove("is-open"); if (!$(".modal.is-open") && $("#cart-drawer").getAttribute("aria-hidden") === "true") document.body.style.overflow = ""; }
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
  const detail = $("#detail-modal");
  function openDetail(id) {
    const p = byId(id);
    // Use the three optional gallery images when supplied. For old products without
    // gallery fields, keep the UI intact by falling back to existing product images.
    const gallery = [...p.gallery];
    const fallbackImages = [p.main, p.hover, p.main].filter(Boolean);
    for (const image of fallbackImages) {
      if (gallery.length >= 3) break;
      gallery.push(image);
    }
    const images = gallery.slice(0, 3);
    const firstImage = images[0] || p.main;

    $("#detail-body").innerHTML = `
      <div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div>
          <div class="flex min-h-[420px] items-center justify-center overflow-hidden rounded-3xl bg-slate-100 shadow-sm sm:min-h-[560px]">
            <img id="d-main-image" src="${firstImage}" alt="${p.name}" class="h-full max-h-[650px] w-full object-contain" width="800" height="800">
          </div>
          <div class="mt-4 grid grid-cols-3 gap-3" aria-label="Product image gallery">
            ${images.map((src, index) => `
              <button type="button" class="d-thumb overflow-hidden rounded-2xl border-2 ${index === 0 ? 'border-ink' : 'border-slate-200'} bg-slate-50 p-1 transition hover:border-ink" data-image="${src}" aria-label="View product image ${index + 1}" aria-pressed="${index === 0}">
                <img src="${src}" alt="${p.name} view ${index + 1}" class="aspect-square w-full rounded-xl object-cover" width="180" height="180">
              </button>`).join("")}
          </div>
        </div>

        <div class="flex min-h-full flex-col justify-center py-2 lg:py-6">
          <span class="text-sm font-medium text-teal-700">${p.catName}</span>
          <h2 class="mt-1 font-display text-3xl font-bold text-ink sm:text-4xl">${p.name}</h2>
          <p class="mt-3 flex items-center gap-2"><span class="text-amber-500" aria-hidden="true">${p.stars}</span><span class="font-semibold">${p.rating}</span><span class="text-slate-500">(${p.reviews} reviews)</span></p>
          <p class="mt-4 flex flex-wrap items-baseline gap-3"><span class="text-3xl font-bold text-ink">${money(p.price)}</span><s class="text-slate-500">${money(p.orig)}</s><span class="rounded-full bg-rose-600 px-2.5 py-0.5 text-sm font-bold text-white">-${p.disc}%</span></p>
          <div class="mt-5 rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h3 class="font-semibold text-ink">Product Description</h3>
            <p class="mt-2 leading-relaxed text-slate-600">${p.desc}</p>
          </div>
          <div class="mt-6 flex items-center gap-3"><span class="font-semibold">Quantity</span>
            <div class="flex items-center rounded-full border border-slate-300 bg-white"><button id="d-dec" class="h-10 w-10 text-xl" aria-label="Decrease quantity">−</button><output id="d-qty" class="w-8 text-center font-semibold">1</output><button id="d-inc" class="h-10 w-10 text-xl" aria-label="Increase quantity">+</button></div></div>
          <div class="mt-6 grid gap-3 sm:grid-cols-2">
            <button id="d-add" class="rounded-full border-2 border-ink py-3 font-semibold text-ink transition hover:bg-ink hover:text-white">Add to Cart</button>
            <button id="d-buy" class="rounded-full bg-saffron py-3 font-semibold text-ink transition hover:brightness-95">Order Now</button></div>
        </div>
      </div>`;

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
    $("#d-inc").onclick = () => { q = Math.min(99, q + 1); out.textContent = q; };
    $("#d-dec").onclick = () => { q = Math.max(1, q - 1); out.textContent = q; };
    $("#d-add").onclick = () => addToCart(id, q);
    $("#d-buy").onclick = () => openOrder([{ p, qty: q }], false);
    detail.scrollTop = 0; openModal(detail); $(".close-btn", detail).focus();
  }

  /* ---- Product card clicks ---- */
  $("#product-grid").addEventListener("click", (e) => {
    const card = e.target.closest(".product-card"); if (!card) return;
    if (e.target.closest(".btn-add")) return addToCart(card.dataset.id);
    if (e.target.closest(".btn-buy")) return openOrder([{ p: byId(card.dataset.id), qty: 1 }], false);
    if (e.target.closest("[data-open]")) openDetail(card.dataset.id);
  });
  $("#product-grid").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".img-wrap")) openDetail(e.target.closest(".product-card").dataset.id); });

  /* ---- Order form + WhatsApp ---- */
  const order = $("#order-modal"), form = $("#order-form"), qtyInput = $("#f-qty");
  let items = [], fromCart = false;
  function renderSummary() {
    const total = items.reduce((n, i) => n + i.qty * i.p.price, 0);
    $("#order-summary").innerHTML = items.map((i) => `<p class="flex justify-between gap-3 py-0.5"><span>${i.p.name} × ${i.qty}</span><span class="font-medium">${money(i.p.price * i.qty)}</span></p>`).join("") +
      `<p class="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-ink"><span>Total</span><span>${money(total)}</span></p><p class="mt-1 text-xs text-slate-500">Delivery fee will be confirmed on WhatsApp.</p>`;
    return total;
  }
  function openOrder(list, cartMode) {
    if (!list.length) return toast("Your cart is empty");
    items = list; fromCart = cartMode; closeModal(detail);
    $("#f-product").value = items.map((i) => i.p.name).join(", ");
    qtyInput.value = items.reduce((n, i) => n + i.qty, 0); qtyInput.disabled = items.length > 1 || cartMode;
    renderSummary(); $("#form-error").classList.add("hidden"); openModal(order);
  }
  qtyInput.addEventListener("input", () => { if (items.length === 1) { items[0].qty = Math.max(1, Math.min(99, parseInt(qtyInput.value) || 1)); renderSummary(); } });
  $$('input[name="pay"]').forEach((r) => r.addEventListener("change", () => $("#bkash-box").classList.toggle("hidden", $('input[name="pay"]:checked').value !== "bKash")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const req = $$("[required]", form); let ok = true;
    req.forEach((f) => { const bad = !f.value.trim(); f.classList.toggle("invalid", bad); if (bad) ok = false; });
    $("#form-error").classList.toggle("hidden", ok); if (!ok) return req.find((f) => !f.value.trim()).focus();
    const total = renderSummary(), v = (id) => $(id).value.trim();
    const msg = ["*New Order - " + S.store + "*", "", "Customer: " + v("#f-name"), "Phone: " + v("#f-phone"), "WhatsApp: " + v("#f-wa"), "",
      "Products:", ...items.map((i) => "- " + i.p.name + " | Qty: " + i.qty + " | Price: " + money(i.p.price) + " each"),
      "Total: " + money(total), "", "Address: " + v("#f-address") + ", " + v("#f-city"), "Payment: " + $('input[name="pay"]:checked').value,
      "Notes: " + (v("#f-notes") || "None")].join("\n");
    window.open("https://wa.me/" + S.whatsapp + "?text=" + encodeURIComponent(msg), "_blank", "noopener");
    if (fromCart) { cart = []; save(); renderCart(); }
    closeModal(order); form.reset(); $("#bkash-box").classList.add("hidden"); toast("Order ready - confirm it in WhatsApp");
  });

  /* ---- Footer policy pop-ups (edit the text here) ---- */
  const info = {
    support: ["Customer Support", "Message us on WhatsApp or email any time. We usually reply within a few hours."],
    shipping: ["Shipping Policy", "Orders are confirmed on WhatsApp, then dispatched quickly. Delivery time and fee depend on your city."],
    returns: ["Return Policy", "If your item arrives damaged or incorrect, contact us within 3 days and we will arrange a replacement or refund."],
    privacy: ["Privacy Policy", "We only use your details to process and deliver your order. We never sell your personal information."],
    terms: ["Terms & Conditions", "By placing an order you agree to provide correct delivery details. Prices and availability may change without notice."],
  };
  $$("[data-policy]").forEach((b) => b.addEventListener("click", () => { const d = info[b.dataset.policy]; $("#info-title").textContent = d[0]; $("#info-text").textContent = d[1]; openModal($("#info-modal")); }));

  /* ---- Escape closes whatever is open ---- */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = $$(".modal.is-open"); if (open.length) closeModal(open[open.length - 1]); else closeCart();
  });
})();

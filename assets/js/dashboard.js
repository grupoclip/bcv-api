(function () {
  const formatRate = (n) =>
    new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 8,
    }).format(n);

  const formatDateTime = (iso) =>
    new Intl.DateTimeFormat(LOCALE, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Caracas",
    }).format(new Date(iso));

  const formatDate = (iso) =>
    new Intl.DateTimeFormat(LOCALE, { dateStyle: "long" }).format(
      new Date(iso + "T12:00:00")
    );

  async function load() {
    const grid = document.getElementById("grid");
    const meta = document.getElementById("meta");
    try {
      const res = await fetch(RATE_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      meta.innerHTML =
        "<span>" +
        STRINGS.date +
        ": <strong>" +
        formatDate(data.date) +
        "</strong></span>" +
        "<span>" +
        STRINGS.updated +
        ": <strong>" +
        formatDateTime(data.updated_at) +
        "</strong> " +
        STRINGS.zone +
        "</span>";

      grid.innerHTML = "";
      for (const code of Object.keys(CURRENCY_NAMES)) {
        if (typeof data[code] !== "number") continue;
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML =
          '<div class="code">' +
          code +
          "</div>" +
          '<div class="name">' +
          CURRENCY_NAMES[code] +
          "</div>" +
          '<div class="value">' +
          formatRate(data[code]) +
          '<span class="unit">Bs.</span></div>';
        grid.appendChild(card);
      }
    } catch (err) {
      grid.innerHTML =
        '<div class="error">' + STRINGS.error + " " + err.message + "</div>";
    }
  }

  load();
})();

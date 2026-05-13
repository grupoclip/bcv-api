(function () {
  const api = navigator.modelContext;
  if (!api || typeof api.provideContext !== "function") return;

  const json = async (path) => {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  };

  const validCurrency = (value) =>
    ["USD", "EUR", "CNY", "TRY", "RUB"].includes(String(value || "").toUpperCase());

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  const tools = [
    {
      name: "get_latest_bcv_rates",
      description:
        "Fetch the latest public unauthenticated BCV Today exchange-rate JSON for USD, EUR, CNY, TRY and RUB against VES.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => json("/api/v1/rate.json"),
    },
    {
      name: "get_bcv_api_status",
      description:
        "Fetch BCV Today API freshness, effective date, supported currencies and endpoint status.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => json("/api/v1/status.json"),
    },
    {
      name: "get_bcv_rate_history",
      description:
        "Fetch recent daily BCV exchange-rate history, optionally filtered to a supported currency code.",
      inputSchema: {
        type: "object",
        properties: {
          currency: {
            type: "string",
            enum: ["USD", "EUR", "CNY", "TRY", "RUB"],
            description: "Optional currency code to project from each history entry.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            description: "Optional maximum number of latest entries to return.",
          },
        },
        additionalProperties: false,
      },
      execute: async ({ currency, limit } = {}) => {
        const data = await json("/api/v1/history.json");
        const code = currency ? String(currency).toUpperCase() : "";
        if (code && !validCurrency(code)) {
          throw new Error("Unsupported currency: " + currency);
        }

        const size = Number.isInteger(limit)
          ? Math.min(Math.max(limit, 1), 365)
          : data.length;
        const entries = data.slice(-size);

        if (!code) return entries;
        return entries.map((entry) => ({
          date: entry.date,
          effective_date: entry.effective_date,
          updated_at: entry.updated_at,
          currency: code,
          value: entry[code],
          source: entry.source,
        }));
      },
    },
    {
      name: "get_bcv_rate_by_date",
      description:
        "Fetch one public BCV Today dated exchange-rate snapshot by YYYY-MM-DD date.",
      inputSchema: {
        type: "object",
        required: ["date"],
        properties: {
          date: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}$",
            description: "Calendar date in YYYY-MM-DD format.",
          },
        },
        additionalProperties: false,
      },
      execute: async ({ date } = {}) => {
        if (!datePattern.test(String(date || ""))) {
          throw new Error("date must use YYYY-MM-DD format");
        }
        return json("/api/v1/history/" + date + ".json");
      },
    },
    {
      name: "open_bcv_api_docs",
      description: "Navigate the current page to the BCV Today API documentation.",
      inputSchema: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["es", "en"],
            description: "Documentation language.",
          },
        },
        additionalProperties: false,
      },
      execute: ({ language } = {}) => {
        const path = language === "en" ? "/en/api/" : "/api/";
        window.location.assign(path);
        return { navigated: true, url: location.origin + path };
      },
    },
  ];

  try {
    api.provideContext({
      name: "BCV Today",
      description:
        "Public unauthenticated tools for official Banco Central de Venezuela exchange rates mirrored by BCV Today.",
      tools,
    });
  } catch (error) {
    console.warn("WebMCP registration failed", error);
  }
})();

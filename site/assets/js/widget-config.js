// Widget configurator (/widget/ and /en/widget/).
//
// Progressive enhancement: without JS the form and the preview stay hidden
// and the page shows the static default snippet. With JS, every change in
// the form rebuilds the live <bcv-rate> preview and the generated HTML,
// which lists only the attributes that differ from the widget's defaults.
// The copy button comes from code-copy.js (it copies the code's text at
// click time, so updating the text here is enough).
(function () {
  var root = document.querySelector("[data-wcfg]");
  if (!root) return;
  var form = root.querySelector("[data-wcfg-form]");
  var previewBox = root.querySelector("[data-wcfg-preview]");
  var stage = root.querySelector("[data-wcfg-stage]");
  var code = root.querySelector("[data-wcfg-code] code");
  var notice = root.querySelector("[data-wcfg-notice]");
  var amountField = root.querySelector("[data-wcfg-amount]");
  var noJs = root.querySelector("[data-wcfg-nojs]");
  if (!form || !previewBox || !stage || !code) return;

  var SRC = root.getAttribute("data-src");
  var pageLang = /^en/i.test(document.documentElement.lang) ? "en" : "es";

  // Sample sentences for the inline ("line") variant, per language.
  var SENTENCES = {
    es: {
      USD: ["El dólar BCV está en", "hoy."],
      EUR: ["El euro BCV está en", "hoy."],
      CNY: ["El yuan BCV está en", "hoy."],
      TRY: ["La lira turca BCV está en", "hoy."],
      RUB: ["El rublo BCV está en", "hoy."]
    },
    en: {
      USD: ["The BCV dollar is at", "today."],
      EUR: ["The BCV euro is at", "today."],
      CNY: ["The BCV yuan is at", "today."],
      TRY: ["The BCV Turkish lira is at", "today."],
      RUB: ["The BCV ruble is at", "today."]
    }
  };

  function read() {
    var d = new FormData(form);
    var raw = String(d.get("amount") || "").trim();
    var n = Number(raw);
    return {
      currency: String(d.get("currency") || "USD"),
      variant: String(d.get("variant") || "card"),
      lang: String(d.get("lang") || "page"),
      theme: String(d.get("theme") || "auto"),
      // A plain number, as the attribute expects; anything else is left out
      // and the widget uses its default (1).
      amount: raw !== "" && isFinite(n) && n > 0 ? String(n) : "",
      hide: d.get("hide-source") !== null
    };
  }

  // Attributes that differ from the defaults, in the README's order.
  // A null value is a boolean attribute.
  function attrs(s) {
    var a = [];
    if (s.currency !== "USD") a.push(["currency", s.currency]);
    if (s.variant !== "card") a.push(["variant", s.variant]);
    if (s.lang !== "page") a.push(["lang", s.lang]);
    if (s.theme !== "auto") a.push(["theme", s.theme]);
    if (s.variant === "converter" && s.amount && s.amount !== "1") a.push(["amount", s.amount]);
    if (s.hide) a.push(["hide-source", null]);
    return a;
  }

  // Highlighted HTML, with the same token classes Rouge uses on the site.
  function tok(cls, text) {
    var el = document.createElement("span");
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function tag(name, list, inner) {
    var out = [tok("nt", "<" + name)];
    list.forEach(function (pair) {
      out.push(" ");
      if (pair[1] === null) {
        out.push(tok("na", pair[0]));
      } else {
        out.push(tok("na", pair[0] + "="), tok("s", '"' + pair[1] + '"'));
      }
    });
    out.push(tok("nt", ">"));
    return out.concat(inner, [tok("nt", "</" + name + ">")]);
  }

  var last = "";

  function render() {
    var s = read();
    var key = JSON.stringify(s);
    if (key === last) return;
    last = key;

    var list = attrs(s);
    var sentenceLang = s.lang === "page" ? pageLang : s.lang;
    var sentence = SENTENCES[sentenceLang][s.currency] || SENTENCES[sentenceLang].USD;
    var isLine = s.variant === "line";

    if (amountField) amountField.hidden = s.variant !== "converter";
    if (notice) notice.hidden = !s.hide;

    // Generated code.
    var widgetCode = tag("bcv-rate", list, []);
    var body = isLine
      ? tag("p", [], [sentence[0] + " "].concat(widgetCode, [" " + sentence[1]]))
      : widgetCode;
    code.replaceChildren.apply(code, tag("script", [["type", "module"], ["src", SRC]], []).concat(["\n"], body));

    // Live preview: the real element. This site is light only, so "auto"
    // previews in light; "dark" is shown on a dark sample frame.
    var widget = document.createElement("bcv-rate");
    list.forEach(function (pair) {
      widget.setAttribute(pair[0], pair[1] === null ? "" : pair[1]);
    });
    if (s.theme === "auto") widget.setAttribute("theme", "light");
    stage.classList.toggle("is-dark", s.theme === "dark");

    var node = widget;
    if (isLine) {
      node = document.createElement("p");
      node.className = "wcfg-sentence";
      if (sentenceLang !== pageLang) node.lang = sentenceLang;
      node.append(sentence[0] + " ", widget, " " + sentence[1]);
    }
    stage.classList.toggle("is-line", isLine);
    stage.replaceChildren(node);
  }

  form.addEventListener("input", render);
  form.addEventListener("change", render);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
  });

  form.hidden = false;
  previewBox.hidden = false;
  if (noJs) noJs.hidden = true;
  root.classList.add("is-enhanced");
  render();
})();

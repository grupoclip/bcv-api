(function () {
  const isEn = document.documentElement.lang === "en";
  const copyText = isEn ? "Copy" : "Copiar";
  const copiedText = isEn ? "Copied" : "Copiado";
  const failedText = isEn ? "Copy failed" : "No se pudo copiar";
  const SVG_NS = "http://www.w3.org/2000/svg";

  function copyIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "ui-icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS(SVG_NS, "rect");
    for (const [k, v] of [["x", "9"], ["y", "9"], ["width", "11"], ["height", "11"], ["rx", "2"]]) {
      rect.setAttribute(k, v);
    }
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1");
    svg.append(rect, path);
    return svg;
  }

  function enhance(block) {
    if (block.dataset.copyReady === "true") return;
    const code = block.querySelector("pre code");
    if (!code) return;

    block.dataset.copyReady = "true";
    block.classList.add("copy-code-block");

    // Visible text names the button; no aria-label needed.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code-button";
    const label = document.createElement("span");
    label.dataset.copyText = "";
    label.textContent = copyText;
    button.append(copyIcon(), label);

    // Live region lives outside the button: children of a button are
    // presentational, so announcements inside it are unreliable.
    const status = document.createElement("span");
    status.className = "visually-hidden";
    status.setAttribute("role", "status");

    let timer;
    button.addEventListener("click", async () => {
      window.clearTimeout(timer);
      let ok = true;
      try {
        await navigator.clipboard.writeText(code.textContent.trimEnd());
      } catch (error) {
        ok = false;
      }
      const message = ok ? copiedText : failedText;
      label.textContent = message;
      button.classList.toggle("is-copied", ok);
      // Clear, then set after a tick so repeated copies are announced again.
      status.textContent = "";
      window.setTimeout(() => (status.textContent = message), 50);

      timer = window.setTimeout(() => {
        label.textContent = copyText;
        button.classList.remove("is-copied");
        status.textContent = "";
      }, 1400);
    });

    block.append(button, status);
  }

  document.querySelectorAll("div.highlight").forEach(enhance);
})();

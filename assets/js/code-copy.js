(function () {
  const copiedText = document.documentElement.lang === "en" ? "Copied" : "Copiado";
  const copyText = document.documentElement.lang === "en" ? "Copy" : "Copiar";

  async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }

  function enhance(block) {
    if (block.dataset.copyReady === "true") return;
    const code = block.querySelector("pre code");
    if (!code) return;

    block.dataset.copyReady = "true";
    block.classList.add("copy-code-block");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code-button";
    button.setAttribute("aria-label", copyText);
    button.innerHTML =
      '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="9" y="9" width="11" height="11" rx="2" />' +
      '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />' +
      "</svg>" +
      '<span data-copy-text>' +
      copyText +
      "</span>";
    const label = button.querySelector("[data-copy-text]");

    button.addEventListener("click", async () => {
      const original = label.textContent;
      try {
        await copyToClipboard(code.innerText.trimEnd());
        label.textContent = copiedText;
        button.classList.add("is-copied");
      } catch (error) {
        label.textContent = copyText;
      }

      window.setTimeout(() => {
        label.textContent = original;
        button.classList.remove("is-copied");
      }, 1400);
    });

    block.appendChild(button);
  }

  document.querySelectorAll("div.highlight").forEach(enhance);
})();

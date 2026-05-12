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
    button.textContent = copyText;
    button.setAttribute("aria-label", copyText);

    button.addEventListener("click", async () => {
      const original = button.textContent;
      try {
        await copyToClipboard(code.innerText.trimEnd());
        button.textContent = copiedText;
        button.classList.add("is-copied");
      } catch (error) {
        button.textContent = copyText;
      }

      window.setTimeout(() => {
        button.textContent = original;
        button.classList.remove("is-copied");
      }, 1400);
    });

    block.appendChild(button);
  }

  document.querySelectorAll("div.highlight").forEach(enhance);
})();

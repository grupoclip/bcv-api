(function () {
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

  function setLabel(button, label) {
    const text = button.querySelector("[data-share-text]");
    if (text) {
      text.textContent = label;
    } else {
      button.textContent = label;
    }
  }

  function resetLabel(button) {
    window.clearTimeout(button._shareResetTimer);
    button._shareResetTimer = window.setTimeout(() => {
      setLabel(button, button.dataset.shareLabel);
      button.classList.remove("is-copied");
    }, 1600);
  }

  async function handleShare(event) {
    event.preventDefault();
    const button = event.currentTarget;
    const url = button.dataset.shareUrl || button.getAttribute("href") || location.href;
    const title = button.dataset.shareTitle || document.title;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
      }
    }

    try {
      await copyToClipboard(url);
      setLabel(button, button.dataset.shareCopied);
      button.classList.add("is-copied");
    } catch (error) {
      setLabel(button, button.dataset.shareFailed);
    }

    resetLabel(button);
  }

  document.querySelectorAll("[data-share-button]").forEach((button) => {
    if (button.dataset.shareReady === "true") return;
    button.dataset.shareReady = "true";
    button.addEventListener("click", handleShare);
  });
})();

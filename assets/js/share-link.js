(function () {
  function setLabel(button, label) {
    const text = button.querySelector("[data-share-text]");
    if (text) {
      text.textContent = label;
    } else {
      button.textContent = label;
    }
  }

  // Live region outside the button, so the result is announced reliably.
  function statusFor(button) {
    if (!button._shareStatus) {
      const status = document.createElement("span");
      status.className = "visually-hidden";
      status.setAttribute("role", "status");
      button.after(status);
      button._shareStatus = status;
    }
    return button._shareStatus;
  }

  function announce(button, message) {
    const status = statusFor(button);
    // Clear, then set after a tick so repeated shares are announced again.
    status.textContent = "";
    window.setTimeout(() => (status.textContent = message), 50);
  }

  function resetLabel(button) {
    window.clearTimeout(button._shareResetTimer);
    button._shareResetTimer = window.setTimeout(() => {
      setLabel(button, button.dataset.shareLabel);
      button.classList.remove("is-copied");
      statusFor(button).textContent = "";
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

    let message;
    try {
      await navigator.clipboard.writeText(url);
      message = button.dataset.shareCopied;
      button.classList.add("is-copied");
    } catch (error) {
      message = button.dataset.shareFailed;
    }
    setLabel(button, message);
    announce(button, message);
    resetLabel(button);
  }

  document.querySelectorAll("[data-share-button]").forEach((button) => {
    if (button.dataset.shareReady === "true") return;
    button.dataset.shareReady = "true";
    // Visible text is the accessible name; drop any stale aria-label.
    button.removeAttribute("aria-label");
    if (!button.dataset.shareLabel) button.dataset.shareLabel = button.textContent.trim();
    setLabel(button, button.dataset.shareLabel);
    button.addEventListener("click", handleShare);
  });
})();

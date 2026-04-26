function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
  });
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function limitMinutesFromValue(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object") {
    return Number(value.minutes || 0);
  }
  return 0;
}

function createChallenge() {
  const a = Math.floor(Math.random() * 7) + 3;
  const b = Math.floor(Math.random() * 7) + 4;
  return {
    prompt: `${a} + ${b} = ?`,
    answer: String(a + b)
  };
}

async function render() {
  const params = new URLSearchParams(window.location.search);
  const domain = params.get("domain") || "Blocked site";
  const reason = params.get("reason") || "focus";
  document.getElementById("blockedDomain").textContent = domain;
  const reasonNode = document.getElementById("blockReason");

  const stats = await sendMessage({ action: "getStats" });
  const timerNode = document.getElementById("timer");
  const endFocusBtn = document.getElementById("endFocusBtn");

  if (reason === "limit") {
    reasonNode.textContent = "Daily limit reached for this site.";
    const minutes = limitMinutesFromValue((stats.siteLimits || {})[domain]);
    timerNode.textContent = minutes ? `${minutes}m limit hit` : "Limit reached";
    endFocusBtn.style.display = "none";
    return;
  }

  reasonNode.textContent = "Blocked during active focus session.";
  const remaining = Math.floor(((stats.focusState && stats.focusState.remainingMs) || 0) / 1000);
  timerNode.textContent = formatClock(remaining);

  if (!stats.focusMode) {
    window.location.href = "https://www.google.com";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const reason = params.get("reason") || "focus";
  const domain = params.get("domain") || "";
  const fallbackTabId = params.get("fallbackTabId") || "";
  const sourceUrl = params.get("sourceUrl") || "";
  const challengeCard = document.getElementById("limitChallenge");
  const challengePrompt = document.getElementById("challengePrompt");
  const challengeInput = document.getElementById("challengeInput");
  const challengeMessage = document.getElementById("challengeMessage");
  const unlockBtn = document.getElementById("unlockBtn");
  const challenge = createChallenge();
  const bubble = document.getElementById("coachBubble");
  const tips = [
    "Look 20 feet away for 20 seconds.",
    "Stand up and stretch your back.",
    "Walk for one minute and breathe.",
    "Grab water or coffee, then continue."
  ];
  let tipIndex = 0;

  if (reason === "limit") {
    challengeCard.hidden = false;
    challengePrompt.textContent = challenge.prompt;
  }

  async function returnBackWithValidation() {
    const button = document.getElementById("backBtn");
    if (reason === "limit") {
      const inputAnswer = String(challengeInput.value || "").trim();
      if (inputAnswer !== challenge.answer) {
        challengeMessage.textContent = "Wrong answer. Please solve the challenge first.";
        return;
      }
      challengeMessage.textContent = "Challenge solved. Reopening page...";
    }

    button.disabled = true;
    button.textContent = "Returning...";
    const result = await sendMessage({
      action: "recoverFromBlockedPage",
      data: {
        reason,
        domain,
        fallbackTabId,
        sourceUrl,
        unlockApproved: true
      }
    });

    if (!result.success && result.requireChallenge) {
      challengeMessage.textContent = "Solve the challenge to continue.";
    }

    setTimeout(() => {
      button.disabled = false;
      button.textContent = "Return Back";
    }, 1200);
  }

  document.getElementById("backBtn").addEventListener("click", (event) => {
    event.preventDefault();
    returnBackWithValidation();
  });

  unlockBtn.addEventListener("click", (event) => {
    event.preventDefault();
    returnBackWithValidation();
  });

  document.getElementById("endFocusBtn").addEventListener("click", async () => {
    await sendMessage({ action: "stopFocusMode" });
    window.location.href = "https://www.google.com";
  });

  render();
  setInterval(render, 1000);
  setInterval(() => {
    tipIndex = (tipIndex + 1) % tips.length;
    bubble.textContent = tips[tipIndex];
  }, 3500);
});

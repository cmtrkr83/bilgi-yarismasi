const joinCard = document.getElementById("joinCard");
const liveCard = document.getElementById("liveCard");
const participantPanel = document.getElementById("participantPanel");
const participantStatusCard = document.querySelector(".participant-status-card");
const joinCode = document.getElementById("joinCode");
const joinName = document.getElementById("joinName");
const joinBtn = document.getElementById("joinBtn");
const joinMessage = document.getElementById("joinMessage");
const participantStatusTitle = document.getElementById("participantStatusTitle");
const participantStatusMessage = document.getElementById("participantStatusMessage");
const questionText = document.getElementById("questionText");
const answerArea = document.getElementById("answerArea");
const confirmModal = document.getElementById("confirmModal");
const confirmModalBackdrop = document.getElementById("confirmModalBackdrop");
const confirmText = document.getElementById("confirmText");
const confirmSendBtn = document.getElementById("confirmSendBtn");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
const rejectionPanel = document.getElementById("rejectionPanel");
const rejectionMessage = document.getElementById("rejectionMessage");
const participantTimer = document.getElementById("participantTimer");
const participantTimerValue = document.getElementById("participantTimerValue");
const participantQuestionMediaWrap = document.getElementById("participantQuestionMediaWrap");
const participantQuestionMediaImage = document.getElementById("participantQuestionMediaImage");

let participantId = null;
let latestQuestionId = null;
let pendingAnswer = null;
let timerDeadline = null;
let timerRef = null;
let celebrationLayer = null;
let answeredQuestionId = null;

function wsUrl(id) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}${id ? `/?participantId=${id}` : ""}`;
}

async function api(path, method = "GET", body = null) {
  const result = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null,
  });
  const json = await result.json();
  if (!result.ok) {
    throw new Error(json.error || "İstek başarısız");
  }
  return json;
}

function showJoinMessage(text) {
  joinMessage.textContent = text;
  joinMessage.classList.remove("hidden");
}

function setStatusCard(title, message) {
  participantStatusTitle.textContent = title;
  participantStatusMessage.textContent = message;
}

function showStatusCard() {
  participantStatusCard.classList.add("participant-status-card--visible");
  participantStatusCard.classList.remove("hidden");
}

function hideStatusCard() {
  participantStatusCard.classList.remove("participant-status-card--visible");
  participantStatusCard.classList.add("hidden");
}

function clearCelebration() {
  participantPanel.classList.remove("celebration-active");
  if (celebrationLayer) {
    celebrationLayer.remove();
    celebrationLayer = null;
  }
}

function startCelebration() {
  if (celebrationLayer) {
    return;
  }

  participantPanel.classList.add("celebration-active");
  celebrationLayer = document.createElement("div");
  celebrationLayer.className = "celebration-layer";

  const colors = ["#ff4f6d", "#00b0ff", "#13db77", "#ffd24a", "#ffffff", "#cc77ff"];
  const pieces = 28;

  for (let index = 0; index < pieces; index += 1) {
    const piece = document.createElement("span");
    const color = colors[index % colors.length];
    const left = Math.random() * 100;
    const duration = 2.8 + Math.random() * 1.8;
    const delay = Math.random() * 0.8;
    const size = 8 + Math.random() * 10;
    piece.className = "celebration-piece";
    piece.style.left = `${left}%`;
    piece.style.background = color;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * (0.55 + Math.random() * 0.35)}px`;
    piece.style.animationDuration = `${duration}s`;
    piece.style.animationDelay = `${delay}s`;
    piece.style.transform = `rotate(${Math.random() * 180}deg)`;
    celebrationLayer.appendChild(piece);
  }

  participantPanel.appendChild(celebrationLayer);
}

function resetAnswerConfirmation() {
  pendingAnswer = null;
  confirmText.textContent = "";
  confirmModal.classList.add("hidden");
  confirmModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function askAnswerConfirmation(answer) {
  pendingAnswer = String(answer || "").trim();
  if (!pendingAnswer) {
    return;
  }

  confirmText.textContent = `Cevabınız: ${pendingAnswer}`;
  confirmModal.classList.remove("hidden");
  confirmModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function stopTimer() {
  timerDeadline = null;
  if (timerRef) {
    clearInterval(timerRef);
    timerRef = null;
  }
  participantTimer.classList.add("hidden");
  participantTimer.classList.remove("danger");
}

function tickTimer() {
  if (!timerDeadline) {
    stopTimer();
    return;
  }

  const remainingMs = Math.max(0, timerDeadline - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  participantTimerValue.textContent = `${remainingSeconds} sn`;
  participantTimer.classList.toggle("danger", remainingSeconds <= 5);

  if (remainingMs <= 0 && timerRef) {
    clearInterval(timerRef);
    timerRef = null;
  }
}

function startTimer(deadline) {
  if (!deadline) {
    stopTimer();
    return;
  }

  if (timerDeadline === deadline && timerRef) {
    return;
  }

  timerDeadline = deadline;
  if (timerRef) {
    clearInterval(timerRef);
  }
  participantTimer.classList.remove("hidden");
  tickTimer();
  timerRef = setInterval(tickTimer, 100);
}

function renderQuestionImage(imageUrl) {
  if (!imageUrl) {
    participantQuestionMediaImage.removeAttribute("src");
    participantQuestionMediaWrap.classList.add("hidden");
    return;
  }

  participantQuestionMediaImage.src = imageUrl;
  participantQuestionMediaWrap.classList.remove("hidden");
}

function renderAnswerArea(snapshot) {
  answerArea.innerHTML = "";
  resetAnswerConfirmation();

  if (!snapshot.activeQuestion) {
    questionText.textContent = "";
    renderQuestionImage("");
    return;
  }

  latestQuestionId = snapshot.activeQuestion.id;
  questionText.textContent = snapshot.activeQuestion.text;
  renderQuestionImage(snapshot.activeQuestion.imageUrl || "");

  if (snapshot.activeQuestion.type === "mcq") {
    const wrap = document.createElement("div");
    wrap.className = "options";
    snapshot.activeQuestion.options.forEach((option) => {
      const btn = document.createElement("button");
      btn.className = "option";
      btn.textContent = option;
      btn.onclick = () => askAnswerConfirmation(option);
      wrap.appendChild(btn);
    });
    answerArea.appendChild(wrap);
    return;
  }

  const text = document.createElement("input");
  text.placeholder = "Cevabın";

  const send = document.createElement("button");
  send.textContent = "Devam Et";
  send.className = "secondary";
  send.onclick = () => askAnswerConfirmation(text.value);

  answerArea.appendChild(text);
  answerArea.appendChild(send);
}

function showAnsweredWaitingState() {
  stopTimer();
  timerDeadline = null;
  liveCard.classList.remove("question-state");
  showStatusCard();
  participantStatusCard.classList.remove("participant-status-card--done");
  setStatusCard("Cevabınız gönderildi.", "Sonraki soru bekleniyor.");
  questionText.textContent = "";
  renderQuestionImage("");
  answerArea.innerHTML = "";
  resetAnswerConfirmation();
}

async function submitAnswer(answer) {
  if (!latestQuestionId || !participantId) {
    return false;
  }

  try {
    await api("/api/participant/answer", "POST", {
      participantId,
      answer,
    });
    answeredQuestionId = latestQuestionId;
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

confirmSendBtn.onclick = async () => {
  if (!pendingAnswer) {
    return;
  }
  const submitted = await submitAnswer(pendingAnswer);
  if (submitted) {
    showAnsweredWaitingState();
    return;
  }
  resetAnswerConfirmation();
};

confirmCancelBtn.onclick = () => {
  resetAnswerConfirmation();
};

confirmModalBackdrop.onclick = () => {
  resetAnswerConfirmation();
};

function render(snapshot) {
  if (!participantId || !snapshot.hasSession) {
    return;
  }

  const activeQuestionId = snapshot.activeQuestion?.id || null;
  if (activeQuestionId && answeredQuestionId && activeQuestionId !== answeredQuestionId) {
    answeredQuestionId = null;
  }

  joinCard.classList.add("hidden");
  liveCard.classList.remove("hidden");
  participantPanel.classList.add("has-live-state");

  if (!snapshot.participant) {
    stopTimer();
    liveCard.classList.remove("question-state");
    clearCelebration();
    showStatusCard();
    participantStatusCard.classList.remove("participant-status-card--done");
    setStatusCard("Yarışmadan Çıkarıldınız", "Yönetici sizi yarışmadan çıkardı.");
    rejectionMessage.textContent = "Yönetici sizi yarışmadan çıkardı.";
    rejectionPanel.classList.remove("hidden");
    questionText.textContent = "";
    renderQuestionImage("");
    answerArea.innerHTML = "";
    resetAnswerConfirmation();
    return;
  }

  rejectionPanel.classList.add("hidden");
  const approvalState = Number(snapshot.participant.approved);

  if (approvalState === 0) {
    stopTimer();
    liveCard.classList.remove("question-state");
    clearCelebration();
    showStatusCard();
    participantStatusCard.classList.remove("participant-status-card--done");
    setStatusCard("Yarışma katılımınız yapıldı.", "Yönetici onayı bekleniyor.");
    questionText.textContent = "";
    renderQuestionImage("");
    answerArea.innerHTML = "";
    resetAnswerConfirmation();
    return;
  }

  if (approvalState === -1) {
    stopTimer();
    liveCard.classList.remove("question-state");
    clearCelebration();
    showStatusCard();
    participantStatusCard.classList.remove("participant-status-card--done");
    setStatusCard("Katılım Reddedildi", "Yönetici yarışmaya katılımınızı onaylamadı.");
    rejectionMessage.textContent = "Yönetici yarışmaya katılımınızı onaylamadı.";
    rejectionPanel.classList.remove("hidden");
    questionText.textContent = "";
    renderQuestionImage("");
    answerArea.innerHTML = "";
    resetAnswerConfirmation();
    return;
  }

  if (snapshot.status !== "question_live") {
    answeredQuestionId = null;
    stopTimer();
    liveCard.classList.remove("question-state");
    showStatusCard();
    participantStatusCard.classList.remove("participant-status-card--done");

    if (snapshot.status === "finished") {
      setStatusCard("Yarışma tamamlandı.", "Soruların tamamı gönderildi.");
      participantStatusCard.classList.add("participant-status-card--done");
      startCelebration();
    } else if (snapshot.status === "lobby" && approvalState === 1) {
      clearCelebration();
      setStatusCard("Yarışma katılımınız onaylandı.", "Sorular bekleniyor.");
    } else if (snapshot.status === "between_questions") {
      clearCelebration();
      setStatusCard("Sonraki soru bekleniyor.", "Bir sonraki soru kısa süre sonra gelecek.");
    } else {
      clearCelebration();
      setStatusCard("Bekleme Modu", "Yeni soru birazdan paylaşılacak, hazır kal.");
    }

    questionText.textContent = "";
    renderQuestionImage("");
    answerArea.innerHTML = "";
    resetAnswerConfirmation();
    return;
  }

  if (answeredQuestionId && activeQuestionId === answeredQuestionId) {
    showAnsweredWaitingState();
    return;
  }

  hideStatusCard();
  clearCelebration();
  rejectionPanel.classList.add("hidden");
  liveCard.classList.add("question-state");
  const secondsRemaining = snapshot.activeQuestion?.secondsRemaining || 0;
  const deadline = secondsRemaining > 0 ? Date.now() + secondsRemaining * 1000 : null;
  startTimer(deadline);
  renderAnswerArea(snapshot);
}

function connectSocket() {
  const socket = new WebSocket(wsUrl(participantId));
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      render(msg.payload);
    }
  };
}

joinBtn.onclick = async () => {
  try {
    const data = await api("/api/participant/join", "POST", {
      code: joinCode.value.toUpperCase(),
      name: joinName.value,
    });
    participantId = data.participantId;
    showJoinMessage("Katılım talebin alındı. Yönetici onayı bekleniyor...");
    connectSocket();
  } catch (err) {
    showJoinMessage(err.message);
  }
};
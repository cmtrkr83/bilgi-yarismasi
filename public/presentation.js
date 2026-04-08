const quizTitle = document.getElementById("quizTitle");
const statusLine = document.getElementById("statusLine");
const questionText = document.getElementById("questionText");
const questionOptions = document.getElementById("questionOptions");
const scoreRows = document.getElementById("scoreRows");
const questionCard = document.getElementById("questionCard");
const leaderboardCard = document.getElementById("leaderboardCard");
const answerStatusList = document.getElementById("answerStatusList");
const presentationTimer = document.getElementById("presentationTimer");
const presentationTimerValue = document.getElementById("presentationTimerValue");
const questionMediaWrap = document.getElementById("questionMediaWrap");
const questionMediaImage = document.getElementById("questionMediaImage");

let timerDeadline = null;
let timerRef = null;

function stopTimer() {
  timerDeadline = null;
  if (timerRef) {
    clearInterval(timerRef);
    timerRef = null;
  }
  presentationTimer.classList.add("hidden");
  presentationTimer.classList.remove("danger");
}

function tickTimer() {
  if (!timerDeadline) {
    stopTimer();
    return;
  }
  const remainingMs = Math.max(0, timerDeadline - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  presentationTimerValue.textContent = `${remainingSeconds} sn`;
  presentationTimer.classList.toggle("danger", remainingSeconds <= 5);

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
  presentationTimer.classList.remove("hidden");
  tickTimer();
  timerRef = setInterval(tickTimer, 100);
}

function setQuestionMode(isQuestionLive, deadline) {
  questionCard.classList.toggle("hidden", !isQuestionLive);
  leaderboardCard.classList.toggle("hidden", isQuestionLive);
  if (isQuestionLive) {
    startTimer(deadline || null);
    return;
  }
  stopTimer();
}

function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

function statusMessage(status) {
  if (status === "lobby") return "Katılımcılar bekleniyor...";
  if (status === "question_live") return "Soru aktif";
  if (status === "between_questions") return "Sonraki soru için hazırlanın";
  if (status === "finished") return "Yarışma tamamlandı";
  return "Bekleniyor";
}

function medalByRank(rank) {
  if (rank === 0) return "🥇 ";
  if (rank === 1) return "🥈 ";
  if (rank === 2) return "🥉 ";
  return "";
}

function renderQuestionImage(imageUrl) {
  if (!imageUrl) {
    questionMediaImage.removeAttribute("src");
    questionMediaWrap.classList.add("hidden");
    return;
  }

  questionMediaImage.src = imageUrl;
  questionMediaWrap.classList.remove("hidden");
}

function render(snapshot) {
  if (!snapshot.hasSession) {
    quizTitle.textContent = "Bilgi Yarışması";
    statusLine.textContent = "Yönetici bir yarışmayı yayına almadı.";
    questionText.textContent = "";
    renderQuestionImage("");
    questionOptions.innerHTML = "";
    answerStatusList.innerHTML = "";
    scoreRows.innerHTML = "";
    questionCard.classList.add("hidden");
    leaderboardCard.classList.remove("hidden");
    stopTimer();
    return;
  }

  quizTitle.textContent = snapshot.quizTitle;
  statusLine.textContent = statusMessage(snapshot.status);

  const isQuestionLive = snapshot.status === "question_live" && !!snapshot.activeQuestion;
  const secondsRemaining = snapshot.activeQuestion?.secondsRemaining || 0;
  const deadline = secondsRemaining > 0 ? Date.now() + secondsRemaining * 1000 : null;
  setQuestionMode(isQuestionLive, deadline);

  if (isQuestionLive) {
    questionText.textContent = snapshot.activeQuestion.text;
    renderQuestionImage(snapshot.activeQuestion.imageUrl || "");
    questionOptions.innerHTML = "";
    if (snapshot.activeQuestion.type === "mcq") {
      snapshot.activeQuestion.options.forEach((option) => {
        const div = document.createElement("div");
        div.className = "option";
        div.textContent = option;
        questionOptions.appendChild(div);
      });
    }

    renderAnswerStatuses(snapshot);
  } else {
    questionText.textContent = "Soru gelene kadar bekleme ekranındasınız.";
    renderQuestionImage("");
    questionOptions.innerHTML = "";
    answerStatusList.innerHTML = "";
  }

  scoreRows.innerHTML = "";
  snapshot.leaderboard.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${idx + 1}</td><td>${medalByRank(idx)}${row.name}</td><td>${row.score}</td>`;
    scoreRows.appendChild(tr);
  });
}

function renderAnswerStatuses(snapshot) {
  answerStatusList.innerHTML = "";
  const participants = Array.isArray(snapshot.participants) ? snapshot.participants : [];
  const answeredSet = new Set(snapshot.activeQuestion?.answeredParticipantIds || []);
  const isQuestionLive = snapshot.status === "question_live";
  const isTimeUp = !snapshot.activeQuestion?.secondsRemaining || snapshot.activeQuestion.secondsRemaining <= 0;

  if (!participants.length) {
    answerStatusList.innerHTML = '<div class="empty-state">Henüz onaylı katılımcı yok.</div>';
    return;
  }

  participants.forEach((participant) => {
    const row = document.createElement("div");
    row.className = "item participant-row";

    const name = document.createElement("strong");
    name.textContent = participant.name;

    const status = document.createElement("span");
    status.className = "status-chip";

    if (answeredSet.has(participant.id)) {
      status.classList.add("status-chip--ok");
      status.textContent = "Soru cevaplandı";
    } else if (isQuestionLive && !isTimeUp) {
      status.classList.add("status-chip--wait");
      status.textContent = "Düşünüyor";
    } else {
      status.classList.add("status-chip--miss");
      status.textContent = "Soruya yanıtlanmadı";
    }

    row.appendChild(name);
    row.appendChild(status);
    answerStatusList.appendChild(row);
  });
}

function setupSocket() {
  const socket = new WebSocket(wsUrl());
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      render(msg.payload);
    }
  };
}

setupSocket();

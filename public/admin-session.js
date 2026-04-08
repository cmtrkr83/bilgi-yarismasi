const quizSelect = document.getElementById("quizSelect");
const startSessionBtn = document.getElementById("startSessionBtn");
const nextQuestionBtn = document.getElementById("nextQuestionBtn");
const endQuestionBtn = document.getElementById("endQuestionBtn");
const sessionInfo = document.getElementById("sessionInfo");
const screenLinks = document.getElementById("screenLinks");
const activeSessionsList = document.getElementById("activeSessionsList");

function isLiveSession(status) {
  return ["lobby", "question_live", "between_questions"].includes(status);
}

function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
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

function renderQuizOptions(quizzes) {
  quizSelect.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = quizzes.length ? "Yayına alınacak quiz seçin" : "Henüz quiz yok";
  quizSelect.appendChild(placeholder);

  quizzes.forEach((quiz) => {
    const option = document.createElement("option");
    option.value = String(quiz.id);
    option.textContent = `#${quiz.id} ${quiz.title} (${quiz.questionCount} soru)`;
    quizSelect.appendChild(option);
  });
}

function renderScreenLinks(screenLinksData) {
  if (!screenLinksData) {
    screenLinks.classList.add("hidden");
    return;
  }

  screenLinks.classList.remove("hidden");

  screenLinks.innerHTML = `
    <div><strong>Sunum ekranı:</strong> <a href="${screenLinksData.presentation.local}" target="_blank" rel="noreferrer">${screenLinksData.presentation.local}</a></div>
    <div><strong>Sunum ekranı (ağ):</strong> <a href="${screenLinksData.presentation.lan}" target="_blank" rel="noreferrer">${screenLinksData.presentation.lan}</a></div>
    <div><strong>Katılımcı ekranı:</strong> <a href="${screenLinksData.participant.local}" target="_blank" rel="noreferrer">${screenLinksData.participant.local}</a></div>
    <div><strong>Katılımcı ekranı (ağ):</strong> <a href="${screenLinksData.participant.lan}" target="_blank" rel="noreferrer">${screenLinksData.participant.lan}</a></div>
  `;
}

function renderSession(snapshot) {
  if (!snapshot.hasSession) {
    sessionInfo.textContent = "Aktif yarışma yok.";
    activeSessionsList.innerHTML = '<div class="empty-state">Şu anda aktif yarışma yok.</div>';
    return;
  }

  const statusMap = {
    lobby: "Lobi",
    question_live: "Soru aktif",
    between_questions: "Ara ekran",
    finished: "Bitti",
    stopped: "Durduruldu",
  };

  const live = isLiveSession(snapshot.status);
  sessionInfo.innerHTML = `
    <div><strong>Quiz:</strong> ${snapshot.quizTitle}</div>
    <div><strong>Durum:</strong> ${statusMap[snapshot.status] || snapshot.status}</div>
    <div><strong>Soru:</strong> ${Math.max(0, snapshot.currentQuestionIndex + 1)} / ${snapshot.totalQuestions}</div>
    ${live ? `<div><strong>Kod:</strong> ${snapshot.code}</div>` : "<div><strong>Kod:</strong> Yalnızca canlı yayında görünür.</div>"}
  `;

  activeSessionsList.innerHTML = "";
  if (!live) {
    activeSessionsList.innerHTML = '<div class="empty-state">Canlı bir yarışma yayında değil.</div>';
    return;
  }

  const row = document.createElement("div");
  row.className = "item session-row";

  const title = document.createElement("strong");
  title.textContent = `${snapshot.quizTitle} (${snapshot.code})`;
  row.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "session-row__actions";

  const stopBtn = document.createElement("button");
  stopBtn.textContent = "Durdur";
  stopBtn.className = "danger";
  stopBtn.onclick = async () => {
    try {
      await api("/api/session/stop", "POST");
      await loadBootstrap();
    } catch (err) {
      alert(err.message);
    }
  };

  actions.appendChild(stopBtn);
  row.appendChild(actions);
  activeSessionsList.appendChild(row);
}

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  renderQuizOptions(data.quizzes || []);
  renderSession(data.session);
  renderScreenLinks(data.session.hasSession && isLiveSession(data.session.status) ? data.screenLinks : null);
}

startSessionBtn.onclick = async () => {
  const selectedQuiz = Number(quizSelect.value);
  if (!selectedQuiz) {
    alert("Quiz seçin.");
    return;
  }

  try {
    const data = await api("/api/session/start", "POST", { quizId: selectedQuiz });
    alert(`Yarışma yayında. Kod: ${data.code}`);
    await loadBootstrap();
  } catch (err) {
    alert(err.message);
  }
};

nextQuestionBtn.onclick = async () => {
  try {
    await api("/api/session/next", "POST");
  } catch (err) {
    alert(err.message);
  }
};

endQuestionBtn.onclick = async () => {
  try {
    await api("/api/session/end-question", "POST");
  } catch (err) {
    alert(err.message);
  }
};

function setupSocket() {
  const socket = new WebSocket(wsUrl());
  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      const bootstrap = await api("/api/bootstrap");
      renderSession(msg.payload);
      renderScreenLinks(msg.payload.hasSession && isLiveSession(msg.payload.status) ? bootstrap.screenLinks : null);
      renderQuizOptions(bootstrap.quizzes || []);
    }
  };
}

loadBootstrap().catch((err) => alert(err.message));
setupSocket();

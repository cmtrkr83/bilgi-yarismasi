const quizTitle = document.getElementById("quizTitle");
const createQuizBtn = document.getElementById("createQuizBtn");
const quizSelect = document.getElementById("quizSelect");
const questionType = document.getElementById("questionType");
const questionText = document.getElementById("questionText");
const questionOptions = document.getElementById("questionOptions");
const questionCorrect = document.getElementById("questionCorrect");
const questionTime = document.getElementById("questionTime");
const questionPoints = document.getElementById("questionPoints");
const addQuestionBtn = document.getElementById("addQuestionBtn");
const startSessionBtn = document.getElementById("startSessionBtn");
const nextQuestionBtn = document.getElementById("nextQuestionBtn");
const endQuestionBtn = document.getElementById("endQuestionBtn");
const pendingList = document.getElementById("pendingList");
const sessionInfo = document.getElementById("sessionInfo");
const scoreRows = document.getElementById("scoreRows");
const screenLinks = document.getElementById("screenLinks");

let sessionSnapshot = null;

function wsUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

function renderQuizzes(quizzes) {
  quizSelect.innerHTML = "";
  quizzes.forEach((quiz) => {
    const option = document.createElement("option");
    option.value = String(quiz.id);
    option.textContent = `#${quiz.id} ${quiz.title}`;
    quizSelect.appendChild(option);
  });
}

function renderSession(snapshot, links) {
  sessionSnapshot = snapshot;
  if (!snapshot.hasSession) {
    sessionInfo.textContent = "Aktif yarışma yok.";
    screenLinks.textContent = "Sunum ve katılımcı bağlantıları burada görünecek.";
    pendingList.innerHTML = "";
    scoreRows.innerHTML = "";
    return;
  }

  const statusMap = {
    lobby: "Lobi",
    question_live: "Soru aktif",
    between_questions: "Ara ekran",
    finished: "Bitti",
  };

  sessionInfo.innerHTML = `
    <div><strong>Quiz:</strong> ${snapshot.quizTitle}</div>
    <div><strong>Kod:</strong> ${snapshot.code}</div>
    <div><strong>Durum:</strong> ${statusMap[snapshot.status] || snapshot.status}</div>
    <div><strong>Soru:</strong> ${Math.max(0, snapshot.currentQuestionIndex + 1)} / ${snapshot.totalQuestions}</div>
  `;

  const presentationLink = `${location.origin}/presentation.html`;
  const participantLink = `${location.origin}/participant.html`;

  screenLinks.innerHTML = `
    <div><strong>Sunum ekranı:</strong> <a href="${presentationLink}" target="_blank" rel="noreferrer">${presentationLink}</a></div>
    <div><strong>Katılımcı ekranı:</strong> <a href="${participantLink}" target="_blank" rel="noreferrer">${participantLink}</a></div>
  `;

  pendingList.innerHTML = "";
  snapshot.pendingParticipants.forEach((participant) => {
    const box = document.createElement("div");
    box.className = "item";
    box.innerHTML = `<strong>${participant.name}</strong>`;

    const allow = document.createElement("button");
    allow.textContent = "Onayla";
    allow.className = "secondary";
    allow.onclick = () => approveParticipant(participant.id, true);

    const deny = document.createElement("button");
    deny.textContent = "Reddet";
    deny.className = "danger";
    deny.onclick = () => approveParticipant(participant.id, false);

    box.appendChild(allow);
    box.appendChild(deny);
    pendingList.appendChild(box);
  });

  scoreRows.innerHTML = "";
  snapshot.leaderboard.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${idx + 1}</td><td>${row.name}</td><td>${row.score}</td>`;
    scoreRows.appendChild(tr);
  });
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

async function approveParticipant(participantId, approved) {
  try {
    await api("/api/session/approve", "POST", { participantId, approved });
  } catch (err) {
    alert(err.message);
  }
}

createQuizBtn.onclick = async () => {
  try {
    await api("/api/quizzes", "POST", { title: quizTitle.value });
    quizTitle.value = "";
    await loadBootstrap();
  } catch (err) {
    alert(err.message);
  }
};

addQuestionBtn.onclick = async () => {
  const selectedQuiz = Number(quizSelect.value);
  if (!selectedQuiz) {
    alert("Önce quiz seçin.");
    return;
  }

  try {
    await api(`/api/quizzes/${selectedQuiz}/questions`, "POST", {
      type: questionType.value,
      text: questionText.value,
      options: questionOptions.value.split(",").map((x) => x.trim()).filter(Boolean),
      correctAnswer: questionCorrect.value,
      timeLimit: Number(questionTime.value),
      points: Number(questionPoints.value),
    });

    questionText.value = "";
    questionOptions.value = "";
    questionCorrect.value = "";
    alert("Soru eklendi.");
  } catch (err) {
    alert(err.message);
  }
};

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

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  renderQuizzes(data.quizzes);
  renderSession(data.session, data.joinLinks);
}

function setupSocket() {
  const socket = new WebSocket(wsUrl());
  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      const bootstrap = await api("/api/bootstrap");
      renderSession(msg.payload, bootstrap.joinLinks);
      if (quizSelect.options.length === 0 && bootstrap.quizzes.length > 0) {
        renderQuizzes(bootstrap.quizzes);
      }
    }
  };
}

loadBootstrap().catch((err) => alert(err.message));
setupSocket();

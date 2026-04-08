const pendingList = document.getElementById("pendingList");
const approvedList = document.getElementById("approvedList");

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

function renderSession(snapshot) {
  if (!snapshot.hasSession) {
    pendingList.innerHTML = "";
    approvedList.innerHTML = '<div class="empty-state">Aktif yarışma yok.</div>';
    return;
  }

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

  approvedList.innerHTML = "";
  if (!snapshot.participants.length) {
    approvedList.innerHTML = '<div class="empty-state">Henüz onaylı katılımcı yok.</div>';
    return;
  }

  snapshot.participants.forEach((participant) => {
    const box = document.createElement("div");
    box.className = "item participant-row";

    const label = document.createElement("strong");
    label.textContent = `${participant.name} (${participant.score} puan)`;
    box.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "participant-row__actions";

    const edit = document.createElement("button");
    edit.textContent = "İsim Düzenle";
    edit.className = "secondary";
    edit.onclick = async () => {
      const newName = prompt("Yeni isim", participant.name);
      if (!newName || newName.trim().length < 2) {
        return;
      }
      try {
        await api(`/api/participants/${participant.id}`, "PATCH", { name: newName });
      } catch (err) {
        alert(err.message);
      }
    };

    const remove = document.createElement("button");
    remove.textContent = "Yarışmadan Çıkar";
    remove.className = "danger";
    remove.onclick = async () => {
      const confirmRemove = confirm(`${participant.name} yarışmadan çıkarılsın mı?`);
      if (!confirmRemove) {
        return;
      }
      try {
        await api(`/api/participants/${participant.id}`, "DELETE");
      } catch (err) {
        alert(err.message);
      }
    };

    actions.appendChild(edit);
    actions.appendChild(remove);
    box.appendChild(actions);
    approvedList.appendChild(box);
  });
}

async function approveParticipant(participantId, approved) {
  try {
    await api("/api/session/approve", "POST", { participantId, approved });
  } catch (err) {
    alert(err.message);
  }
}

async function loadQuizzes() {
  await api("/api/quizzes");
}

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  renderSession(data.session);
}

function setupSocket() {
  const socket = new WebSocket(wsUrl());
  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      renderSession(msg.payload);
    }
  };
}

loadBootstrap().catch((err) => alert(err.message));
setupSocket();

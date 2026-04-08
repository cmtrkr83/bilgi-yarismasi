const scoreRows = document.getElementById("scoreRows");

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

function renderLeaderboard(snapshot) {
  if (!snapshot.hasSession) {
    scoreRows.innerHTML = '<tr><td colspan="3">Aktif yarışma yok.</td></tr>';
    return;
  }

  scoreRows.innerHTML = "";
  snapshot.leaderboard.forEach((row, idx) => {
    const tr = document.createElement("tr");
    const medal = idx === 0 ? "🥇 " : idx === 1 ? "🥈 " : idx === 2 ? "🥉 " : "";
    tr.innerHTML = `<td>${idx + 1}</td><td>${medal}${row.name}</td><td>${row.score}</td>`;
    scoreRows.appendChild(tr);
  });
}

async function loadBootstrap() {
  const data = await api("/api/bootstrap");
  renderLeaderboard(data.session);
}

function setupSocket() {
  const socket = new WebSocket(wsUrl());
  socket.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "state") {
      renderLeaderboard(msg.payload);
    }
  };
}

loadBootstrap().catch((err) => alert(err.message));
setupSocket();

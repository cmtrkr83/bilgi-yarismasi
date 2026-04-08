const createQuizBtn = document.getElementById("createQuizBtn");
const quizList = document.getElementById("quizList");
let cachedQuizzes = [];

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

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderQuizCards(quizzes) {
  cachedQuizzes = Array.isArray(quizzes) ? quizzes : [];
  quizList.innerHTML = "";

  if (!quizzes.length) {
    quizList.innerHTML = '<div class="empty-state">Henüz quiz oluşturulmadı.</div>';
    return;
  }

  quizzes.forEach((quiz) => {
    const card = document.createElement("article");
    card.className = "quiz-card";
    card.innerHTML = `
      <h3 class="quiz-card__title">${quiz.title}</h3>
      <p class="quiz-card__subtitle">${quiz.questionCount} soru • ${formatDate(quiz.createdAt)}</p>
      <div class="quiz-card__actions">
        <button class="secondary" data-action="edit">Düzenle</button>
        <button class="danger" data-action="delete">Sil</button>
      </div>
    `;

    card.querySelector('[data-action="edit"]').onclick = () => {
      location.href = `/admin-quiz-editor.html?quizId=${quiz.id}`;
    };

    card.querySelector('[data-action="delete"]').onclick = async () => {
      const confirmDelete = confirm(`"${quiz.title}" quizini silmek istiyor musunuz?`);
      if (!confirmDelete) {
        return;
      }

      try {
        await api(`/api/quizzes/${quiz.id}`, "DELETE");
        await loadQuizzes();
      } catch (err) {
        alert(err.message);
      }
    };

    quizList.appendChild(card);
  });
}

function generateDefaultQuizTitle() {
  const used = new Set(
    cachedQuizzes
      .map((quiz) => String(quiz.title || "").trim())
      .filter(Boolean)
  );

  let index = 1;
  while (used.has(`Quiz-${index}`)) {
    index += 1;
  }
  return `Quiz-${index}`;
}

async function loadQuizzes() {
  const data = await api("/api/quizzes");
  renderQuizCards(data.quizzes);
}

createQuizBtn.onclick = async () => {
  try {
    const defaultTitle = generateDefaultQuizTitle();
    await api("/api/quizzes", "POST", { title: defaultTitle });
    await loadQuizzes();
  } catch (err) {
    alert(err.message);
  }
};

loadQuizzes().catch((err) => alert(err.message));

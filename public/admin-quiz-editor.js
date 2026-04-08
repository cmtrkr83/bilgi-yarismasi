const quizHeading = document.getElementById("quizHeading");
const quizMeta = document.getElementById("quizMeta");
const editQuizTitleBtn = document.getElementById("editQuizTitleBtn");
const quizTitleEditRow = document.getElementById("quizTitleEditRow");
const quizTitleInlineInput = document.getElementById("quizTitleInlineInput");
const saveQuizTitleInlineBtn = document.getElementById("saveQuizTitleInlineBtn");
const cancelQuizTitleInlineBtn = document.getElementById("cancelQuizTitleInlineBtn");
const saveQuestionBtn = document.getElementById("saveQuestionBtn");
const cancelQuestionEditBtn = document.getElementById("cancelQuestionEditBtn");
const questionType = document.getElementById("questionType");
const questionText = document.getElementById("questionText");
const questionImageUrl = document.getElementById("questionImageUrl");
const questionMcqFields = document.getElementById("questionMcqFields");
const questionOptionCount = document.getElementById("questionOptionCount");
const questionOptionCountValue = document.getElementById("questionOptionCountValue");
const questionOptionInputs = document.getElementById("questionOptionInputs");
const questionOpenFields = document.getElementById("questionOpenFields");
const questionCorrectOpen = document.getElementById("questionCorrectOpen");
const questionTime = document.getElementById("questionTime");
const questionPoints = document.getElementById("questionPoints");
const questionList = document.getElementById("questionList");
const openQuestionModalBtn = document.getElementById("openQuestionModalBtn");
const importQuestionsBtn = document.getElementById("importQuestionsBtn");
const excelImportInput = document.getElementById("excelImportInput");
const questionEditorModal = document.getElementById("questionEditorModal");
const questionEditorBackdrop = document.getElementById("questionEditorBackdrop");
const closeQuestionModalBtn = document.getElementById("closeQuestionModalBtn");
const questionEditorModalTitle = document.getElementById("questionEditorModalTitle");
const previewDraftBtn = document.getElementById("previewDraftBtn");
const closePreviewBtn = document.getElementById("closePreviewBtn");
const questionPreviewModal = document.getElementById("questionPreviewModal");
const previewModalBackdrop = document.getElementById("previewModalBackdrop");
const previewMeta = document.getElementById("previewMeta");
const previewQuestionText = document.getElementById("previewQuestionText");
const previewQuestionMediaWrap = document.getElementById("previewQuestionMediaWrap");
const previewQuestionMediaImage = document.getElementById("previewQuestionMediaImage");
const previewAnswerArea = document.getElementById("previewAnswerArea");

const quizId = Number(new URLSearchParams(location.search).get("quizId"));
let currentQuiz = null;
let editingQuestionId = null;

if (!quizId) {
  location.href = "/admin-quizzes.html";
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

function renderQuestionList(questions) {
  questionList.innerHTML = "";

  if (!questions.length) {
    questionList.innerHTML = '<div class="empty-state">Henüz soru eklenmedi.</div>';
    return;
  }

  questions.forEach((question, index) => {
    const item = document.createElement("article");
    item.className = "question-item";
    item.innerHTML = `
      <h3 class="question-item__title">${index + 1}. ${question.text}</h3>
      <p class="question-item__subtitle">Tür: ${question.type === "mcq" ? "Çoktan Seçmeli" : "Açık Uçlu"} • Süre: ${question.timeLimit} sn • Puan: ${question.points}</p>
      <p class="question-item__subtitle">Görsel: ${question.imageUrl ? "Var" : "Yok"}</p>
      <div class="question-item__actions">
        <button data-action="preview">Önizle</button>
        <button class="secondary" data-action="edit">Düzenle</button>
        <button class="danger" data-action="delete">Sil</button>
      </div>
    `;

    item.querySelector('[data-action="preview"]').onclick = () => showQuestionPreview(question);
    item.querySelector('[data-action="edit"]').onclick = () => startEditingQuestion(question);
    item.querySelector('[data-action="delete"]').onclick = async () => {
      const confirmDelete = confirm("Bu soruyu silmek istiyor musunuz?");
      if (!confirmDelete) {
        return;
      }

      try {
        await api(`/api/questions/${question.id}`, "DELETE");
        if (editingQuestionId === question.id) {
          clearQuestionForm();
        }
        await loadQuiz();
      } catch (err) {
        alert(err.message);
      }
    };

    questionList.appendChild(item);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setQuestionTypeUI() {
  const isMcq = questionType.value === "mcq";
  questionMcqFields.classList.toggle("hidden", !isMcq);
  questionOpenFields.classList.toggle("hidden", isMcq);
}

function getSelectedCorrectIndex() {
  const checked = questionOptionInputs.querySelector('.option-correct-radio:checked');
  return checked ? Number(checked.value) : Number.NaN;
}

function updateOptionCountLabel() {
  questionOptionCountValue.textContent = String(Number(questionOptionCount.value) || 4);
}

function renderOptionInputs(initialValues = [], selectedValue = "") {
  const count = Number(questionOptionCount.value) || 4;
  const values = [];
  const normalizedSelected = String(selectedValue || "").trim().toLowerCase();

  for (let index = 0; index < count; index += 1) {
    values.push(String(initialValues[index] || ""));
  }

  questionOptionInputs.innerHTML = values
    .map((value, index) => {
      const label = String.fromCharCode(65 + index);
      const shouldCheck = normalizedSelected
        ? value.trim().toLowerCase() === normalizedSelected
        : index === 0;
      return `
        <label class="option-editor-item option-editor-item--${(index % 5) + 1}">
          <div class="option-editor-head">
            <span class="option-editor-badge">${label}</span>
            <span class="option-editor-correct">
              <input type="radio" class="option-correct-radio" name="questionCorrectOptionRadio" value="${index}" ${shouldCheck ? "checked" : ""} />
              Doğru seçenek
            </span>
          </div>
          <input class="option-input" data-index="${index}" placeholder="${label} seçeneği" value="${escapeHtml(value)}" />
        </label>
      `;
    })
    .join("");

  if (!questionOptionInputs.querySelector('.option-correct-radio:checked')) {
    const first = questionOptionInputs.querySelector('.option-correct-radio');
    if (first) {
      first.checked = true;
    }
  }
}

function collectQuestionPayload() {
  const type = questionType.value;
  const text = questionText.value.trim();
  const imageUrl = questionImageUrl.value.trim();
  const timeLimit = Number(questionTime.value);
  const points = Number(questionPoints.value);

  if (!text) {
    throw new Error("Soru metni zorunludur.");
  }

  if (!Number.isFinite(timeLimit) || timeLimit < 1) {
    throw new Error("Süre en az 1 saniye olmalıdır.");
  }

  if (!Number.isFinite(points) || points < 1) {
    throw new Error("Puan en az 1 olmalıdır.");
  }

  if (type === "mcq") {
    const options = Array.from(questionOptionInputs.querySelectorAll(".option-input")).map((input) => input.value.trim());
    if (options.length < 2 || options.length > 5) {
      throw new Error("Çoktan seçmeli soru için seçenek sayısı 2 ile 5 arasında olmalıdır.");
    }
    if (options.some((option) => !option)) {
      throw new Error("Çoktan seçmeli soruda tüm seçenekler doldurulmalıdır.");
    }

    const correctIndex = getSelectedCorrectIndex();
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      throw new Error("Lütfen doğru seçeneği işaretleyin.");
    }

    return {
      type,
      text,
      imageUrl,
      options,
      correctAnswer: options[correctIndex],
      timeLimit,
      points,
    };
  }

  const correctAnswer = questionCorrectOpen.value.trim();
  if (!correctAnswer) {
    throw new Error("Doğru cevap zorunludur.");
  }

  return {
    type,
    text,
    imageUrl,
    options: [],
    correctAnswer,
    timeLimit,
    points,
  };
}

function normalizePreviewQuestion(question) {
  const type = question.type === "open" ? "open" : "mcq";
  const options = Array.isArray(question.options) ? question.options.map((option) => String(option || "").trim()).filter(Boolean) : [];

  return {
    type,
    text: String(question.text || "").trim() || "Soru metni girilmemiş.",
    imageUrl: String(question.imageUrl || "").trim(),
    options,
    correctAnswer: String(question.correctAnswer || "").trim(),
    timeLimit: Math.max(1, Number(question.timeLimit) || 30),
    points: Math.max(1, Number(question.points) || 10),
  };
}

function showQuestionPreview(question) {
  const preview = normalizePreviewQuestion(question);
  questionPreviewModal.classList.remove("hidden");
  questionPreviewModal.setAttribute("aria-hidden", "false");
  syncBodyModalState();
  previewMeta.textContent = `${preview.type === "mcq" ? "Çoktan Seçmeli" : "Açık Uçlu"} • Süre: ${preview.timeLimit} sn • Puan: ${preview.points}`;
  previewQuestionText.textContent = preview.text;

  if (preview.imageUrl) {
    previewQuestionMediaImage.src = preview.imageUrl;
    previewQuestionMediaWrap.classList.remove("hidden");
  } else {
    previewQuestionMediaImage.removeAttribute("src");
    previewQuestionMediaWrap.classList.add("hidden");
  }

  previewAnswerArea.innerHTML = "";
  if (preview.type === "mcq") {
    const options = preview.options.length ? preview.options : ["Seçenek A", "Seçenek B"];
    const wrap = document.createElement("div");
    wrap.className = "options";
    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option";
      button.textContent = option;
      wrap.appendChild(button);
    });
    previewAnswerArea.appendChild(wrap);
    return;
  }

  const input = document.createElement("input");
  input.placeholder = "Cevabın";
  input.disabled = true;
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "secondary";
  submit.textContent = "Devam Et";
  submit.disabled = true;
  previewAnswerArea.appendChild(input);
  previewAnswerArea.appendChild(submit);
}

function closePreviewModal() {
  questionPreviewModal.classList.add("hidden");
  questionPreviewModal.setAttribute("aria-hidden", "true");
  syncBodyModalState();
}

function syncBodyModalState() {
  const anyModalOpen = !questionPreviewModal.classList.contains("hidden") || !questionEditorModal.classList.contains("hidden");
  document.body.classList.toggle("modal-open", anyModalOpen);
}

function openQuestionEditorModal() {
  questionEditorModal.classList.remove("hidden");
  questionEditorModal.setAttribute("aria-hidden", "false");
  questionEditorModalTitle.textContent = editingQuestionId ? "Soruyu Düzenle" : "Soru Ekle";
  syncBodyModalState();
}

function closeQuestionEditorModal() {
  questionEditorModal.classList.add("hidden");
  questionEditorModal.setAttribute("aria-hidden", "true");
  syncBodyModalState();
}

function startEditingQuestion(question) {
  editingQuestionId = question.id;
  questionType.value = question.type;
  questionText.value = question.text;
  questionImageUrl.value = question.imageUrl || "";
  setQuestionTypeUI();
  if (question.type === "mcq") {
    questionOptionCount.value = String(Math.min(5, Math.max(2, question.options.length || 4)));
    updateOptionCountLabel();
    renderOptionInputs(question.options, question.correctAnswer);
    questionCorrectOpen.value = "";
  } else {
    questionCorrectOpen.value = question.correctAnswer;
    questionOptionCount.value = "4";
    updateOptionCountLabel();
    renderOptionInputs([], "");
  }
  questionTime.value = question.timeLimit;
  questionPoints.value = question.points;
  saveQuestionBtn.textContent = "Soruyu Kaydet";
  cancelQuestionEditBtn.disabled = false;
  openQuestionEditorModal();
}

function clearQuestionForm() {
  editingQuestionId = null;
  questionType.value = "mcq";
  questionText.value = "";
  questionImageUrl.value = "";
  questionOptionCount.value = "4";
  updateOptionCountLabel();
  questionCorrectOpen.value = "";
  renderOptionInputs();
  setQuestionTypeUI();
  questionTime.value = 30;
  questionPoints.value = 10;
  saveQuestionBtn.textContent = "Soruyu Kaydet";
  cancelQuestionEditBtn.disabled = true;
}

function renderQuizHeader(detail) {
  currentQuiz = detail.quiz;
  quizHeading.textContent = detail.quiz.title;
  quizTitleInlineInput.value = detail.quiz.title;
  quizMeta.textContent = `${detail.questionCount} soru • Oluşturulma: ${detail.quiz.createdAt}`;
}

function openQuizTitleEditor() {
  if (!currentQuiz) {
    return;
  }
  quizTitleInlineInput.value = currentQuiz.title;
  quizTitleEditRow.classList.remove("hidden");
  quizTitleInlineInput.focus();
  quizTitleInlineInput.select();
}

function closeQuizTitleEditor() {
  quizTitleEditRow.classList.add("hidden");
}

async function saveQuizTitleInline() {
  if (!currentQuiz) {
    return;
  }

  const newTitle = quizTitleInlineInput.value.trim();
  if (newTitle.length < 3) {
    alert("Quiz başlığı en az 3 karakter olmalı.");
    return;
  }

  try {
    await api(`/api/quizzes/${quizId}`, "PATCH", { title: newTitle });
    closeQuizTitleEditor();
    await loadQuiz();
  } catch (err) {
    alert(err.message);
  }
}

async function loadQuiz() {
  const data = await api(`/api/quizzes/${quizId}`);
  renderQuizHeader(data);
  renderQuestionList(data.questions);
}

async function importQuestionsFromExcel(file) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`/api/quizzes/${quizId}/questions/import-excel`, {
    method: "POST",
    body: formData,
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Excel import başarısız.");
  }

  return json;
}

saveQuestionBtn.onclick = async () => {
  try {
    const payload = collectQuestionPayload();
    if (editingQuestionId) {
      await api(`/api/questions/${editingQuestionId}`, "PATCH", payload);
    } else {
      await api(`/api/quizzes/${quizId}/questions`, "POST", payload);
    }

    clearQuestionForm();
    closeQuestionEditorModal();
    await loadQuiz();
  } catch (err) {
    alert(err.message);
  }
};

cancelQuestionEditBtn.onclick = () => {
  clearQuestionForm();
  closeQuestionEditorModal();
};

editQuizTitleBtn.onclick = () => {
  openQuizTitleEditor();
};

saveQuizTitleInlineBtn.onclick = async () => {
  await saveQuizTitleInline();
};

cancelQuizTitleInlineBtn.onclick = () => {
  closeQuizTitleEditor();
};

quizTitleInlineInput.addEventListener("keydown", async (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    await saveQuizTitleInline();
  }
  if (event.key === "Escape") {
    closeQuizTitleEditor();
  }
});

openQuestionModalBtn.onclick = () => {
  clearQuestionForm();
  openQuestionEditorModal();
};

importQuestionsBtn.onclick = () => {
  excelImportInput.click();
};

excelImportInput.onchange = async () => {
  const file = excelImportInput.files?.[0];
  if (!file) {
    return;
  }

  importQuestionsBtn.disabled = true;
  importQuestionsBtn.textContent = "Yukleniyor...";

  try {
    const result = await importQuestionsFromExcel(file);
    const summary = `Toplam ${result.addedCount} soru eklendi.${result.skippedEmptyRows ? ` Bos satir: ${result.skippedEmptyRows}.` : ""}`;
    alert(summary);
    await loadQuiz();
  } catch (err) {
    alert(err.message);
  } finally {
    importQuestionsBtn.disabled = false;
    importQuestionsBtn.textContent = "Soruları Excel'den İçe Aktar";
    excelImportInput.value = "";
  }
};

closeQuestionModalBtn.onclick = () => {
  clearQuestionForm();
  closeQuestionEditorModal();
};

questionEditorBackdrop.onclick = () => {
  clearQuestionForm();
  closeQuestionEditorModal();
};

previewDraftBtn.onclick = () => {
  try {
    const payload = collectQuestionPayload();
    showQuestionPreview(payload);
  } catch {
    const draft = {
      type: questionType.value,
      text: questionText.value,
      imageUrl: questionImageUrl.value,
      options: Array.from(questionOptionInputs.querySelectorAll(".option-input")).map((input) => input.value),
      correctAnswer: questionType.value === "mcq"
        ? (() => {
            const selected = getSelectedCorrectIndex();
            const options = Array.from(questionOptionInputs.querySelectorAll(".option-input")).map((input) => input.value.trim());
            return Number.isInteger(selected) && selected >= 0 && selected < options.length ? options[selected] : "";
          })()
        : questionCorrectOpen.value,
      timeLimit: questionTime.value,
      points: questionPoints.value,
    };
    showQuestionPreview(draft);
  }
};

closePreviewBtn.onclick = () => {
  closePreviewModal();
};

previewModalBackdrop.onclick = () => {
  closePreviewModal();
};

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!questionPreviewModal.classList.contains("hidden")) {
    closePreviewModal();
  }

  if (!questionEditorModal.classList.contains("hidden")) {
    clearQuestionForm();
    closeQuestionEditorModal();
  }
});

questionType.onchange = () => {
  setQuestionTypeUI();
};

questionOptionCount.onchange = () => {
  updateOptionCountLabel();
  const oldValues = Array.from(questionOptionInputs.querySelectorAll(".option-input")).map((input) => input.value.trim());
  const selectedIndex = getSelectedCorrectIndex();
  const selectedValue = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < oldValues.length
    ? oldValues[selectedIndex]
    : "";
  renderOptionInputs(oldValues, selectedValue);
};

questionOptionCount.oninput = () => {
  updateOptionCountLabel();
};

loadQuiz()
  .then(() => clearQuestionForm())
  .catch((err) => alert(err.message));

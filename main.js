const path = require("path");
const os = require("os");
const http = require("http");
const express = require("express");
const multer = require("multer");
const XLSX = require("xlsx");
const { WebSocketServer } = require("ws");
const sqlite3 = require("sqlite3").verbose();
const { app, BrowserWindow } = require("electron");

const PORT = 4780;
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

const db = new sqlite3.Database(path.join(__dirname, "quiz.db"));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      image_url TEXT,
      options_json TEXT,
      correct_answer TEXT NOT NULL,
      time_limit INTEGER NOT NULL DEFAULT 30,
      points INTEGER NOT NULL DEFAULT 10,
      order_index INTEGER NOT NULL,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
    )
  `);

  const questionColumns = await all("PRAGMA table_info(questions)");
  const hasImageUrlColumn = questionColumns.some((column) => column.name === "image_url");
  if (!hasImageUrlColumn) {
    await run("ALTER TABLE questions ADD COLUMN image_url TEXT");
  }

  await run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quiz_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'lobby',
      current_question_index INTEGER NOT NULL DEFAULT -1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      score INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer TEXT NOT NULL,
      is_correct INTEGER NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (participant_id) REFERENCES participants(id),
      FOREIGN KEY (question_id) REFERENCES questions(id)
    )
  `);
}

const state = {
  activeSession: null,
  questionDeadline: null,
  sockets: new Set(),
  timerRef: null,
};

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function getLanAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const entries = interfaces[name] || [];
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

function normalize(answer) {
  return String(answer || "").trim().toLowerCase();
}

function readImportCell(row, index) {
  return String(row[index] ?? "").trim();
}

function parsePositiveInteger(value, defaultValue) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return defaultValue;
  }
  return Math.floor(parsed);
}

function resolveCorrectAnswer(correctValue, options) {
  const normalized = normalize(correctValue);
  const letters = ["a", "b", "c", "d"];
  const letterIndex = letters.indexOf(normalized);
  if (letterIndex >= 0 && options[letterIndex]) {
    return options[letterIndex];
  }

  const matchedOption = options.find((option) => normalize(option) === normalized);
  return matchedOption || "";
}

function isLiveSessionStatus(status) {
  return ["lobby", "question_live", "between_questions"].includes(status);
}

function serializeQuestion(row) {
  return {
    id: row.id,
    quizId: row.quiz_id,
    type: row.type,
    text: row.text,
    imageUrl: row.image_url || "",
    options: row.options_json ? JSON.parse(row.options_json) : [],
    correctAnswer: row.correct_answer,
    timeLimit: row.time_limit,
    points: row.points,
    orderIndex: row.order_index,
  };
}

function serializeQuiz(row) {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    questionCount: Number(row.questionCount || 0),
  };
}

async function getQuizList() {
  return all(
    `SELECT quizzes.id, quizzes.title, quizzes.created_at, COUNT(questions.id) AS questionCount
     FROM quizzes
     LEFT JOIN questions ON questions.quiz_id = quizzes.id
     GROUP BY quizzes.id
     ORDER BY quizzes.id DESC`
  );
}

async function getQuizDetail(quizId) {
  const quiz = await get("SELECT id, title, created_at FROM quizzes WHERE id = ?", [quizId]);
  if (!quiz) {
    return null;
  }

  const questions = await all(
    `SELECT id, quiz_id, type, text, image_url, options_json, correct_answer, time_limit, points, order_index
     FROM questions
     WHERE quiz_id = ?
     ORDER BY order_index ASC, id ASC`,
    [quizId]
  );

  return {
    quiz: {
      id: quiz.id,
      title: quiz.title,
      createdAt: quiz.created_at,
    },
    questionCount: questions.length,
    questions: questions.map(serializeQuestion),
  };
}

function validateQuestionPayload(type, text, correctAnswer, options, timeLimit, points) {
  if (!["open", "mcq"].includes(type)) {
    return "Soru tipi 'open' veya 'mcq' olmalı.";
  }

  if (!text || !correctAnswer) {
    return "Soru metni ve doğru cevap zorunludur.";
  }

  if (!Number.isFinite(Number(timeLimit)) || Number(timeLimit) < 1) {
    return "Süre en az 1 saniye olmalıdır.";
  }

  if (!Number.isFinite(Number(points)) || Number(points) < 1) {
    return "Puan en az 1 olmalıdır.";
  }

  if (type === "mcq") {
    const rawOptions = Array.isArray(options) ? options.map((option) => String(option).trim()) : [];
    if (rawOptions.length < 2 || rawOptions.length > 5) {
      return "Çoktan seçmeli soru için seçenek sayısı 2 ile 5 arasında olmalıdır.";
    }

    if (rawOptions.some((option) => !option)) {
      return "Çoktan seçmeli soruda tüm seçenekler doldurulmalıdır.";
    }

    const normalizedCorrectAnswer = normalize(correctAnswer);
    const hasMatchingOption = rawOptions.some((option) => normalize(option) === normalizedCorrectAnswer);
    if (!hasMatchingOption) {
      return "Doğru cevap, seçeneklerden biri olarak işaretlenmelidir.";
    }
  }

  return null;
}

async function getNextQuestionOrderIndex(quizId) {
  const row = await get("SELECT COALESCE(MAX(order_index), -1) + 1 AS nextIndex FROM questions WHERE quiz_id = ?", [quizId]);
  return Number(row?.nextIndex ?? 0);
}

async function fetchSessionSnapshot(participantId = null) {
  if (!state.activeSession) {
    return {
      hasSession: false,
      status: "idle",
      message: "Yönetici henüz bir yarışmayı yayına almadı.",
    };
  }

  const session = await get(
    "SELECT s.*, q.title FROM sessions s JOIN quizzes q ON q.id = s.quiz_id WHERE s.id = ?",
    [state.activeSession.id]
  );

  const questions = await all(
    "SELECT id, type, text, image_url, options_json, time_limit, points, order_index FROM questions WHERE quiz_id = ? ORDER BY order_index ASC",
    [session.quiz_id]
  );

  const participants = await all(
    "SELECT id, name, approved, score FROM participants WHERE session_id = ? ORDER BY score DESC, id ASC",
    [session.id]
  );

  const pending = participants.filter((p) => Number(p.approved) === 0);
  const approved = participants.filter((p) => Number(p.approved) === 1);

  const activeQuestion =
    session.current_question_index >= 0 && session.current_question_index < questions.length
      ? questions[session.current_question_index]
      : null;

  let answeredParticipantIds = [];
  if (activeQuestion) {
    const answeredRows = await all(
      "SELECT DISTINCT participant_id FROM answers WHERE question_id = ?",
      [activeQuestion.id]
    );
    answeredParticipantIds = answeredRows.map((row) => Number(row.participant_id));
  }

  let participant = null;
  if (participantId) {
    participant = await get(
      "SELECT id, name, approved, score FROM participants WHERE id = ? AND session_id = ?",
      [participantId, session.id]
    );
  }

  return {
    hasSession: true,
    sessionId: session.id,
    code: session.code,
    quizTitle: session.title,
    status: session.status,
    currentQuestionIndex: session.current_question_index,
    totalQuestions: questions.length,
    activeQuestion: activeQuestion
      ? {
          id: activeQuestion.id,
          type: activeQuestion.type,
          text: activeQuestion.text,
          imageUrl: activeQuestion.image_url || "",
          options: activeQuestion.options_json ? JSON.parse(activeQuestion.options_json) : [],
          timeLimit: activeQuestion.time_limit,
          points: activeQuestion.points,
          secondsRemaining: state.questionDeadline ? Math.max(0, Math.ceil((state.questionDeadline - Date.now()) / 1000)) : 0,
          answeredParticipantIds,
        }
      : null,
    pendingParticipants: pending,
    participants: approved,
    leaderboard: approved.sort((a, b) => b.score - a.score),
    participant,
  };
}

async function broadcastState() {
  const sockets = Array.from(state.sockets);
  await Promise.all(
    sockets.map(async (client) => {
      if (client.readyState !== 1) {
        return;
      }
      const participantId = client.meta?.participantId || null;
      const snapshot = await fetchSessionSnapshot(participantId);
      client.send(JSON.stringify({ type: "state", payload: snapshot }));
    })
  );
}

async function setSessionStatus(status, currentQuestionIndex = null) {
  if (!state.activeSession) {
    return;
  }
  if (currentQuestionIndex === null) {
    await run("UPDATE sessions SET status = ? WHERE id = ?", [status, state.activeSession.id]);
  } else {
    await run("UPDATE sessions SET status = ?, current_question_index = ? WHERE id = ?", [
      status,
      currentQuestionIndex,
      state.activeSession.id,
    ]);
  }
}

async function ensureSessionLoaded() {
  if (state.activeSession) {
    return;
  }
  const session = await get(
    "SELECT * FROM sessions WHERE status IN ('lobby', 'question_live', 'between_questions') ORDER BY id DESC LIMIT 1"
  );
  if (session) {
    state.activeSession = { id: session.id };
  }
}

function setupServer() {
  const api = express();
  api.use(express.json());
  api.use(express.static(path.join(__dirname, "public")));

  api.get("/api/templates/questions-excel", (req, res) => {
    const headers = [
      "Soru Metni",
      "Gorsel URL (Opsiyonel)",
      "A Sikkinin Metni",
      "B Sikkinin Metni",
      "C Sikkinin Metni",
      "D Sikkinin Metni",
      "Dogru Cevap (A/B/C/D veya metin)",
      "Sure (saniye)",
      "Puan",
    ];

    const sampleRow = [
      "Turkiye'nin baskenti neresidir?",
      "",
      "Istanbul",
      "Ankara",
      "Izmir",
      "Bursa",
      "B",
      20,
      100,
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sorular");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="soru-sablonu.xlsx"');
    res.send(buffer);
  });

  api.get("/api/bootstrap", async (req, res) => {
    const quizzes = await getQuizList();
    await ensureSessionLoaded();
    const snapshot = await fetchSessionSnapshot();
    const hasLiveSession = !!snapshot.hasSession && isLiveSessionStatus(snapshot.status);
    res.json({
      quizzes,
      session: snapshot,
      screenLinks: hasLiveSession
        ? {
            presentation: {
              local: `http://localhost:${PORT}/presentation.html`,
              lan: `http://${getLanAddress()}:${PORT}/presentation.html`,
            },
            participant: {
              local: `http://localhost:${PORT}/participant.html`,
              lan: `http://${getLanAddress()}:${PORT}/participant.html`,
            },
          }
        : null,
      joinLinks: hasLiveSession
        ? {
            local: `http://localhost:${PORT}/participant.html`,
            lan: `http://${getLanAddress()}:${PORT}/participant.html`,
          }
        : null,
    });
  });

  api.get("/api/quizzes", async (req, res) => {
    const quizzes = await getQuizList();
    res.json({ quizzes: quizzes.map(serializeQuiz) });
  });

  api.get("/api/quizzes/:quizId", async (req, res) => {
    const quizId = Number(req.params.quizId);
    const detail = await getQuizDetail(quizId);
    if (!detail) {
      res.status(404).json({ error: "Quiz bulunamadı." });
      return;
    }
    res.json(detail);
  });

  api.post("/api/quizzes", async (req, res) => {
    const { title } = req.body;
    if (!title || title.trim().length < 3) {
      res.status(400).json({ error: "Quiz başlığı en az 3 karakter olmalı." });
      return;
    }
    const result = await run("INSERT INTO quizzes (title) VALUES (?)", [title.trim()]);
    res.json({ id: result.lastID });
  });

  api.patch("/api/quizzes/:quizId", async (req, res) => {
    const quizId = Number(req.params.quizId);
    const { title } = req.body;
    if (!title || title.trim().length < 3) {
      res.status(400).json({ error: "Quiz başlığı en az 3 karakter olmalı." });
      return;
    }

    const quiz = await get("SELECT id FROM quizzes WHERE id = ?", [quizId]);
    if (!quiz) {
      res.status(404).json({ error: "Quiz bulunamadı." });
      return;
    }

    await run("UPDATE quizzes SET title = ? WHERE id = ?", [title.trim(), quizId]);
    res.json({ ok: true });
  });

  api.delete("/api/quizzes/:quizId", async (req, res) => {
    const quizId = Number(req.params.quizId);
    const quiz = await get("SELECT id FROM quizzes WHERE id = ?", [quizId]);
    if (!quiz) {
      res.status(404).json({ error: "Quiz bulunamadı." });
      return;
    }

    const activeSession = state.activeSession ? await get("SELECT * FROM sessions WHERE id = ?", [state.activeSession.id]) : null;
    if (activeSession && Number(activeSession.quiz_id) === quizId) {
      state.activeSession = null;
      state.questionDeadline = null;
      if (state.timerRef) {
        clearTimeout(state.timerRef);
        state.timerRef = null;
      }
    }

    await run("DELETE FROM answers WHERE question_id IN (SELECT id FROM questions WHERE quiz_id = ?)", [quizId]);
    await run("DELETE FROM participants WHERE session_id IN (SELECT id FROM sessions WHERE quiz_id = ?)", [quizId]);
    await run("DELETE FROM sessions WHERE quiz_id = ?", [quizId]);
    await run("DELETE FROM questions WHERE quiz_id = ?", [quizId]);
    await run("DELETE FROM quizzes WHERE id = ?", [quizId]);

    await broadcastState();
    res.json({ ok: true });
  });

  api.post("/api/quizzes/:quizId/questions", async (req, res) => {
    const quizId = Number(req.params.quizId);
    const { type, text, imageUrl, options, correctAnswer, timeLimit, points } = req.body;

    const quiz = await get("SELECT id FROM quizzes WHERE id = ?", [quizId]);
    if (!quiz) {
      res.status(404).json({ error: "Quiz bulunamadı." });
      return;
    }

    const validationError = validateQuestionPayload(type, text, correctAnswer, options, timeLimit, points);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const orderIndex = await getNextQuestionOrderIndex(quizId);
    const normalizedOptions = Array.isArray(options)
      ? options.map((o) => String(o).trim()).filter(Boolean)
      : [];

    await run(
      `INSERT INTO questions (quiz_id, type, text, image_url, options_json, correct_answer, time_limit, points, order_index)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        quizId,
        type,
        text.trim(),
        String(imageUrl || "").trim() || null,
        type === "mcq" ? JSON.stringify(normalizedOptions) : null,
        correctAnswer.trim(),
        Math.max(1, Number(timeLimit) || 30),
        Math.max(1, Number(points) || 10),
        orderIndex,
      ]
    );

    res.json({ ok: true });
  });

  api.post("/api/quizzes/:quizId/questions/import-excel", (req, res) => {
    excelUpload.single("file")(req, res, async (uploadError) => {
      if (uploadError) {
        res.status(400).json({ error: "Excel dosyasi yuklenemedi. Dosya boyutu en fazla 5 MB olabilir." });
        return;
      }

      const quizId = Number(req.params.quizId);
      const quiz = await get("SELECT id FROM quizzes WHERE id = ?", [quizId]);
      if (!quiz) {
        res.status(404).json({ error: "Quiz bulunamadi." });
        return;
      }

      if (!req.file || !req.file.buffer) {
        res.status(400).json({ error: "Lutfen bir Excel dosyasi secin." });
        return;
      }

      try {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          res.status(400).json({ error: "Excel dosyasinda okunabilir bir sayfa bulunamadi." });
          return;
        }

        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
        if (rows.length < 2) {
          res.status(400).json({ error: "Excel dosyasinda veri satiri bulunamadi." });
          return;
        }

        const parsedQuestions = [];
        let skippedEmptyRows = 0;

        for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
          const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
          const cells = Array.from({ length: 9 }, (_, idx) => readImportCell(row, idx));
          const isEmpty = cells.every((cell) => !cell);
          if (isEmpty) {
            skippedEmptyRows += 1;
            continue;
          }

          const text = cells[0];
          const imageUrl = cells[1] || "";
          const options = [cells[2], cells[3], cells[4], cells[5]];
          const correctRaw = cells[6];
          const timeLimit = parsePositiveInteger(cells[7], 30);
          const points = parsePositiveInteger(cells[8], 10);

          if (!text) {
            res.status(400).json({ error: `${rowIndex + 1}. satirda soru metni bos olamaz.` });
            return;
          }

          if (options.some((option) => !option)) {
            res.status(400).json({ error: `${rowIndex + 1}. satirda A, B, C ve D seceneklerinin tamami dolu olmalidir.` });
            return;
          }

          const correctAnswer = resolveCorrectAnswer(correctRaw, options);
          if (!correctAnswer) {
            res.status(400).json({ error: `${rowIndex + 1}. satirda dogru cevap A/B/C/D veya secenek metni olarak girilmelidir.` });
            return;
          }

          const validationError = validateQuestionPayload("mcq", text, correctAnswer, options, timeLimit, points);
          if (validationError) {
            res.status(400).json({ error: `${rowIndex + 1}. satir hatasi: ${validationError}` });
            return;
          }

          parsedQuestions.push({
            text,
            imageUrl,
            options,
            correctAnswer,
            timeLimit,
            points,
          });
        }

        if (!parsedQuestions.length) {
          res.status(400).json({ error: "Excel dosyasinda ice aktarilacak soru bulunamadi." });
          return;
        }

        let orderIndex = await getNextQuestionOrderIndex(quizId);

        for (const question of parsedQuestions) {
          await run(
            `INSERT INTO questions (quiz_id, type, text, image_url, options_json, correct_answer, time_limit, points, order_index)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              quizId,
              "mcq",
              question.text,
              question.imageUrl || null,
              JSON.stringify(question.options),
              question.correctAnswer,
              question.timeLimit,
              question.points,
              orderIndex,
            ]
          );
          orderIndex += 1;
        }

        res.json({
          ok: true,
          addedCount: parsedQuestions.length,
          skippedEmptyRows,
        });
      } catch {
        res.status(400).json({ error: "Excel dosyasi okunamadi. Lutfen .xlsx veya .xls formatinda bir dosya yukleyin." });
      }
    });
  });

  api.patch("/api/questions/:questionId", async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { type, text, imageUrl, options, correctAnswer, timeLimit, points } = req.body;

    const currentQuestion = await get("SELECT * FROM questions WHERE id = ?", [questionId]);
    if (!currentQuestion) {
      res.status(404).json({ error: "Soru bulunamadı." });
      return;
    }

    const validationError = validateQuestionPayload(type, text, correctAnswer, options, timeLimit, points);
    if (validationError) {
      res.status(400).json({ error: validationError });
      return;
    }

    const normalizedOptions = Array.isArray(options)
      ? options.map((o) => String(o).trim()).filter(Boolean)
      : [];

    await run(
      `UPDATE questions
       SET type = ?, text = ?, image_url = ?, options_json = ?, correct_answer = ?, time_limit = ?, points = ?
       WHERE id = ?`,
      [
        type,
        text.trim(),
        String(imageUrl || "").trim() || null,
        type === "mcq" ? JSON.stringify(normalizedOptions) : null,
        correctAnswer.trim(),
        Math.max(1, Number(timeLimit) || 30),
        Math.max(1, Number(points) || 10),
        questionId,
      ]
    );

    await broadcastState();
    res.json({ ok: true });
  });

  api.delete("/api/questions/:questionId", async (req, res) => {
    const questionId = Number(req.params.questionId);
    const currentQuestion = await get("SELECT * FROM questions WHERE id = ?", [questionId]);
    if (!currentQuestion) {
      res.status(404).json({ error: "Soru bulunamadı." });
      return;
    }

    await run("DELETE FROM answers WHERE question_id = ?", [questionId]);
    await run("DELETE FROM questions WHERE id = ?", [questionId]);
    await broadcastState();
    res.json({ ok: true, quizId: currentQuestion.quiz_id });
  });

  api.post("/api/session/start", async (req, res) => {
    const { quizId } = req.body;
    const quiz = await get("SELECT id FROM quizzes WHERE id = ?", [quizId]);
    if (!quiz) {
      res.status(404).json({ error: "Quiz bulunamadı." });
      return;
    }

    const totalQuestions = await get("SELECT COUNT(*) as total FROM questions WHERE quiz_id = ?", [quizId]);
    if (!totalQuestions.total) {
      res.status(400).json({ error: "Yayın için en az bir soru gerekli." });
      return;
    }

    const code = randomCode();
    const result = await run(
      "INSERT INTO sessions (quiz_id, code, status, current_question_index) VALUES (?, ?, 'lobby', -1)",
      [quizId, code]
    );
    state.activeSession = { id: result.lastID };
    state.questionDeadline = null;

    await broadcastState();
    res.json({ ok: true, code });
  });

  api.post("/api/participant/join", async (req, res) => {
    const { code, name } = req.body;
    if (!state.activeSession) {
      res.status(400).json({ error: "Aktif yarışma yok." });
      return;
    }

    const session = await get("SELECT * FROM sessions WHERE id = ?", [state.activeSession.id]);
    if (!session || session.code !== String(code || "").trim().toUpperCase()) {
      res.status(400).json({ error: "Kod hatalı veya oturum aktif değil." });
      return;
    }

    if (!isLiveSessionStatus(session.status)) {
      res.status(400).json({ error: "Bu yarışma canlı yayında değil." });
      return;
    }

    if (!name || String(name).trim().length < 2) {
      res.status(400).json({ error: "İsim en az 2 karakter olmalı." });
      return;
    }

    const result = await run(
      "INSERT INTO participants (session_id, name, approved, score) VALUES (?, ?, 0, 0)",
      [session.id, String(name).trim()]
    );

    await broadcastState();
    res.json({ participantId: result.lastID, approved: false });
  });

  api.post("/api/participant/answer", async (req, res) => {
    const { participantId, answer } = req.body;
    if (!state.activeSession) {
      res.status(400).json({ error: "Aktif yarışma yok." });
      return;
    }

    const session = await get("SELECT * FROM sessions WHERE id = ?", [state.activeSession.id]);
    if (!session || session.status !== "question_live") {
      res.status(400).json({ error: "Şu an cevap kabul edilmiyor." });
      return;
    }

    const participant = await get(
      "SELECT * FROM participants WHERE id = ? AND session_id = ? AND approved = 1",
      [participantId, session.id]
    );
    if (!participant) {
      res.status(403).json({ error: "Onaylı katılımcı bulunamadı." });
      return;
    }

    const question = await get(
      "SELECT * FROM questions WHERE quiz_id = ? AND order_index = ?",
      [session.quiz_id, session.current_question_index]
    );
    if (!question) {
      res.status(404).json({ error: "Aktif soru bulunamadı." });
      return;
    }

    const duplicate = await get(
      "SELECT id FROM answers WHERE participant_id = ? AND question_id = ?",
      [participant.id, question.id]
    );
    if (duplicate) {
      res.status(400).json({ error: "Bu soruyu zaten cevapladınız." });
      return;
    }

    const elapsed = Math.max(0, (question.time_limit * 1000) - Math.max(0, state.questionDeadline - Date.now()));
    const isCorrect = normalize(answer) === normalize(question.correct_answer);
    const base = question.points;
    const speedBonus = isCorrect ? Math.floor(Math.max(0, (question.time_limit * 1000 - elapsed) / 100)) : 0;
    const gained = isCorrect ? base + speedBonus : 0;

    await run(
      "INSERT INTO answers (participant_id, question_id, answer, is_correct, elapsed_ms) VALUES (?, ?, ?, ?, ?)",
      [participant.id, question.id, String(answer || ""), isCorrect ? 1 : 0, elapsed]
    );

    if (gained > 0) {
      await run("UPDATE participants SET score = score + ? WHERE id = ?", [gained, participant.id]);
    }

    await broadcastState();
    res.json({ ok: true, isCorrect, gained });
  });

  api.post("/api/session/approve", async (req, res) => {
    const { participantId, approved } = req.body;
    if (!state.activeSession) {
      res.status(400).json({ error: "Aktif yarışma yok." });
      return;
    }
    const approvedValue = approved ? 1 : -1;
    await run("UPDATE participants SET approved = ? WHERE id = ? AND session_id = ?", [
      approvedValue,
      participantId,
      state.activeSession.id,
    ]);
    await broadcastState();
    res.json({ ok: true });
  });

  api.patch("/api/participants/:participantId", async (req, res) => {
    const participantId = Number(req.params.participantId);
    const { name } = req.body;

    if (!name || String(name).trim().length < 2) {
      res.status(400).json({ error: "İsim en az 2 karakter olmalı." });
      return;
    }

    const participant = state.activeSession
      ? await get("SELECT * FROM participants WHERE id = ? AND session_id = ?", [participantId, state.activeSession.id])
      : await get("SELECT * FROM participants WHERE id = ?", [participantId]);

    if (!participant) {
      res.status(404).json({ error: "Katılımcı bulunamadı." });
      return;
    }

    await run("UPDATE participants SET name = ? WHERE id = ?", [String(name).trim(), participantId]);
    await broadcastState();
    res.json({ ok: true });
  });

  api.delete("/api/participants/:participantId", async (req, res) => {
    const participantId = Number(req.params.participantId);

    const participant = state.activeSession
      ? await get("SELECT * FROM participants WHERE id = ? AND session_id = ?", [participantId, state.activeSession.id])
      : await get("SELECT * FROM participants WHERE id = ?", [participantId]);

    if (!participant) {
      res.status(404).json({ error: "Katılımcı bulunamadı." });
      return;
    }

    await run("DELETE FROM answers WHERE participant_id = ?", [participantId]);
    await run("DELETE FROM participants WHERE id = ?", [participantId]);
    await broadcastState();
    res.json({ ok: true });
  });

  api.post("/api/session/next", async (req, res) => {
    if (!state.activeSession) {
      res.status(400).json({ error: "Aktif yarışma yok." });
      return;
    }
    const session = await get("SELECT * FROM sessions WHERE id = ?", [state.activeSession.id]);

    const total = await get("SELECT COUNT(*) as total FROM questions WHERE quiz_id = ?", [session.quiz_id]);
    const nextIndex = session.current_question_index + 1;

    if (nextIndex >= total.total) {
      await setSessionStatus("finished", session.current_question_index);
      state.questionDeadline = null;
      if (state.timerRef) {
        clearTimeout(state.timerRef);
        state.timerRef = null;
      }
      await broadcastState();
      res.json({ ok: true, finished: true });
      return;
    }

    const question = await get("SELECT * FROM questions WHERE quiz_id = ? AND order_index = ?", [
      session.quiz_id,
      nextIndex,
    ]);

    await setSessionStatus("question_live", nextIndex);
    state.questionDeadline = Date.now() + question.time_limit * 1000;

    if (state.timerRef) {
      clearTimeout(state.timerRef);
      state.timerRef = null;
    }

    state.timerRef = setTimeout(async () => {
      await setSessionStatus("between_questions", nextIndex);
      state.questionDeadline = null;
      await broadcastState();
    }, question.time_limit * 1000);

    await broadcastState();
    res.json({ ok: true });
  });

  api.post("/api/session/end-question", async (req, res) => {
    if (!state.activeSession) {
      res.status(400).json({ error: "Aktif yarışma yok." });
      return;
    }
    const session = await get("SELECT * FROM sessions WHERE id = ?", [state.activeSession.id]);
    await setSessionStatus("between_questions", session.current_question_index);
    state.questionDeadline = null;
    if (state.timerRef) {
      clearTimeout(state.timerRef);
      state.timerRef = null;
    }
    await broadcastState();
    res.json({ ok: true });
  });

  api.post("/api/session/stop", async (req, res) => {
    if (!state.activeSession) {
      res.status(400).json({ error: "Aktif yarışma yok." });
      return;
    }

    const session = await get("SELECT * FROM sessions WHERE id = ?", [state.activeSession.id]);
    if (session) {
      await run("UPDATE sessions SET status = ? WHERE id = ?", ["stopped", session.id]);
    }

    state.activeSession = null;
    state.questionDeadline = null;
    if (state.timerRef) {
      clearTimeout(state.timerRef);
      state.timerRef = null;
    }

    await broadcastState();
    res.json({ ok: true });
  });

  api.get("/api/session/state", async (req, res) => {
    const participantId = req.query.participantId ? Number(req.query.participantId) : null;
    const snapshot = await fetchSessionSnapshot(participantId);
    res.json(snapshot);
  });

  const server = http.createServer(api);
  const wss = new WebSocketServer({ server });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const participantId = url.searchParams.get("participantId");
    socket.meta = { participantId: participantId ? Number(participantId) : null };
    state.sockets.add(socket);

    socket.on("close", () => {
      state.sockets.delete(socket);
    });

    fetchSessionSnapshot(socket.meta.participantId)
      .then((snapshot) => {
        socket.send(JSON.stringify({ type: "state", payload: snapshot }));
      })
      .catch(() => {
        socket.send(JSON.stringify({ type: "error", payload: "Durum bilgisi alınamadı." }));
      });
  });

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

function createWindows() {
  const adminWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    title: "Yönetim Ekranı",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  adminWindow.loadURL(`http://localhost:${PORT}/admin.html`);
}

app.whenReady().then(async () => {
  await initDb();
  await ensureSessionLoaded();
  setupServer();
  createWindows();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

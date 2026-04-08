const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dbPath = path.join(__dirname, "..", "quiz.db");
const db = new sqlite3.Database(dbPath);

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function normTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .trim();
}

const targetTitles = new Set(["cem finali", "genel kultur finali"]);

const questionBank = {
  "cem finali": [
    {
      text: "[MOCK] Türkiye'nin başkenti neresidir?",
      options: ["İstanbul", "Ankara", "İzmir", "Bursa"],
      correct: "Ankara",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] 2 + 5 x 2 işleminin sonucu kaçtır?",
      options: ["14", "12", "10", "9"],
      correct: "12",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] Aşağıdakilerden hangisi bir programlama dilidir?",
      options: ["HTML", "Python", "CSS", "HTTP"],
      correct: "Python",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] Dünya'nın uydusunun adı nedir?",
      options: ["Mars", "Güneş", "Ay", "Venüs"],
      correct: "Ay",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] Aşağıdakilerden hangisi bir kıta değildir?",
      options: ["Afrika", "Avrupa", "Sibirya", "Asya"],
      correct: "Sibirya",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] Bir haftada kaç gün vardır?",
      options: ["5", "6", "7", "8"],
      correct: "7",
      time: 15,
      points: 100,
    },
    {
      text: "[MOCK] Su kaç derecede kaynar? (Deniz seviyesinde)",
      options: ["90", "95", "100", "110"],
      correct: "100",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] Aşağıdakilerden hangisi bir gezegendir?",
      options: ["Sirius", "Andromeda", "Jüpiter", "Orion"],
      correct: "Jüpiter",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] Türkiye'nin para birimi nedir?",
      options: ["Euro", "Dolar", "Türk Lirası", "Sterlin"],
      correct: "Türk Lirası",
      time: 20,
      points: 100,
    },
    {
      text: "[MOCK] Aşağıdakilerden hangisi bir mevsim değildir?",
      options: ["İlkbahar", "Yaz", "Muson", "Kış"],
      correct: "Muson",
      time: 20,
      points: 100,
    },
  ],
  "genel kultur finali": [
    {
      text: "[MOCK] Mona Lisa tablosunun ressamı kimdir?",
      options: ["Van Gogh", "Picasso", "Leonardo da Vinci", "Rembrandt"],
      correct: "Leonardo da Vinci",
      time: 25,
      points: 120,
    },
    {
      text: "[MOCK] Cumhuriyet hangi yıl ilan edilmiştir?",
      options: ["1919", "1920", "1923", "1938"],
      correct: "1923",
      time: 20,
      points: 120,
    },
    {
      text: "[MOCK] En büyük okyanus hangisidir?",
      options: ["Atlas", "Hint", "Pasifik", "Arktik"],
      correct: "Pasifik",
      time: 20,
      points: 120,
    },
    {
      text: "[MOCK] Bir saatte kaç dakika vardır?",
      options: ["50", "55", "60", "65"],
      correct: "60",
      time: 15,
      points: 100,
    },
    {
      text: "[MOCK] İstiklal Marşı'nın yazarı kimdir?",
      options: ["Namık Kemal", "Mehmet Akif Ersoy", "Yahya Kemal", "Tevfik Fikret"],
      correct: "Mehmet Akif Ersoy",
      time: 25,
      points: 120,
    },
    {
      text: "[MOCK] Aşağıdakilerden hangisi asal sayıdır?",
      options: ["21", "29", "33", "39"],
      correct: "29",
      time: 20,
      points: 120,
    },
    {
      text: "[MOCK] DNA'nın açılımı nedir?",
      options: ["Deoksiribonükleik Asit", "Dinamik Nükleer Analiz", "Doğal Nöral Ağ", "Dijital Numara Ağı"],
      correct: "Deoksiribonükleik Asit",
      time: 25,
      points: 130,
    },
    {
      text: "[MOCK] Türkiye hangi yarımkürededir?",
      options: ["Kuzey", "Güney", "Doğu", "Batı"],
      correct: "Kuzey",
      time: 20,
      points: 120,
    },
    {
      text: "[MOCK] Aşağıdaki şehirlerden hangisi Ege Bölgesi'ndedir?",
      options: ["Trabzon", "Gaziantep", "Manisa", "Erzurum"],
      correct: "Manisa",
      time: 20,
      points: 120,
    },
    {
      text: "[MOCK] Güneş sistemindeki en küçük gezegen hangisidir?",
      options: ["Merkür", "Mars", "Dünya", "Venüs"],
      correct: "Merkür",
      time: 20,
      points: 120,
    },
  ],
};

async function main() {
  const quizzes = await all("SELECT id, title FROM quizzes ORDER BY id ASC");
  const matched = quizzes.filter((q) => targetTitles.has(normTitle(q.title)));

  if (!matched.length) {
    console.log("Hedef quizler bulunamadı. Başlıkları kontrol edin.");
    return;
  }

  let totalInserted = 0;

  for (const quiz of matched) {
    const key = normTitle(quiz.title);
    const questions = questionBank[key] || [];

    const existingRows = await all("SELECT text FROM questions WHERE quiz_id = ?", [quiz.id]);
    const existingTexts = new Set(existingRows.map((row) => row.text));

    const row = await get("SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM questions WHERE quiz_id = ?", [quiz.id]);
    let nextOrder = Number(row.maxOrder) + 1;

    let insertedForQuiz = 0;
    for (const q of questions) {
      if (existingTexts.has(q.text)) {
        continue;
      }

      await run(
        `INSERT INTO questions (quiz_id, type, text, options_json, correct_answer, time_limit, points, order_index)
         VALUES (?, 'mcq', ?, ?, ?, ?, ?, ?)`,
        [quiz.id, q.text, JSON.stringify(q.options), q.correct, q.time, q.points, nextOrder]
      );

      nextOrder += 1;
      insertedForQuiz += 1;
      totalInserted += 1;
    }

    console.log(`${quiz.title}: ${insertedForQuiz} yeni soru eklendi.`);
  }

  console.log(`Toplam eklenen soru: ${totalInserted}`);
}

main()
  .catch((err) => {
    console.error("Seed sırasında hata:", err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
  });

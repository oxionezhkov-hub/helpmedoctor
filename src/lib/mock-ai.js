// Заглушка Workers AI для локальных тестов (включается переменной AI_MOCK=1).
// В проде не используется: там всегда есть binding env.AI.

function lastUser(messages) {
  return messages?.filter((m) => m.role === "user").pop()?.content || "";
}

export const mockAi = {
  async run(model, input) {
    const res = await mockRun(model, input);
    if (model.includes("whisper")) return { ...res, transcription_info: { duration: 3.2 } };
    const prompt = (input?.messages || []).map((m) => m.content).join(" ");
    const out = typeof res.response === "string" ? res.response : JSON.stringify(res.response);
    return { ...res, usage: { prompt_tokens: Math.ceil(prompt.length / 2.5), completion_tokens: Math.ceil(out.length / 2.5) } };
  },
};

const mockImpl = {
  async run(model, input) {
    const prompt = lastUser(input?.messages);
    // Реалистичные задержки: генерация пациента заметно дольше остального
    await new Promise((r) => setTimeout(r, /Создай (уникального|пациента)/.test(prompt) ? 3000 : 400));
    if (model.includes("whisper")) return { text: "Где именно болит и как давно?" };
    if (prompt.includes("Создай уникального реалистичного пациента")) {
      // Как настоящая модель: иногда текст вокруг JSON
      return { response: 'Вот пациент:\n```json\n{"name":"Мирон Лесков","age":47,"sex":"male","chief_complaint":"Жжёт под ложечкой после еды","true_diagnosis":"Язвенная болезнь 12-перстной кишки, обострение","full_history":"Боли натощак 3 недели, курит, НПВС от спины.","personality":"ворчливый, но честный","condition_trajectory":"stable","opening_phrase":"Доктор, у меня опять живот крутит, сил нет.","findings":{"exam":"Болезненность в эпигастрии при пальпации","lab":"Hb 118 г/л","imaging":"ФГДС: язва 8 мм луковицы ДПК","ecg":"норма","pathology":"H. pylori +"}}\n```' };
    }
    if (prompt.includes("Верни JSON: {\"sensation\"")) {
      return { response: { sensation: "Болезненность в эпигастрии при пальпации, живот мягкий.", reaction: "Ай, вот тут больно!" } };
    }
    if (prompt.includes("Разбери приём")) {
      return { response: JSON.stringify({ axes: { diagnosis: 5, communication: 4, treatment: 4 }, diagnosis_correct: "yes", critical_error: "", mkb10: "K26.3", expert_text: "Хороший сбор анамнеза, диагноз близок.", dialog_moments: [{ quote: "Где болит?", comment: "Хороший открытый вопрос" }], strengths: ["Сбор анамнеза"], weaknesses: ["Эрадикация H. pylori"], recommendation: "Назначайте ФГДС раньше.", outcome_update: "improving", post_story: "Через 3 недели боли ушли." }) };
    }
    if (prompt.includes("Врач попросил подсказку")) {
      return { response: { hint: "Пациент жалуется на боли под ложечкой по ночам, но вы ещё не выяснили, какие лекарства он принимает. Уточните приём обезболивающих — от этого зависит, о чём думать в первую очередь.", kind: "question" } };
    }
    if (prompt.includes("Составь учебный разбор случая")) {
      return { response: {
        diagnosis_path: ["Голодные ночные боли в эпигастрии → язвенный анамнез", "Приём НПВС → фактор риска язвы", "ЭГДС подтверждает язву луковицы ДПК"],
        must: [{ item: "Спросить о связи боли с едой и ночных болях", done: true }, { item: "Спросить о приёме НПВС", done: false }, { item: "ЭГДС с биопсией и тестом на H. pylori", done: false }, { item: "Общий анализ крови (анемия)", done: true }],
        optional: ["Анализ кала на скрытую кровь"],
        tests: [{ name: "ЭГДС", why: "увидеть язву и взять биопсию" }, { name: "Дыхательный уреазный тест", why: "подтвердить H. pylori" }],
        treatment: [{ drug: "Омепразол", dose: "20 мг внутрь 2 раза в сутки", duration: "14 дней, затем 20 мг 1 раз", note: "ИПП в составе эрадикации", source: "kr" }, { drug: "Амоксициллин", dose: "1000 мг внутрь 2 раза в сутки", duration: "14 дней", note: "эрадикация H. pylori", source: "kr" }],
        non_drug: "Отменить НПВС, дробное питание, отказ от курения. Контрольная ЭГДС через 6-8 недель.",
        red_flags: ["Мелена или рвота кофейной гущей — срочная госпитализация"],
        mistakes: ["Не спросили о приёме НПВС"],
      } };
    }
    if (prompt.includes("работа над ошибками")) {
      return { response: { questions: Array.from({ length: 5 }, (_, i) => ({ text: `Вопрос ${i + 1}: что первым при подозрении на язву?`, options: ["ФГДС", "КТ", "МРТ", "ЭКГ"], correct: 0, topic: i < 2 ? "treatment" : "diagnostics", explanation: "По КР «Язвенная болезнь» ФГДС — метод выбора." })) } };
    }
    if (prompt.includes("клинических разделов")) return { response: { sections: ["Желтуха новорождённых", "недоношенность", "родовая травма"] } };
    if (prompt.includes("Сожми диалог")) return { response: "Пациент жалуется на боли в эпигастрии." };
    if (prompt.includes("Напиши протокол обследования")) return { response: "Пациент: Мирон Лесков, 47 лет\nHb 118 г/л (130-160)\nЛейкоциты 7,2 ×10⁹/л (4-9)" };
    if (prompt.includes("Попрощайся")) return { response: "«Спасибо, доктор, пойду лечиться.»" };
    return { response: "Пациент: Болит под ложечкой, особенно ночью." };
  },
};

function mockRun(model, input) {
  return mockImpl.run(model, input);
}

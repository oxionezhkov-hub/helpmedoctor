// Заглушка Workers AI для локальных тестов (включается переменной AI_MOCK=1).
// В проде не используется: там всегда есть binding env.AI.

function lastUser(messages) {
  return messages?.filter((m) => m.role === "user").pop()?.content || "";
}

export const mockAi = {
  async run(model, input) {
    await new Promise((r) => setTimeout(r, 150));
    if (model.includes("whisper")) return { text: "Где именно болит и как давно?" };
    const prompt = lastUser(input.messages);
    if (prompt.includes("Создай пациента-ИНОПЛАНЕТЯНИНА")) {
      return { response: { name: "Зорг Кварк", age: "340 земных лет", sex: "неизвестен", chief_complaint: "Мерцает третий гребень", true_diagnosis: "Гребневая мерцалгия", full_history: "Гребень мерцает неделю.", personality: "вежливый", condition_trajectory: "stable", opening_phrase: "Приветствую, земной лекарь!", key_findings: "Гребень светится" } };
    }
    if (prompt.includes("Создай уникального реалистичного пациента")) {
      // Как настоящая модель: иногда текст вокруг JSON
      return { response: 'Вот пациент:\n```json\n{"name":"Мирон Лесков","age":47,"sex":"male","chief_complaint":"Жжёт под ложечкой после еды","true_diagnosis":"Язвенная болезнь 12-перстной кишки, обострение","full_history":"Боли натощак 3 недели, курит, НПВС от спины.","personality":"ворчливый, но честный","condition_trajectory":"stable","opening_phrase":"Доктор, у меня опять живот крутит, сил нет.","key_findings":"Hb 118 г/л, ФГДС: язва 8 мм луковицы ДПК, H. pylori +"}\n```' };
    }
    if (prompt.includes("Верни JSON: {\"sensation\"")) {
      return { response: { sensation: "Болезненность в эпигастрии при пальпации, живот мягкий.", reaction: "Ай, вот тут больно!" } };
    }
    if (prompt.includes("Разбери приём ординатора")) {
      return { response: JSON.stringify({ rating: 4.2, axes: { diagnosis: 4, communication: 5, treatment: 3 }, diagnosis_correct: "partial", expert_text: "Хороший сбор анамнеза, диагноз близок.", dialog_moments: [{ quote: "Где болит?", comment: "Хороший открытый вопрос" }], strengths: ["Сбор анамнеза"], weaknesses: ["Эрадикация H. pylori"], recommendation: "Назначайте ФГДС раньше.", outcome_update: "improving", post_story: "Через 3 недели боли ушли." }) };
    }
    if (prompt.includes("работа над ошибками")) {
      return { response: { questions: Array.from({ length: 5 }, (_, i) => ({ text: `Вопрос ${i + 1}: что первым при подозрении на язву?`, options: ["ФГДС", "КТ", "МРТ", "ЭКГ"], correct: 0, explanation: "ФГДС — золотой стандарт." })) } };
    }
    if (prompt.includes("Сожми диалог")) return { response: "Пациент жалуется на боли в эпигастрии." };
    if (prompt.includes("Напиши протокол обследования")) return { response: "Пациент: Мирон Лесков, 47 лет\nHb 118 г/л (130-160)\nЛейкоциты 7,2 ×10⁹/л (4-9)" };
    if (prompt.includes("Попрощайся")) return { response: "«Спасибо, доктор, пойду лечиться.»" };
    return { response: "Пациент: Болит под ложечкой, особенно ночью." };
  },
};

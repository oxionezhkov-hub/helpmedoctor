const CARDIOLOGY = {
  id: "cardiology",
  title: "Кардиология",
  description: "Уточняйте жалобы и обосновывайте выводы по анамнезу и обследованиям.",
  cases: [
    {
      id: "palpitations",
      title: "Сердцебиение",
      goal: "Уточнить начало, длительность и характер эпизодов.",
      premium: false,
      patient: {
        name: "Ирина", age: 42, sex: "female", specialty: "кардиология",
        chief_complaint: "Эпизоды сердцебиения",
        true_diagnosis: "Предсердная экстрасистолия", mkb10: "I49.1",
        opening_phrase: "Иногда сердце вдруг сильно стучит.",
        full_history: "Замечает около недели. Во время эпизода ощущает паузы и затем сильные одиночные толчки. Последний эпизод длился около пяти минут, ощущения возникали с перерывами. Чаще замечает вечером после кофе, при обычной нагрузке жалоб нет. Обмороков, одышки и дискомфорта в груди не было. Болезней сердца не знает.",
        personality: "Спокойна, описывает ощущения простыми словами и раскрывает детали по вопросам.",
        key_findings: "В дневнике мониторирования отметила знакомые толчки. Им соответствуют одиночные предсердные экстрасистолы. Устойчивых тахиаритмий нет.",
        findings: { exam: "АД 118/76 мм рт. ст. Пульс 72 в минуту. Тоны сердца ясные.", ecg: "На ЭКГ покоя синусовый ритм. При суточном мониторировании одиночные предсердные экстрасистолы совпадают с отметками жалоб." },
      },
    },
    {
      id: "exertional-dyspnea",
      title: "Одышка при нагрузке",
      goal: "Сравнить прежнюю и текущую переносимость нагрузки.",
      premium: true,
      patient: {
        name: "Олег", age: 63, sex: "male", specialty: "кардиология",
        chief_complaint: "Одышка при подъёме по лестнице",
        true_diagnosis: "Хроническая сердечная недостаточность со сниженной фракцией выброса", mkb10: "I50.0",
        opening_phrase: "Мне стало тяжело подниматься по лестнице.",
        full_history: "За три месяца переносимость нагрузки постепенно снизилась. Раньше поднимался на четвёртый этаж без остановки, теперь останавливается после первого. По вечерам отекают лодыжки. В покое одышки нет. Ранее перенёс инфаркт миокарда, много лет наблюдается по поводу повышенного давления.",
        personality: "Коротко отвечает на общие вопросы, охотно приводит бытовые примеры при уточнении.",
        key_findings: "Снижение переносимости нагрузки, двусторонние отёки, инфаркт в анамнезе, снижение фракции выброса левого желудочка.",
        findings: { exam: "АД 130/80 мм рт. ст. Пульс 78 в минуту. Небольшие симметричные отёки лодыжек, дыхание без хрипов.", lab: "NT-proBNP повышен, гемоглобин в пределах нормы.", imaging: "ЭхоКГ: фракция выброса левого желудочка 35%, гипокинез передней стенки." },
      },
    },
    {
      id: "walking-discomfort",
      title: "Самочувствие при ходьбе",
      goal: "Связать жалобу с нагрузкой и отдыхом.",
      premium: true,
      patient: {
        name: "Вера", age: 59, sex: "female", specialty: "кардиология",
        chief_complaint: "Дискомфорт в груди при ходьбе",
        true_diagnosis: "Стабильная стенокардия напряжения", mkb10: "I20.8",
        opening_phrase: "На прогулках бывает неприятно в груди.",
        full_history: "В течение трёх месяцев отмечает одинаковые эпизоды давления за грудиной при ходьбе в гору. После остановки ощущение проходит за несколько минут. При неспешной ходьбе по ровной дороге и в покое жалоб нет. Частота и интенсивность эпизодов не менялись. Известны артериальная гипертензия и повышенный холестерин.",
        personality: "Слово «боль» не использует, но может точно описать ощущение и обстоятельства.",
        key_findings: "Давление за грудиной воспроизводимо при определённой нагрузке и быстро проходит в покое. Порог нагрузки стабилен.",
        findings: { exam: "АД 136/82 мм рт. ст. Пульс 70 в минуту. Тоны сердца ритмичные, отёков нет.", ecg: "На ЭКГ покоя синусовый ритм, без значимых отклонений.", imaging: "При стресс-эхокардиографии на высоте нагрузки появляется преходящее нарушение сократимости передней стенки." },
      },
    },
  ],
};

export function getProgram(id) {
  return id === CARDIOLOGY.id ? CARDIOLOGY : null;
}

export function programOfferVariant(uid) {
  let hash = 2166136261;
  for (const ch of `cardiology-first-review:${uid}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619);
  return (hash >>> 16) % 2 ? "card" : "control";
}

export function programSnapshot(progress = {}, premium = false) {
  const { cases, ...program } = CARDIOLOGY;
  return {
    ...program,
    cases: cases.map(({ id, title, goal, premium: casePremium }, i) => {
      const entry = progress[id];
      return {
        id, title, goal, premium: casePremium,
        locked: casePremium && !premium,
        available: i === 0 || !!progress[cases[i - 1].id]?.finished_at,
        finished: !!entry?.finished_at,
        patient_id: !casePremium || premium ? entry?.patient_id || null : null,
      };
    }),
  };
}

export function mergeProgramProgress(current = {}, incoming = {}) {
  const program = CARDIOLOGY.id;
  const progress = { ...current[program] };
  for (const { id } of CARDIOLOGY.cases) {
    const entry = incoming[program]?.[id];
    if (entry && (!progress[id] || (!progress[id].finished_at && entry.finished_at))) progress[id] = entry;
  }
  return { ...current, [program]: progress };
}

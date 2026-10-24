#!/usr/bin/env python3
"""Проверка текстов объявлений под лимиты Яндекс.Директа.

Использование: python3 check_ads.py direct/campaigns/<имя>.json
Формат файла — templates/campaign.example.json.
Код возврата 1, если есть ошибки.
"""
import json
import re
import sys

NARROW = set('.,!:;"')
NARROW_MAX = 15

# поле: (лимит знаков без узких, максимум длины слова)
LIMITS = {
    "title": (56, 22),
    "title2": (30, 22),
    "text": (81, 23),
}
CALLOUT_MAX = 25
SITELINK_TITLE_MAX = 30
FORBIDDEN = ["лучший", "лучшая", "лучшее", "№1", "номер один", "самый", "самая", "самое"]


def check_field(kind, value):
    errors = []
    limit, word_max = LIMITS[kind]
    narrow = sum(1 for ch in value if ch in NARROW)
    length = sum(1 for ch in value if ch not in NARROW)
    if length > limit:
        errors.append(f"{length} знаков при лимите {limit}")
    if narrow > NARROW_MAX:
        errors.append(f"{narrow} узких знаков при лимите {NARROW_MAX}")
    for word in re.split(r"\s+", value):
        if len(word) > word_max:
            errors.append(f"слово «{word}» длиннее {word_max}")
    low = value.lower()
    for bad in FORBIDDEN:
        if bad in low:
            errors.append(f"запрещённое слово «{bad}»")
    return errors


def main(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    problems = 0
    for group in data.get("groups", []):
        for i, ad in enumerate(group.get("ads", []), 1):
            where = f"{group.get('name', '?')} / объявление {i}"
            fields = [("title", t) for t in ad.get("titles", [])]
            if ad.get("title2"):
                fields.append(("title2", ad["title2"]))
            fields += [("text", t) for t in ad.get("texts", [])]
            for kind, value in fields:
                for err in check_field(kind, value):
                    problems += 1
                    print(f"✗ {where} · {kind}: «{value}» — {err}")
            for c in ad.get("callouts", []):
                if len(c) > CALLOUT_MAX:
                    problems += 1
                    print(f"✗ {where} · уточнение «{c}» — {len(c)} знаков при лимите {CALLOUT_MAX}")
            for s in ad.get("sitelinks", []):
                if len(s.get("title", "")) > SITELINK_TITLE_MAX:
                    problems += 1
                    print(f"✗ {where} · быстрая ссылка «{s['title']}» — длиннее {SITELINK_TITLE_MAX}")
    if problems:
        print(f"\nОшибок: {problems}. Перепиши эти тексты и запусти проверку снова.")
        return 1
    print("✓ Все тексты укладываются в лимиты Директа")
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))

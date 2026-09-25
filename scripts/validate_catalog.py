#!/usr/bin/env python
"""
Скрипт валидации JSON-каталогов проекта «Элия»

Проверяет целостность и корректность файлов:
- data/techniques_catalog.json (каталог техник)
- data/questionnaire_full.json (опросник)

Использование:
    python scripts/validate_catalog.py                      # Проверить все файлы
    python scripts/validate_catalog.py --techniques         # Только каталог техник
    python scripts/validate_catalog.py --questionnaire      # Только опросник
    python scripts/validate_catalog.py --audio              # Только аудио-транскрипты
    python scripts/validate_catalog.py --verbose            # Подробный отчёт

Автор: Команда Элии
Версия: 1.0
Дата: 2026-08-31
"""

import json
import sys
import argparse
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Any, Tuple


# ============================================================================
# КОНСТАНТЫ И РАЗРЕШЁННЫЕ ЗНАЧЕНИЯ
# ============================================================================

# Разрешённые значения тегов (из docs/05_Библиотека_техник.md)
VALID_LEVELS = {"red", "yellow", "green"}
VALID_CONTEXTS = {"sleep", "work", "conflict", "medical", "physical", 
                  "psychosocial", "practical", "social", "any"}
VALID_PSYCHOTYPES = {"Инноватор", "Эстет", "Консерватор", "Эмпат", 
                     "Аналитик", "Прагматик", "Индивидуалист", "Лидер Мнений", "any"}
VALID_STRESS_REACTIONS = {"Бей", "Беги", "Замри", "Коммуницируй", 
                          "Мимикрия", "Дефлексия", "Сливайся с толпой", "any"}
VALID_TRIMESTERS = {"1", "2", "3", "0-3m", "3-6m", "6-12m", "any"}
VALID_FORMATS = {"audio", "text", "video", "interactive", "timer"}
VALID_DURATIONS = {"short", "medium", "long"}

# MaxPossible для опросника (из docs/03_Диагностика.md)
EXPECTED_MAX_POSSIBLE = {
    "agr": 18, "sp": 9, "ex": 8, "lab": 9,
    "tr": 16, "sen": 17, "in": 10, "rig": 16
}
VALID_TRAITS = set(EXPECTED_MAX_POSSIBLE.keys())

# Ожидаемое количество премиум-техник (из docs/08_Монетизация_VK_Pay.md)
EXPECTED_PREMIUM_COUNT = 15

# Все 8 психотипов (без "any")
ALL_PSYCHOTYPES = {p for p in VALID_PSYCHOTYPES if p != "any"}


# ============================================================================
# КЛАСС ДЛЯ СБОРА ОШИБОК И ПРЕДУПРЕЖДЕНИЙ
# ============================================================================

class ValidationReport:
    """Собирает ошибки, предупреждения и информационные сообщения"""
    
    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.info: List[str] = []
    
    def add_error(self, message: str):
        self.errors.append(message)
    
    def add_warning(self, message: str):
        self.warnings.append(message)
    
    def add_info(self, message: str):
        self.info.append(message)
    
    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0
    
    def print_report(self, verbose: bool = False):
        """Выводит отчёт в консоль"""
        print("\n" + "=" * 70)
        print("📋 ОТЧЁТ О ВАЛИДАЦИИ")
        print("=" * 70)
        
        # Ошибки
        if self.errors:
            print(f"\n❌ ОШИБКИ ({len(self.errors)}):")
            for i, error in enumerate(self.errors, 1):
                print(f"   {i}. {error}")
        else:
            print("\n✅ Ошибок не найдено")
        
        # Предупреждения
        if self.warnings:
            print(f"\n⚠️  ПРЕДУПРЕЖДЕНИЯ ({len(self.warnings)}):")
            for i, warning in enumerate(self.warnings, 1):
                print(f"   {i}. {warning}")
        
        # Информация (только в verbose-режиме)
        if verbose and self.info:
            print(f"\nℹ️  ИНФОРМАЦИЯ ({len(self.info)}):")
            for i, info in enumerate(self.info, 1):
                print(f"   {i}. {info}")
        
        # Итог
        print("\n" + "-" * 70)
        if self.is_valid:
            print("✅ ВАЛИДАЦИЯ ПРОЙДЕНА УСПЕШНО")
        else:
            print("❌ ВАЛИДАЦИЯ НЕ ПРОЙДЕНА")
        print("-" * 70)


# ============================================================================
# ВАЛИДАЦИЯ КАТАЛОГА ТЕХНИК
# ============================================================================

def validate_techniques_catalog(file_path: Path, report: ValidationReport) -> Dict[str, Any]:
    """
    Валидирует data/techniques_catalog.json
    
    Возвращает словарь со статистикой:
    {
        'total': int,
        'premium': int,
        'free': int,
        'by_psychotype': dict,
        'by_level': dict,
        ...
    }
    """
    print(f"\n Валидация каталога техник: {file_path}")
    
    if not file_path.exists():
        report.add_error(f"Файл не найден: {file_path}")
        return {}
    
    # Загрузка JSON
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        report.add_error(f"Ошибка парсинга JSON: {e}")
        return {}
    except UnicodeDecodeError as e:
        report.add_error(f"Ошибка кодировки (ожидается UTF-8): {e}")
        return {}
    
    # Проверка структуры верхнего уровня
    if 'techniques' not in data:
        report.add_error("Отсутствует ключ 'techniques' в корне файла")
        return {}
    
    techniques = data['techniques']
    if not isinstance(techniques, list):
        report.add_error("Ключ 'techniques' должен быть списком")
        return {}
    
    # Статистика
    stats = {
        'total': len(techniques),
        'premium': 0,
        'free': 0,
        'by_psychotype': defaultdict(int),
        'by_level': defaultdict(int),
        'by_context': defaultdict(int),
        'by_format': defaultdict(int),
        'by_duration': defaultdict(int),
        'premium_by_psychotype': defaultdict(list),
        'ids': set(),
        'slugs': set(),
        'audio': {}
    }
    
    # Валидация каждой техники
    for idx, tech in enumerate(techniques, 1):
        prefix = f"Техника #{idx}"
        
        if not isinstance(tech, dict):
            report.add_error(f"{prefix}: должна быть объектом (dict)")
            continue
        
        # === Обязательные поля ===
        required_fields = ['technique_id', 'title', 'slug', 'description', 
                          'scientific_basis', 'tags', 'content']
        for field in required_fields:
            if field not in tech:
                report.add_error(f"{prefix}: отсутствует обязательное поле '{field}'")
        
        # === technique_id ===
        tech_id = tech.get('technique_id')
        if tech_id is not None:
            if not isinstance(tech_id, int):
                report.add_error(f"{prefix}: technique_id должен быть int, получено {type(tech_id).__name__}")
            elif tech_id in stats['ids']:
                report.add_error(f"{prefix}: дублирующийся technique_id = {tech_id}")
            else:
                stats['ids'].add(tech_id)
        
        # === title ===
        title = tech.get('title', '')
        if not isinstance(title, str) or not title.strip():
            report.add_error(f"{prefix}: title пустой или не является строкой")
        elif len(title) > 100:
            report.add_warning(f"{prefix}: title слишком длинный ({len(title)} символов, макс. 100)")
        
        # === slug ===
        slug = tech.get('slug', '')
        if not isinstance(slug, str) or not slug.strip():
            report.add_error(f"{prefix}: slug пустой или не является строкой")
        elif slug in stats['slugs']:
            report.add_error(f"{prefix}: дублирующийся slug = '{slug}'")
        else:
            stats['slugs'].add(slug)
        
        # === description ===
        description = tech.get('description', '')
        if not isinstance(description, str) or not description.strip():
            report.add_error(f"{prefix}: description пустой или не является строкой")
        elif len(description) > 200:
            report.add_warning(f"{prefix}: description слишком длинный ({len(description)} символов, макс. 200)")
        
        # === scientific_basis ===
        scientific_basis = tech.get('scientific_basis', '')
        if not isinstance(scientific_basis, str) or not scientific_basis.strip():
            report.add_error(f"{prefix}: scientific_basis пустой или не является строкой")
        
        # === tags ===
        tags = tech.get('tags', {})
        if not isinstance(tags, dict):
            report.add_error(f"{prefix}: tags должен быть объектом")
        else:
            # level
            levels = tags.get('level', [])
            if not isinstance(levels, list) or not levels:
                report.add_error(f"{prefix}: tags.level должен быть непустым списком")
            else:
                for level in levels:
                    if level not in VALID_LEVELS:
                        report.add_error(f"{prefix}: недопустимый level = '{level}'")
                    else:
                        stats['by_level'][level] += 1
            
            # context
            contexts = tags.get('context', [])
            if not isinstance(contexts, list) or not contexts:
                report.add_error(f"{prefix}: tags.context должен быть непустым списком")
            else:
                for ctx in contexts:
                    if ctx not in VALID_CONTEXTS:
                        report.add_error(f"{prefix}: недопустимый context = '{ctx}'")
                    else:
                        stats['by_context'][ctx] += 1
            
            # psychotypes
            psychotypes = tags.get('psychotypes', [])
            if not isinstance(psychotypes, list) or not psychotypes:
                report.add_error(f"{prefix}: tags.psychotypes должен быть непустым списком")
            else:
                for ptype in psychotypes:
                    if ptype not in VALID_PSYCHOTYPES:
                        report.add_error(f"{prefix}: недопустимый psychotype = '{ptype}'")
                    else:
                        stats['by_psychotype'][ptype] += 1
            
            # stress_reaction
            reactions = tags.get('stress_reaction', [])
            if not isinstance(reactions, list) or not reactions:
                report.add_error(f"{prefix}: tags.stress_reaction должен быть непустым списком")
            else:
                for reaction in reactions:
                    if reaction not in VALID_STRESS_REACTIONS:
                        report.add_error(f"{prefix}: недопустимая stress_reaction = '{reaction}'")
            
            # trimester
            trimesters = tags.get('trimester', [])
            if not isinstance(trimesters, list) or not trimesters:
                report.add_error(f"{prefix}: tags.trimester должен быть непустым списком")
            else:
                for trim in trimesters:
                    if trim not in VALID_TRIMESTERS:
                        report.add_error(f"{prefix}: недопустимый trimester = '{trim}'")
            
            # format
            formats = tags.get('format', [])
            if not isinstance(formats, list) or not formats:
                report.add_error(f"{prefix}: tags.format должен быть непустым списком")
            else:
                for fmt in formats:
                    if fmt not in VALID_FORMATS:
                        report.add_error(f"{prefix}: недопустимый format = '{fmt}'")
                    else:
                        stats['by_format'][fmt] += 1
            
            # duration
            duration = tags.get('duration')
            if duration not in VALID_DURATIONS:
                report.add_error(f"{prefix}: недопустимый duration = '{duration}'")
            else:
                stats['by_duration'][duration] += 1
            
            # is_premium
            is_premium = tags.get('is_premium')
            if not isinstance(is_premium, bool):
                report.add_error(f"{prefix}: is_premium должен быть boolean, получено {type(is_premium).__name__}")
            else:
                if is_premium:
                    stats['premium'] += 1
                    # Запоминаем, для какого психотипа эта премиум-техника
                    for ptype in psychotypes:
                        if ptype != "any":
                            stats['premium_by_psychotype'][ptype].append(tech_id)
                else:
                    stats['free'] += 1
        
        # === content ===
        content = tech.get('content', {})
        if not isinstance(content, dict):
            report.add_error(f"{prefix}: content должен быть объектом")
        else:
            # text
            text = content.get('text', '')
            if not isinstance(text, str) or not text.strip():
                report.add_error(f"{prefix}: content.text пустой или не является строкой")
            
            # audio_url (может быть null)
            audio_url = content.get('audio_url')
            if audio_url is not None and not isinstance(audio_url, str):
                report.add_error(f"{prefix}: content.audio_url должен быть строкой или null")
            elif isinstance(audio_url, str):
                stats['audio'][tech_id] = {
                    'url': audio_url,
                    'duration': content.get('audio_duration_seconds'),
                    'title': title,
                }
            
            # video_url (может отсутствовать)
            video_url = content.get('video_url')
            if video_url is not None and not isinstance(video_url, str):
                report.add_error(f"{prefix}: content.video_url должен быть строкой или null")
            
            # timer_seconds (может быть null)
            timer = content.get('timer_seconds')
            if timer is not None and not isinstance(timer, int):
                report.add_error(f"{prefix}: content.timer_seconds должен быть int или null")
            elif isinstance(timer, int) and timer <= 0:
                report.add_error(f"{prefix}: content.timer_seconds должен быть > 0")
    
    # === Глобальные проверки ===
    
    # Проверка количества премиум-техник
    if stats['premium'] != EXPECTED_PREMIUM_COUNT:
        report.add_error(
            f"Ожидалось {EXPECTED_PREMIUM_COUNT} премиум-техник, найдено {stats['premium']}"
        )
    
    # Проверка покрытия всех психотипов премиумом
    missing_premium = ALL_PSYCHOTYPES - set(stats['premium_by_psychotype'].keys())
    if missing_premium:
        report.add_error(
            f"Следующие психотипы не имеют премиум-техник: {', '.join(sorted(missing_premium))}"
        )
    
    # Проверка, что есть хотя бы одна универсальная техника
    if stats['by_psychotype'].get('any', 0) == 0:
        report.add_warning("Нет универсальных техник (psychotypes: ['any'])")
    
    # Проверка покрытия уровней
    for level in VALID_LEVELS:
        if stats['by_level'].get(level, 0) == 0:
            report.add_warning(f"Нет техник для уровня '{level}'")
    
    # Информация
    report.add_info(f"Всего техник: {stats['total']}")
    report.add_info(f"Премиум: {stats['premium']}, Бесплатных: {stats['free']}")
    report.add_info(f"По уровням: {dict(stats['by_level'])}")
    report.add_info(f"По форматам: {dict(stats['by_format'])}")
    report.add_info(f"По длительности: {dict(stats['by_duration'])}")
    report.add_info(f"Покрытие психотипов премиумом: {dict(stats['premium_by_psychotype'])}")
    
    return stats


# ============================================================================
# ВАЛИДАЦИЯ АУДИО-ТРАНСКРИПТОВ
# ============================================================================

def validate_audio_scripts(
    file_path: Path,
    media_dir: Path,
    tech_stats: Dict[str, Any],
    report: ValidationReport,
) -> Dict[str, Any]:
    """
    Валидирует data/audio_scripts.json и связность с каталогом техник:
    каждая техника с audio_url имеет транскрипт, и наоборот.
    """
    print(f"\n Валидация аудио-транскриптов: {file_path}")

    if not file_path.exists():
        report.add_error(f"Файл не найден: {file_path}")
        return {}

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        report.add_error(f"Ошибка парсинга JSON: {e}")
        return {}

    scripts = data.get('audio_files')
    if not isinstance(scripts, list):
        report.add_error("Отсутствует список 'audio_files'")
        return {}

    if not data.get('voice_direction'):
        report.add_warning("Не задан voice_direction (требования к озвучке)")

    stats = {'total': len(scripts), 'by_id': {}, 'missing_files': []}

    for script in scripts:
        script_id = script.get('id')
        prefix = f"Транскрипт #{script_id}"

        if not isinstance(script_id, int):
            report.add_error(f"Транскрипт без корректного id: {script.get('title')}")
            continue
        if script_id in stats['by_id']:
            report.add_error(f"{prefix}: дублирующийся id")
            continue

        for field in ('filename', 'title', 'duration_seconds', 'transcript'):
            if not script.get(field):
                report.add_error(f"{prefix}: отсутствует поле '{field}'")

        duration = script.get('duration_seconds')
        if not isinstance(duration, int) or duration <= 0:
            report.add_error(f"{prefix}: duration_seconds должен быть положительным int")

        stats['by_id'][script_id] = script

        filename = script.get('filename')
        if isinstance(filename, str) and not (media_dir / 'techniques' / filename).exists():
            stats['missing_files'].append(filename)

    catalog_audio = tech_stats.get('audio', {}) if tech_stats else {}

    # Техника ссылается на аудио, но транскрипта нет.
    for tech_id, info in sorted(catalog_audio.items()):
        script = stats['by_id'].get(tech_id)
        if script is None:
            report.add_error(
                f"Техника #{tech_id} «{info['title']}» ссылается на {info['url']}, "
                f"но транскрипта в audio_scripts.json нет"
            )
            continue

        expected_name = info['url'].rsplit('/', 1)[-1]
        if script.get('filename') != expected_name:
            report.add_error(
                f"Техника #{tech_id}: audio_url ждёт файл '{expected_name}', "
                f"в транскрипте '{script.get('filename')}'"
            )

        if info['duration'] is not None and info['duration'] != script.get('duration_seconds'):
            report.add_warning(
                f"Техника #{tech_id}: длительность в каталоге {info['duration']} сек, "
                f"в транскрипте {script.get('duration_seconds')} сек"
            )

    # Транскрипт есть, а техника на него не ссылается.
    for script_id in sorted(stats['by_id']):
        if catalog_audio and script_id not in catalog_audio:
            report.add_error(
                f"Транскрипт #{script_id} «{stats['by_id'][script_id].get('title')}» "
                f"не привязан ни к одной технике (нет audio_url)"
            )

    if stats['missing_files']:
        report.add_warning(
            f"Озвучка не записана, нет {len(stats['missing_files'])} файлов в "
            f"{media_dir / 'techniques'}: {', '.join(stats['missing_files'][:5])}"
            + (' …' if len(stats['missing_files']) > 5 else '')
        )

    report.add_info(f"Всего транскриптов: {stats['total']}")
    report.add_info(f"Техник с audio_url: {len(catalog_audio)}")

    return stats


# ============================================================================
# ВАЛИДАЦИЯ ОПРОСНИКА
# ============================================================================

def validate_questionnaire(file_path: Path, report: ValidationReport) -> Dict[str, Any]:
    """
    Валидирует data/questionnaire_full.json
    
    Возвращает словарь со статистикой:
    {
        'questions_count': int,
        'max_possible': dict,
        ...
    }
    """
    print(f"\n Валидация опросника: {file_path}")
    
    if not file_path.exists():
        report.add_error(f"Файл не найден: {file_path}")
        return {}
    
    # Загрузка JSON
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        report.add_error(f"Ошибка парсинга JSON: {e}")
        return {}
    except UnicodeDecodeError as e:
        report.add_error(f"Ошибка кодировки (ожидается UTF-8): {e}")
        return {}
    
    # Проверка структуры верхнего уровня
    if 'questions' not in data:
        report.add_error("Отсутствует ключ 'questions' в корне файла")
        return {}
    
    questions = data['questions']
    if not isinstance(questions, list):
        report.add_error("Ключ 'questions' должен быть списком")
        return {}
    
    # Проверка количества вопросов
    if len(questions) != 10:
        report.add_error(f"Ожидалось 10 вопросов, найдено {len(questions)}")
    
    # Проверка max_possible
    max_possible = data.get('max_possible', {})
    if not isinstance(max_possible, dict):
        report.add_error("max_possible должен быть объектом")
    else:
        for trait, expected_value in EXPECTED_MAX_POSSIBLE.items():
            actual_value = max_possible.get(trait)
            if actual_value is None:
                report.add_error(f"В max_possible отсутствует тенденция '{trait}'")
            elif actual_value != expected_value:
                report.add_error(
                    f"max_possible['{trait}'] = {actual_value}, ожидалось {expected_value}"
                )
    
    # Статистика
    stats = {
        'questions_count': len(questions),
        'max_possible': max_possible,
        'actual_max': {trait: 0 for trait in VALID_TRAITS},
        'question_numbers': set()
    }
    
    # Валидация каждого вопроса
    for q_idx, question in enumerate(questions, 1):
        prefix = f"Вопрос #{q_idx}"
        
        if not isinstance(question, dict):
            report.add_error(f"{prefix}: должен быть объектом (dict)")
            continue
        
        # number
        number = question.get('number')
        if number is None:
            report.add_error(f"{prefix}: отсутствует поле 'number'")
        elif not isinstance(number, int):
            report.add_error(f"{prefix}: number должен быть int")
        elif number in stats['question_numbers']:
            report.add_error(f"{prefix}: дублирующийся номер вопроса = {number}")
        else:
            stats['question_numbers'].add(number)
        
        # context
        context = question.get('context')
        if context is not None and context not in VALID_CONTEXTS:
            report.add_warning(f"{prefix}: нестандартный context = '{context}'")
        
        # text
        text = question.get('text', '')
        if not isinstance(text, str) or not text.strip():
            report.add_error(f"{prefix}: text пустой или не является строкой")
        
        # options
        options = question.get('options', [])
        if not isinstance(options, list):
            report.add_error(f"{prefix}: options должен быть списком")
            continue
        
        if len(options) != 3:
            report.add_error(f"{prefix}: ожидалось 3 варианта ответа, найдено {len(options)}")
        
        # Валидация каждого варианта
        for opt_idx, option in enumerate(options, 1):
            opt_prefix = f"{prefix}, вариант {opt_idx}"
            
            if not isinstance(option, dict):
                report.add_error(f"{opt_prefix}: должен быть объектом")
                continue
            
            # id
            opt_id = option.get('id')
            if opt_id is None or not isinstance(opt_id, int):
                report.add_error(f"{opt_prefix}: отсутствует или некорректный id")
            
            # text
            opt_text = option.get('text', '')
            if not isinstance(opt_text, str) or not opt_text.strip():
                report.add_error(f"{opt_prefix}: text пустой или не является строкой")
            
            # weights
            weights = option.get('weights', {})
            if not isinstance(weights, dict):
                report.add_error(f"{opt_prefix}: weights должен быть объектом")
                continue
            
            # Проверка, что все ключи в weights — валидные тенденции
            for trait in weights.keys():
                if trait not in VALID_TRAITS:
                    report.add_error(f"{opt_prefix}: недопустимая тенденция в weights = '{trait}'")
            
            # Проверка, что все веса — положительные целые числа
            for trait, weight in weights.items():
                if not isinstance(weight, int):
                    report.add_error(f"{opt_prefix}: weight для '{trait}' должен быть int")
                elif weight < 0:
                    report.add_error(f"{opt_prefix}: weight для '{trait}' не может быть отрицательным")
                elif weight > 5:
                    report.add_warning(f"{opt_prefix}: вес для '{trait}' = {weight} (обычно ≤3)")
            
            # Сумма весов в варианте (должна быть разумной)
            total_weight = sum(weights.values())
            if total_weight == 0:
                report.add_error(f"{opt_prefix}: сумма весов = 0 (должна быть > 0)")
            elif total_weight > 10:
                report.add_warning(f"{opt_prefix}: сумма весов = {total_weight} (обычно 3-6)")
        
        # Фактический максимум по вопросу = max веса trait среди 3 вариантов
        question_max = {trait: 0 for trait in VALID_TRAITS}
        for option in options:
            if not isinstance(option, dict):
                continue
            weights = option.get('weights', {})
            if not isinstance(weights, dict):
                continue
            for trait, weight in weights.items():
                if trait in question_max and isinstance(weight, int):
                    question_max[trait] = max(question_max[trait], weight)
        for trait, weight in question_max.items():
            stats['actual_max'][trait] += weight
    
    # Проверка, что фактические максимумы совпадают с заявленными
    if max_possible:
        for trait, expected in EXPECTED_MAX_POSSIBLE.items():
            actual = stats['actual_max'].get(trait, 0)
            if actual != expected:
                report.add_error(
                    f"Фактический максимум для '{trait}' = {actual}, "
                    f"заявлено в max_possible = {expected}"
                )
    
    # Проверка, что все номера вопросов от 1 до 10
    expected_numbers = set(range(1, 11))
    missing_numbers = expected_numbers - stats['question_numbers']
    if missing_numbers:
        report.add_error(f"Отсутствуют номера вопросов: {sorted(missing_numbers)}")
    
    extra_numbers = stats['question_numbers'] - expected_numbers
    if extra_numbers:
        report.add_error(f"Лишние номера вопросов: {sorted(extra_numbers)}")
    
    # Информация
    report.add_info(f"Всего вопросов: {stats['questions_count']}")
    report.add_info(f"Фактические максимумы: {stats['actual_max']}")
    
    return stats


# ============================================================================
# ГЛАВНАЯ ФУНКЦИЯ
# ============================================================================

def main():
    """Главная функция с CLI"""
    parser = argparse.ArgumentParser(
        description="Валидация JSON-каталогов проекта «Элия»",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры использования:
  python scripts/validate_catalog.py                  # Проверить все файлы
  python scripts/validate_catalog.py --techniques     # Только каталог техник
  python scripts/validate_catalog.py --questionnaire  # Только опросник
  python scripts/validate_catalog.py --audio          # Только аудио-транскрипты
  python scripts/validate_catalog.py --verbose        # Подробный отчёт
        """
    )
    
    parser.add_argument(
        '--techniques',
        action='store_true',
        help='Валидировать только каталог техник'
    )
    parser.add_argument(
        '--questionnaire',
        action='store_true',
        help='Валидировать только опросник'
    )
    parser.add_argument(
        '--audio',
        action='store_true',
        help='Валидировать только аудио-транскрипты'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Подробный отчёт с информацией'
    )
    
    args = parser.parse_args()
    
    # Определяем базовую директорию
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    data_dir = project_root / 'data'
    
    techniques_file = data_dir / 'techniques_catalog.json'
    questionnaire_file = data_dir / 'questionnaire_full.json'
    audio_file = data_dir / 'audio_scripts.json'
    media_dir = project_root / 'media'
    
    # Если не указаны конкретные файлы — проверяем все
    explicit = args.techniques or args.questionnaire or args.audio
    validate_techniques = args.techniques or args.audio or not explicit
    validate_questionnaire_flag = args.questionnaire or not explicit
    validate_audio_flag = args.audio or not explicit
    
    print("=" * 70)
    print("🌸 ВАЛИДАЦИЯ КАТАЛОГОВ ПРОЕКТА «ЭЛИЯ»")
    print("=" * 70)
    print(f" Корень проекта: {project_root}")
    print(f"📁 Папка данных: {data_dir}")
    
    report = ValidationReport()
    
    # Валидация каталога техник
    tech_stats = {}
    if validate_techniques:
        tech_stats = validate_techniques_catalog(techniques_file, report)
    
    # Валидация аудио-транскриптов
    if validate_audio_flag:
        validate_audio_scripts(audio_file, media_dir, tech_stats, report)
    
    # Валидация опросника
    if validate_questionnaire_flag:
        validate_questionnaire(questionnaire_file, report)
    
    # Вывод отчёта
    report.print_report(verbose=args.verbose)
    
    # Возвращаем exit code
    sys.exit(0 if report.is_valid else 1)



if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Операция прервана пользователем")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ Непредвиденная ошибка: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

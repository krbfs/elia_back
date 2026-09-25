# Аудио техник

Файлы раздаются как `/media/techniques/{technique_id}_audio.mp3` (см. `MEDIA_DIR` в `src/index.ts`).

Имена файлов, длительности и транскрипты — в `data/audio_scripts.json`.
Связность «техника ↔ транскрипт ↔ файл» проверяет `python scripts/validate_catalog.py --audio`.

Записан 1 файл из 16 (`1_audio.mp3`), остальные 15 валидатор показывает предупреждением.

# HumanityVote

> Глобальная платформа где человечество может высказаться о главных угрозах своему виду.
> Один голос. Один раз. Навсегда.

## Принципы

- **Слепое голосование** — результаты только после твоего голоса
- **Невозможность изменения** — голос фиксируется навсегда (защита от bandwagon-эффекта)
- **Один голос с устройства** — fingerprinting + уникальный индекс в БД
- **Полная открытость** — весь код и данные публичны

## Стек

- **Frontend:** React + Vite
- **Backend:** Supabase (PostgreSQL)
- **Hosting:** Vercel
- **Fingerprinting:** FingerprintJS (бесплатная open-source версия)

## Локальный запуск

```bash
npm install
```

Создай файл `.env.local` в корне:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_KEY=sb_publishable_xxx
```

Запусти:

```bash
npm run dev
```

## База данных

См. `database/schema.sql` для структуры.

## Лицензия

AGPL-3.0

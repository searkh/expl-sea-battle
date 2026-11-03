# Деплой (Render и др.)

Статика отдаётся из корня репозитория. **Картинки обязательно должны быть в git:**

- `img/water-tile-36px.png`
- `img/ships/*.png` (обычные и `*-burning`)

Проверка перед push:

```bash
git ls-files img/
```

Если список пустой — ассеты не попадут на сервер.

После push на Render: жёсткое обновление страницы (Ctrl+F5).

Проверка на проде: открыть в браузере  
`https://ВАШ-URL/img/water-tile-36px.png` — должен быть PNG, не 404.

Матросы в воде: `img/sailor-1.png` … `img/sailor-3.png`.

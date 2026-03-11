# Frontend

React frontend implemented in TypeScript with Tailwind CSS-compatible styling and a shared API client for the FastAPI backend.

## Stack

- React 18
- TypeScript
- Tailwind CSS
- Axios
- `react-scripts`

## Run

```bash
cd frontend
npm install
npm start
```

The frontend runs on `http://localhost:3000`.

Run the backend separately from the repo root:

```bash
uvicorn main:app --reload
```

The frontend calls the backend through [src/lib/api.ts](c:\Users\vatsu\Desktop\AI_Interview_Platform\frontend\src\lib\api.ts).

Default backend URL:

```bash
http://localhost:8000
```

Override it with:

```bash
REACT_APP_API_BASE_URL=http://localhost:8000
```

## Structure

```text
frontend/
├── src/
│   ├── components/
│   ├── lib/
│   ├── pages/
│   ├── utils/
│   ├── App.tsx
│   └── index.tsx
├── tailwind.config.js
├── postcss.config.js
└── tsconfig.json
```

## Notes

- Frontend source is TypeScript-only under `src/`.
- Styling is driven by Tailwind layers in `src/App.css`.
- Backend requests use the shared Axios instance instead of direct per-file Axios configuration.

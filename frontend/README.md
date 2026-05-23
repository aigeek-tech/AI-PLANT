# Smart Design Frontend

This is a React + Vite frontend for the Smart Design Standard module.

## Features

- **Standards List**: Browse and create standards.
- **Standard Detail**: Inspect class hierarchies and attribute definitions.
- **Icon Upload**: Update a standard icon from the detail page.
- **RBAC Login**: Restore an HttpOnly cookie session, protect routes, and hide actions the user cannot perform.
- **CAD Preview**: DWG/DXF files use the browser-side MLight CAD viewer. DWG parsing depends on LibreDWG WebAssembly / GPL-3.0 components and is accepted for the current internal-use distribution model.
- **Styling**: Tailwind CSS with the existing blue visual language.

## Setup & Run

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start the development server:
   ```bash
   pnpm dev
   ```
3. Open the shown URL, usually `http://localhost:5173`.
4. Log in with an existing account, or create the first administrator from the login page when the backend reports that bootstrap is required.

## Architecture

- **Framework**: React 19 + Vite
- **Styling**: Tailwind CSS v3 + Lucide React + clsx
- **Data Source**: FastAPI APIs under `/api/...`
- **Auth State**: `src/auth/AuthProvider.tsx` calls `/api/auth/me` and exposes `can(permission, scopeId)` for menu and action gating.
- **CAD Assets**: `vite-plugin-static-copy` publishes CAD parser workers under `cad-viewer-assets/`; set `VITE_CAD_VIEWER_BASE_URL` when deploying with mirrored font/data assets.

## License

This frontend is distributed under the repository root `LICENSE`. Commercial use is permitted, but copyright notices, the `NOTICE` file, and the Aigeek / 艾极科技 logo and attribution must be retained. Third-party dependencies remain under their own licenses.

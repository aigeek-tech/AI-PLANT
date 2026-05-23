# Feature Verification Scripts

This folder contains feature-level verification scripts. Add or update one script here whenever a feature is completed so the same checks can be rerun without reconstructing the command sequence.

## Convention

- Name scripts by feature, for example `ai-settings.ps1`.
- Keep scripts self-contained and fail fast on the first failed command.
- Feature scripts should call the narrowest relevant backend tests first, then frontend lint/build checks when the feature touches UI.
- Keep unit tests in their package-owned test folders, such as `backend/tests/`.

## Current Scripts

- `ai-settings.ps1` verifies the AI settings backend API tests plus frontend lint/build coverage for the settings UI.

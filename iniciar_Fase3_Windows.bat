@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Falta el entorno .venv. Revisa README_FASE3.md.
  pause
  exit /b 1
)
if not exist "frontend\dist\index.html" (
  echo Falta compilar la pantalla. Revisa README_FASE3.md.
  pause
  exit /b 1
)
echo COMMUNITY 360 - Abre http://127.0.0.1:8000/login
echo Para detener el servidor presiona Ctrl+C.
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause

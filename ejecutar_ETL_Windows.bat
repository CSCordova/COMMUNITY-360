@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
 echo Primero instala dependencias como indica README_PASO_A_PASO.md
 pause
 exit /b 1
)
.venv\Scripts\python.exe etl.py
if errorlevel 1 (pause & exit /b 1)
.venv\Scripts\python.exe cargar_nube.py --preparar
if errorlevel 1 (pause & exit /b 1)
.venv\Scripts\python.exe -m unittest discover -s pruebas -v
pause

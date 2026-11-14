@echo off
rem Lokaler Build (benoetigt Python 3 und Node.js). Ohne beides: GitHub-Weg aus der README nutzen.
pip install pyirsdk websockets pyinstaller
pyinstaller --onefile --noconsole --name iracing_bridge --distpath bridge --workpath pyi-build --specpath pyi-build bridge\iracing_bridge.py
call npm install
call npm run dist
echo Fertig: dist\iRacing HUD Setup 1.0.0.exe
pause

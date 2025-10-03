@echo off
chcp 65001 >nul

echo 🚀 스마트 수면 알람 시스템을 시작합니다...

REM Node.js가 설치되어 있는지 확인
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js가 설치되어 있지 않습니다.
    echo Node.js를 설치한 후 다시 실행해주세요.
    pause
    exit /b 1
)

REM npm이 설치되어 있는지 확인
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm이 설치되어 있지 않습니다.
    echo npm을 설치한 후 다시 실행해주세요.
    pause
    exit /b 1
)

REM 의존성 설치
echo 📦 의존성을 설치합니다...
npm install

if %errorlevel% neq 0 (
    echo ❌ 의존성 설치에 실패했습니다.
    pause
    exit /b 1
)

REM 서버 시작
echo 🌐 서버를 시작합니다...
echo 웹 인터페이스: http://localhost:8080
echo 종료하려면 Ctrl+C를 누르세요.

node server.js

pause
